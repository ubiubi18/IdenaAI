#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const {execFileSync} = require('child_process')
const {
  canonicalJson,
  readCanonicalJson,
  sha256,
  validateArtifact,
} = require('../main/application-release-policy')
const {sha256File, targetName} = require('../main/node-artifact-policy')

const {compareBuildReports} = require('./check-node-build-evidence')

const ROOT = path.resolve(__dirname, '..')
const RELEASE_PLATFORMS = [
  'linux-x64',
  'linux-arm64',
  'windows-x64',
  'macos-x64',
  'macos-arm64',
]

function approvedNodeDigest(report, target, stack) {
  const artifacts = report.releaseArtifacts
  if (
    !Array.isArray(artifacts) ||
    artifacts.length !== RELEASE_PLATFORMS.length ||
    new Set(artifacts.map((artifact) => artifact.platform)).size !==
      RELEASE_PLATFORMS.length ||
    artifacts.some(
      (artifact) =>
        !RELEASE_PLATFORMS.includes(artifact.platform) ||
        !/^[0-9a-f]{64}$/u.test(artifact.sha256 || '')
    )
  ) {
    throw new Error(
      'Independent rebuild evidence must pin all five release platforms'
    )
  }
  // Standalone releases use different ldflags/VCS settings. Desktop nodes
  // require independent reports from the desktop build profile itself.
  const reports = report.results?.applicationNodeBuilds
  if (!Array.isArray(reports)) {
    throw new Error(
      'Independent rebuild evidence lacks desktop node build reports'
    )
  }
  return compareBuildReports(
    reports.filter(
      (item) => `${item.results?.platform}-${item.results?.arch}` === target
    ),
    stack
  )
}

async function prepareNodeApproval({
  root = ROOT,
  platform = process.platform,
  arch = process.arch,
} = {}) {
  const stack = readCanonicalJson(root, 'compatibility/stack-lock.json')
  const application = readCanonicalJson(
    root,
    'compatibility/application-release-lock.json'
  )
  const approved = stack.status === 'approved'
  // The complete source/evidence check is a build-time boundary, never a
  // source-file check inside a transformed Electron package.
  execFileSync(
    process.execPath,
    [
      path.join(root, 'scripts/check-compatibility-lock.js'),
      ...(approved ? ['--require-approved'] : []),
    ],
    {cwd: root, stdio: 'inherit'}
  )
  if (
    !['candidate', 'approved'].includes(stack.status) ||
    application.compatibilityReleaseId !== stack.releaseId
  ) {
    throw new Error(
      'Cannot package a retired or mismatched compatibility stack'
    )
  }
  const target = targetName(platform, arch)
  const binaryName = platform === 'win32' ? 'idena-go.exe' : 'idena-go'
  const binaryPath = path.join(root, 'build/node/current', binaryName)
  const metadata = fs.lstatSync(binaryPath)
  if (!metadata.isFile() || metadata.isSymbolicLink())
    throw new Error('Bundled node must be a regular file')
  const nodeArtifact = {
    target,
    path: `node/${binaryName}`,
    sha256: await sha256File(binaryPath),
    size: metadata.size,
  }
  validateArtifact(nodeArtifact, 'node')
  if (approved) {
    const descriptor = stack.gateResults['independent-rebuild-digest-match']
    const report = readCanonicalJson(root, descriptor.evidence)
    if (
      sha256(canonicalJson(report)) !== descriptor.sha256 ||
      approvedNodeDigest(report, target, stack) !== nodeArtifact.sha256
    ) {
      throw new Error(
        'Bundled node does not match approved independent rebuild evidence'
      )
    }
  }
  const approval = {
    schema: 1,
    applicationReleaseId: application.releaseId,
    compatibilityReleaseId: stack.releaseId,
    stackLockSha256: sha256(canonicalJson(stack)),
    status: approved ? 'approved' : 'candidate',
    nodeArtifact,
  }
  fs.writeFileSync(
    path.join(path.dirname(binaryPath), 'approval.json'),
    canonicalJson(approval)
  )
  return approval
}

if (require.main === module) {
  prepareNodeApproval().catch((error) => {
    console.error(`[prepare-node-approval] ${error.message}`)
    process.exit(1)
  })
}

module.exports = {approvedNodeDigest, prepareNodeApproval}
