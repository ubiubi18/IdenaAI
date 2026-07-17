#!/usr/bin/env node

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const EVIDENCE_PREFIX = 'compatibility/evidence/'
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
      `Gate evidence path escapes the repository: ${relativePath}`
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
        `Gate evidence must be a regular file without symlinked parents: ${relativePath}`
      )
    }
  }
  return fs.readFileSync(absolutePath)
}

function requireSafeEvidencePath(evidencePath) {
  if (
    typeof evidencePath !== 'string' ||
    path.isAbsolute(evidencePath) ||
    evidencePath.includes('\\') ||
    path.posix.normalize(evidencePath) !== evidencePath ||
    !evidencePath.startsWith(EVIDENCE_PREFIX) ||
    !/^[a-zA-Z0-9._/-]+\.json$/u.test(evidencePath)
  ) {
    throw new Error(`Unsafe gate evidence path: ${evidencePath || 'missing'}`)
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
    throw new Error(`Gate evidence does not match ${gateName}`)
  }

  requireCompletedAt(report.completedAt, `Gate evidence ${gateName}`)
  verifyExactPins(
    report.components,
    componentPins(lock),
    `Gate evidence ${gateName}`
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
    throw new Error(`Gate evidence lacks reproducible results for ${gateName}`)
  }
}

function verifyGateResults(lock, readEvidence) {
  const requiredGates = lock.requiredGates || []
  const results = lock.gateResults
  if (
    !results ||
    typeof results !== 'object' ||
    Array.isArray(results) ||
    Object.keys(results).length !== requiredGates.length ||
    requiredGates.some((gate) => !Object.hasOwn(results, gate))
  ) {
    throw new Error('Approved compatibility lock has an incomplete gate set')
  }

  const evidencePaths = new Set()
  for (const gateName of requiredGates) {
    const descriptor = results[gateName]
    requireSafeEvidencePath(descriptor?.evidence)
    if (
      descriptor.status !== 'passed' ||
      !SHA256_PATTERN.test(descriptor.sha256 || '') ||
      evidencePaths.has(descriptor.evidence)
    ) {
      throw new Error(`Invalid gate evidence descriptor for ${gateName}`)
    }
    evidencePaths.add(descriptor.evidence)

    const raw = readEvidence(descriptor.evidence)
    if (!Buffer.isBuffer(raw) || sha256(raw) !== descriptor.sha256) {
      throw new Error(`Gate evidence checksum mismatch: ${descriptor.evidence}`)
    }

    let report
    try {
      const text = raw.toString('utf8')
      report = JSON.parse(text)
      if (`${JSON.stringify(report, null, 2)}\n` !== text) {
        throw new Error('noncanonical')
      }
    } catch {
      throw new Error(
        `Gate evidence is not valid canonical JSON: ${descriptor.evidence}`
      )
    }
    verifyGateReport(lock, gateName, report)
  }
}

function loadAndVerifyGateResults(lock, root = ROOT) {
  verifyGateResults(lock, (evidencePath) => readRegular(root, evidencePath))
}

module.exports = {
  loadAndVerifyGateResults,
  readRegular,
  requireCompletedAt,
  requireSafeEvidencePath,
  sha256,
  verifyGateReport,
  verifyGateResults,
}
