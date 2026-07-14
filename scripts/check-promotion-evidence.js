#!/usr/bin/env node

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const MANIFEST_PATH = 'compatibility/promotion-evidence.json'
const REPORT_PREFIX = 'compatibility/reports/'
const SHA256_PATTERN = /^[0-9a-f]{64}$/u

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex')
}

function readRegular(root, relativePath) {
  const resolvedRoot = path.resolve(root)
  const absolutePath = path.resolve(resolvedRoot, relativePath)
  const expectedRoot = `${resolvedRoot}${path.sep}`
  if (!absolutePath.startsWith(expectedRoot)) {
    throw new Error(
      `Promotion evidence path escapes the repository: ${relativePath}`
    )
  }

  const segments = path.relative(resolvedRoot, absolutePath).split(path.sep)
  let currentPath = resolvedRoot
  for (const [index, segment] of segments.entries()) {
    currentPath = path.join(currentPath, segment)
    const metadata = fs.lstatSync(currentPath)
    const isFinal = index === segments.length - 1
    if (
      metadata.isSymbolicLink() ||
      (isFinal ? !metadata.isFile() : !metadata.isDirectory())
    ) {
      throw new Error(
        `Promotion evidence must be a regular file without symlinked parents: ${relativePath}`
      )
    }
  }
  return fs.readFileSync(absolutePath)
}

function requireSafeReportPath(reportPath) {
  if (
    typeof reportPath !== 'string' ||
    path.isAbsolute(reportPath) ||
    reportPath.includes('\\') ||
    path.posix.normalize(reportPath) !== reportPath ||
    !reportPath.startsWith(REPORT_PREFIX) ||
    !/^[a-zA-Z0-9._/-]+\.json$/u.test(reportPath)
  ) {
    throw new Error(`Unsafe promotion report path: ${reportPath || 'missing'}`)
  }
}

function componentPins(lock) {
  return Object.fromEntries(
    (lock.components || []).map((component) => [
      component.name,
      component.commit,
    ])
  )
}

function verifyExactPins(actual, expected, label) {
  if (
    !actual ||
    typeof actual !== 'object' ||
    Array.isArray(actual) ||
    JSON.stringify(Object.keys(actual).sort()) !==
      JSON.stringify(Object.keys(expected).sort()) ||
    Object.entries(expected).some(([name, commit]) => actual[name] !== commit)
  ) {
    throw new Error(`${label} does not match the compatibility component pins`)
  }
}

function requireCompletedAt(value, label) {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN
  const normalized =
    typeof value === 'string' && !value.includes('.')
      ? value.replace(/Z$/u, '.000Z')
      : value
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) ||
    Number.isNaN(parsed) ||
    new Date(parsed).toISOString() !== normalized
  ) {
    throw new Error(`${label} has an invalid completion timestamp`)
  }
}

function verifyGateReport(lock, gateName, report) {
  if (
    report?.schema !== 1 ||
    report.releaseId !== lock.releaseId ||
    report.gate !== gateName ||
    report.status !== 'passed' ||
    report.legacyBaselineCommit !== lock.legacyBaseline?.commit ||
    report.sourceCommit !== componentPins(lock)['idena-go']
  ) {
    throw new Error(`Promotion report does not match gate ${gateName}`)
  }

  requireCompletedAt(report.completedAt, `Promotion report ${gateName}`)
  verifyExactPins(
    report.components,
    componentPins(lock),
    `Promotion report ${gateName}`
  )

  if (
    !Array.isArray(report.commands) ||
    report.commands.length === 0 ||
    report.commands.some(
      (command) => typeof command !== 'string' || command.trim().length === 0
    ) ||
    !report.results ||
    typeof report.results !== 'object' ||
    Array.isArray(report.results) ||
    Object.keys(report.results).length === 0
  ) {
    throw new Error(
      `Promotion report lacks reproducible results for ${gateName}`
    )
  }
}

function verifyPromotionEvidence(lock, evidence, readReport) {
  const expectedPins = componentPins(lock)
  if (
    evidence?.schema !== 1 ||
    evidence.releaseId !== lock.releaseId ||
    evidence.legacyBaselineCommit !== lock.legacyBaseline?.commit ||
    evidence.sourceCommit !== expectedPins['idena-go']
  ) {
    throw new Error('Promotion evidence does not match the compatibility lock')
  }
  verifyExactPins(evidence.components, expectedPins, 'Promotion evidence')

  const requiredGates = lock.requiredGates || []
  const gates = evidence.gates || []
  if (
    gates.length !== requiredGates.length ||
    new Set(gates.map((gate) => gate?.name)).size !== requiredGates.length
  ) {
    throw new Error('Promotion evidence has an incomplete gate set')
  }

  const reportPaths = new Set()
  for (const gateName of requiredGates) {
    const gate = gates.find((candidate) => candidate?.name === gateName)
    if (
      !gate ||
      gate.status !== 'passed' ||
      !Array.isArray(gate.reports) ||
      gate.reports.length === 0
    ) {
      throw new Error(`Promotion evidence has not passed gate ${gateName}`)
    }

    for (const descriptor of gate.reports) {
      requireSafeReportPath(descriptor?.path)
      if (
        !SHA256_PATTERN.test(descriptor?.sha256 || '') ||
        reportPaths.has(descriptor.path)
      ) {
        throw new Error(`Invalid promotion report descriptor for ${gateName}`)
      }
      reportPaths.add(descriptor.path)

      const raw = readReport(descriptor.path)
      if (!Buffer.isBuffer(raw) || sha256(raw) !== descriptor.sha256) {
        throw new Error(
          `Promotion report checksum mismatch: ${descriptor.path}`
        )
      }

      let report
      try {
        report = JSON.parse(raw.toString('utf8'))
      } catch {
        throw new Error(
          `Promotion report is not valid JSON: ${descriptor.path}`
        )
      }
      verifyGateReport(lock, gateName, report)
    }
  }
}

function loadAndVerifyPromotionEvidence(lock, root = ROOT) {
  const descriptor = lock.promotionEvidence
  if (
    descriptor?.manifest !== MANIFEST_PATH ||
    !SHA256_PATTERN.test(descriptor?.sha256 || '')
  ) {
    throw new Error(
      'Promoted compatibility lock lacks pinned promotion evidence'
    )
  }

  const raw = readRegular(root, descriptor.manifest)
  if (sha256(raw) !== descriptor.sha256) {
    throw new Error('Promotion evidence manifest checksum mismatch')
  }

  let evidence
  try {
    evidence = JSON.parse(raw.toString('utf8'))
  } catch {
    throw new Error('Promotion evidence manifest is not valid JSON')
  }
  verifyPromotionEvidence(lock, evidence, (reportPath) =>
    readRegular(root, reportPath)
  )
}

module.exports = {
  loadAndVerifyPromotionEvidence,
  readRegular,
  requireCompletedAt,
  requireSafeReportPath,
  sha256,
  verifyGateReport,
  verifyPromotionEvidence,
}
