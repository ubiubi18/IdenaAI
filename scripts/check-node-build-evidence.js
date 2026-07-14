#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const lock = require('../compatibility/stack-lock.json')
const {bindingLibName} = require('./build-node-from-sources')
const {verifyGateReport} = require('./check-promotion-evidence')

const SHA256_PATTERN = /^[0-9a-f]{64}$/u

function readReport(filePath) {
  const metadata = fs.lstatSync(filePath)
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`Build evidence must be a regular file: ${filePath}`)
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function verifyBuildReport(report, expectedLock = lock) {
  verifyGateReport(expectedLock, 'independent-rebuild-digest-match', report)
  const result = report.results
  const expectedBinding = bindingLibName(result.platform, result.arch)
  const expectedArtifact = (expectedLock.artifacts || []).find(
    (artifact) => artifact.name === expectedBinding
  )
  const goPlatform = result.platform === 'win32' ? 'windows' : result.platform
  const goArch = result.arch === 'x64' ? 'amd64' : result.arch
  const expectedGoVersion = `go version go${expectedLock.toolchains.go} ${goPlatform}/${goArch}`
  if (
    !['darwin', 'linux', 'win32'].includes(result.platform) ||
    !['arm64', 'x64'].includes(result.arch) ||
    !/^[a-zA-Z0-9._-]{1,80}$/u.test(result.builderId || '') ||
    !SHA256_PATTERN.test(result.binarySha256 || '') ||
    !Number.isSafeInteger(result.binarySize) ||
    result.binarySize <= 1024 * 1024 ||
    !expectedBinding ||
    !expectedArtifact ||
    result.bindingArtifact !== expectedBinding ||
    result.bindingSha256 !== expectedArtifact.sha256 ||
    result.goVersion !== expectedGoVersion ||
    result.nodeVersion !== `v${expectedLock.toolchains.node}`
  ) {
    throw new Error('Node build evidence contains invalid results')
  }
}

function verifyCiProvenance(reports) {
  const provenance = reports.map((report) => report.provenance || {})
  const usesGithub = provenance.some((value) =>
    Object.keys(value).some((key) => key.startsWith('github'))
  )
  if (!usesGithub) return

  const requiredFields = [
    'githubRepository',
    'githubRunAttempt',
    'githubRunId',
    'githubSha',
    'runnerArch',
    'runnerName',
    'runnerOs',
  ]
  for (const value of provenance) {
    if (
      requiredFields.some(
        (field) =>
          typeof value[field] !== 'string' || value[field].trim().length === 0
      ) ||
      !/^\d+$/u.test(value.githubRunAttempt) ||
      !/^\d+$/u.test(value.githubRunId) ||
      !/^[0-9a-f]{40,64}$/u.test(value.githubSha)
    ) {
      throw new Error('GitHub build evidence has incomplete provenance')
    }
  }

  const first = provenance[0]
  for (const value of provenance.slice(1)) {
    for (const field of [
      'githubRepository',
      'githubRunAttempt',
      'githubRunId',
      'githubSha',
      'runnerArch',
      'runnerOs',
    ]) {
      if (value[field] !== first[field]) {
        throw new Error(`GitHub build provenance differs in ${field}`)
      }
    }
  }
}

function compareBuildReports(reports, expectedLock = lock) {
  if (!Array.isArray(reports) || reports.length < 2) {
    throw new Error('At least two independent build reports are required')
  }
  reports.forEach((report) => verifyBuildReport(report, expectedLock))

  const first = reports[0].results
  const builderIds = new Set(reports.map((report) => report.results.builderId))
  if (builderIds.size !== reports.length) {
    throw new Error('Independent build reports reuse a builder identity')
  }
  verifyCiProvenance(reports)

  for (const report of reports.slice(1)) {
    const result = report.results
    for (const field of [
      'arch',
      'binarySha256',
      'binarySize',
      'bindingArtifact',
      'bindingSha256',
      'goVersion',
      'nodeVersion',
      'platform',
    ]) {
      if (result[field] !== first[field]) {
        throw new Error(`Independent node builds differ in ${field}`)
      }
    }
  }
  return first.binarySha256
}

function main(argv = process.argv.slice(2)) {
  if (argv.length < 2) {
    throw new Error('Pass at least two node build evidence files')
  }
  const digest = compareBuildReports(
    argv.map((file) => readReport(path.resolve(file)))
  )
  console.log(`[check-node-build-evidence] Matching digest: ${digest}`)
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(`[check-node-build-evidence] ${error.message}`)
    process.exit(1)
  }
}

module.exports = {compareBuildReports, verifyBuildReport, verifyCiProvenance}
