const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const SAFE_ID_PATTERN = /^[a-zA-Z0-9._-]{1,96}$/u
const REQUIRED_TARGETS = Object.freeze([
  'darwin-arm64',
  'linux-x64',
  'win32-x64',
])
const REQUIRED_PROTECTED_FILES = Object.freeze([
  '.github/workflows/release.yml',
  '.node-version',
  '.nvmrc',
  'compatibility/stack-lock.json',
  'main/ai-providers/bridge.js',
  'main/ai-providers/url-policy.js',
  'main/application-release-policy.js',
  'main/idena-node.js',
  'main/index.js',
  'main/node-artifact-policy.js',
  'main/utils/fetch-client.js',
  'package-lock.json',
  'package.json',
  'scripts/build-node-from-sources.js',
  'scripts/check-application-release-lock.js',
  'scripts/check-bundled-node-artifact.js',
  'scripts/dependency-footprint-baseline.json',
  'scripts/prepare-bundled-node.js',
  'scripts/run-electron-builder.js',
  'scripts/source-manifest.json',
  'vendor/idena.social-contract/package.json',
  'vendor/idena.social-contract/test-contract-runner/go.mod',
  'vendor/idena.social-contract/test-contract-runner/go.sum',
  'vendor/idena.social-contract/yarn.lock',
  'vendor/idena.social-ui/package-lock.json',
  'vendor/idena.social-ui/package.json',
])

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex')
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function readRegular(root, relativePath) {
  const resolvedRoot = path.resolve(root)
  const absolutePath = path.resolve(resolvedRoot, relativePath)
  if (!absolutePath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(
      `Application release path escapes the repository: ${relativePath}`
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
        `Application release input must be a regular file without symlinked parents: ${relativePath}`
      )
    }
  }
  return fs.readFileSync(absolutePath)
}

function readCanonicalJson(root, relativePath) {
  const raw = readRegular(root, relativePath)
  const value = JSON.parse(raw.toString('utf8'))
  if (canonicalJson(value) !== raw.toString('utf8')) {
    throw new Error(
      `Application release JSON is not canonical: ${relativePath}`
    )
  }
  return value
}

function protectedFileDigests(root) {
  return Object.fromEntries(
    REQUIRED_PROTECTED_FILES.map((relativePath) => [
      relativePath,
      sha256(readRegular(root, relativePath)),
    ])
  )
}

function protectedFilesRoot(protectedFiles) {
  return sha256(canonicalJson(protectedFiles))
}

function validateArtifact(artifact, kind) {
  if (
    !artifact ||
    typeof artifact !== 'object' ||
    Array.isArray(artifact) ||
    !REQUIRED_TARGETS.includes(artifact.target) ||
    typeof artifact.path !== 'string' ||
    path.posix.normalize(artifact.path) !== artifact.path ||
    artifact.path.startsWith('/') ||
    artifact.path.includes('\\') ||
    !SHA256_PATTERN.test(artifact.sha256 || '') ||
    !Number.isSafeInteger(artifact.size) ||
    artifact.size <= 0
  ) {
    throw new Error(`Invalid ${kind} artifact descriptor`)
  }

  if (kind === 'node') {
    const expectedPath =
      artifact.target === 'win32-x64' ? 'node/idena-go.exe' : 'node/idena-go'
    if (artifact.path !== expectedPath || artifact.size <= 1024 * 1024) {
      throw new Error('Invalid node artifact descriptor')
    }
  } else if (!artifact.path.startsWith('dist/')) {
    throw new Error('Desktop artifacts must stay under dist/')
  }
}

function artifactSetForTarget(lock, target) {
  return {
    nodeArtifact: lock.nodeArtifacts.find((item) => item.target === target),
    desktopArtifacts: lock.desktopArtifacts.filter(
      (item) => item.target === target
    ),
  }
}

function verifyEvidence(lock, root) {
  const evidenceByTarget = new Map(
    REQUIRED_TARGETS.map((target) => [target, []])
  )
  const evidencePaths = new Set()
  const verifierIds = new Set()
  const expectedProtectedRoot = protectedFilesRoot(lock.protectedFiles)

  for (const descriptor of lock.verifierEvidence) {
    if (
      !descriptor ||
      !REQUIRED_TARGETS.includes(descriptor.target) ||
      typeof descriptor.path !== 'string' ||
      !descriptor.path.startsWith('compatibility/application-evidence/') ||
      path.posix.normalize(descriptor.path) !== descriptor.path ||
      !descriptor.path.endsWith('.json') ||
      !SHA256_PATTERN.test(descriptor.sha256 || '') ||
      evidencePaths.has(descriptor.path)
    ) {
      throw new Error('Invalid application release evidence descriptor')
    }
    evidencePaths.add(descriptor.path)

    const raw = readRegular(root, descriptor.path)
    if (sha256(raw) !== descriptor.sha256) {
      throw new Error(
        `Application release evidence checksum mismatch: ${descriptor.path}`
      )
    }
    const evidence = JSON.parse(raw.toString('utf8'))
    if (canonicalJson(evidence) !== raw.toString('utf8')) {
      throw new Error(
        `Application release evidence is not canonical: ${descriptor.path}`
      )
    }

    const expectedArtifacts = artifactSetForTarget(lock, descriptor.target)
    if (
      evidence.schema !== 1 ||
      evidence.releaseId !== lock.releaseId ||
      evidence.target !== descriptor.target ||
      !SAFE_ID_PATTERN.test(evidence.verifierId || '') ||
      evidence.protectedFilesRoot !== expectedProtectedRoot ||
      JSON.stringify(evidence.nodeArtifact) !==
        JSON.stringify(expectedArtifacts.nodeArtifact) ||
      JSON.stringify(evidence.desktopArtifacts) !==
        JSON.stringify(expectedArtifacts.desktopArtifacts) ||
      !Array.isArray(evidence.commands) ||
      evidence.commands.length === 0 ||
      evidence.commands.some(
        (command) => typeof command !== 'string' || command.trim().length === 0
      ) ||
      verifierIds.has(evidence.verifierId)
    ) {
      throw new Error('Invalid application release verifier evidence')
    }
    verifierIds.add(evidence.verifierId)
    evidenceByTarget.get(descriptor.target).push(evidence)
  }

  for (const target of REQUIRED_TARGETS) {
    if (evidenceByTarget.get(target).length < 2) {
      throw new Error(
        `Application release target lacks two verifiers: ${target}`
      )
    }
  }
}

function verifyApplicationReleaseLock(
  lock,
  root,
  {requireApproved = false} = {}
) {
  if (
    lock?.schema !== 1 ||
    !SAFE_ID_PATTERN.test(lock.releaseId || '') ||
    !['candidate', 'approved', 'retired'].includes(lock.status) ||
    lock.compatibilityReleaseId !==
      'idena-mainnet-legacy-compat-2026.07.17-rc7' ||
    lock.consensusChangesAllowed !== false
  ) {
    throw new Error('Invalid application release lock identity')
  }

  const expectedProtectedFiles = protectedFileDigests(root)
  if (
    JSON.stringify(lock.protectedFiles) !==
    JSON.stringify(expectedProtectedFiles)
  ) {
    throw new Error('Application release protected files do not match')
  }

  if (
    JSON.stringify(lock.requiredTargets) !== JSON.stringify(REQUIRED_TARGETS) ||
    !Array.isArray(lock.nodeArtifacts) ||
    !Array.isArray(lock.desktopArtifacts) ||
    !Array.isArray(lock.verifierEvidence)
  ) {
    throw new Error(
      'Application release lock has an invalid target or artifact set'
    )
  }

  if (requireApproved && lock.status !== 'approved') {
    throw new Error('Application release is not independently approved')
  }
  if (lock.status !== 'approved') return

  lock.nodeArtifacts.forEach((artifact) => validateArtifact(artifact, 'node'))
  lock.desktopArtifacts.forEach((artifact) =>
    validateArtifact(artifact, 'desktop')
  )
  for (const target of REQUIRED_TARGETS) {
    if (
      lock.nodeArtifacts.filter((item) => item.target === target).length !==
        1 ||
      lock.desktopArtifacts.filter((item) => item.target === target).length < 1
    ) {
      throw new Error(
        `Application release artifacts are incomplete for ${target}`
      )
    }
  }
  verifyEvidence(lock, root)
}

module.exports = {
  REQUIRED_PROTECTED_FILES,
  REQUIRED_TARGETS,
  canonicalJson,
  protectedFileDigests,
  protectedFilesRoot,
  readCanonicalJson,
  sha256,
  validateArtifact,
  verifyApplicationReleaseLock,
}
