#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const {
  protectedFilesRoot,
  readCanonicalJson,
  validateArtifact,
  verifyApplicationReleaseLock,
  REQUIRED_TARGETS,
} = require('../main/application-release-policy')
const {
  sha256File,
  targetName,
  verifyNodeApproval,
} = require('../main/node-artifact-policy')

const ROOT = path.resolve(__dirname, '..')
const LOCK_PATH = path.join('compatibility', 'application-release-lock.json')
const STAGED_DIR = path.join('build', 'release-verified')
const PUBLISHED_EXTENSIONS = [
  '.dmg',
  '.zip',
  '.deb',
  '.exe',
  '.AppImage',
  '.blockmap',
  '.yml',
  '.yaml',
]
const EXCLUDED_FILES = new Set([
  'builder-debug.yml',
  'builder-effective-config.yml',
  'builder-effective-config.yaml',
])

function uploadableDesktopPaths(root) {
  return fs
    .readdirSync(path.join(root, 'dist'))
    .filter(
      (name) =>
        !EXCLUDED_FILES.has(name) &&
        PUBLISHED_EXTENSIONS.some((extension) => name.endsWith(extension))
    )
    .map((name) => `dist/${name}`)
    .sort()
}

async function checkFile(root, relativePath, artifact, hashFile) {
  const absolutePath = path.join(root, relativePath)
  const metadata = await fs.promises.lstat(absolutePath)
  if (
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    metadata.size !== artifact.size
  ) {
    throw new Error(
      `Release artifact metadata does not match approval: ${relativePath}`
    )
  }
  if ((await hashFile(absolutePath)) !== artifact.sha256) {
    throw new Error(
      `Release artifact digest does not match approval: ${relativePath}`
    )
  }
}

async function verifyAndStageReleaseArtifacts({
  root = ROOT,
  artifactRoot = root,
  target = null,
  platform = process.platform,
  arch = process.arch,
  readLock = readCanonicalJson,
  verifyLock = verifyApplicationReleaseLock,
  hashFile = sha256File,
} = {}) {
  const lock = readLock(root, LOCK_PATH)
  verifyLock(lock, root, {requireApproved: true})

  const releaseTarget = target || targetName(platform, arch)
  if (!REQUIRED_TARGETS.includes(releaseTarget)) {
    throw new Error(`Unsupported application release target: ${releaseTarget}`)
  }

  const nodeArtifact = lock.nodeArtifacts.find(
    (artifact) => artifact.target === releaseTarget
  )
  validateArtifact(nodeArtifact, 'node')
  const desktopArtifacts = lock.desktopArtifacts.filter(
    (artifact) => artifact.target === releaseTarget
  )
  desktopArtifacts.forEach((artifact) => validateArtifact(artifact, 'desktop'))

  const nodeFile = `build/node/current/${path.posix.basename(
    nodeArtifact.path
  )}`
  const manifest = readCanonicalJson(
    artifactRoot,
    'build/candidate/manifest.json'
  )
  if (
    manifest.schema !== 1 ||
    manifest.sourceCommit !== lock.candidateSource?.commit ||
    manifest.protectedFilesRoot !== protectedFilesRoot(lock.protectedFiles) ||
    manifest.nodeApprovalStatus !== 'approved' ||
    manifest.applicationReleaseId !== lock.releaseId ||
    manifest.compatibilityReleaseId !== lock.compatibilityReleaseId ||
    manifest.target !== releaseTarget ||
    manifest.nodeSourcePath !== nodeFile ||
    JSON.stringify(manifest.nodeArtifact) !== JSON.stringify(nodeArtifact) ||
    JSON.stringify(manifest.desktopArtifacts) !==
      JSON.stringify(desktopArtifacts)
  ) {
    throw new Error(
      `Candidate manifest does not match approval: ${releaseTarget}`
    )
  }

  const approval = readCanonicalJson(
    artifactRoot,
    'build/node/current/approval.json'
  )
  const stack = readCanonicalJson(root, 'compatibility/stack-lock.json')
  const {version} = readCanonicalJson(root, 'package.json')
  const approvedNode = verifyNodeApproval(
    approval,
    stack,
    version,
    releaseTarget
  )
  if (JSON.stringify(approvedNode) !== JSON.stringify(nodeArtifact)) {
    throw new Error(
      `Candidate node approval does not match release: ${releaseTarget}`
    )
  }
  await checkFile(artifactRoot, nodeFile, nodeArtifact, hashFile)

  const expectedPaths = desktopArtifacts.map((artifact) => artifact.path).sort()
  const actualPaths = uploadableDesktopPaths(artifactRoot)
  if (
    actualPaths.length === 0 ||
    JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)
  ) {
    throw new Error(
      `Release desktop artifact set does not match approval: ${releaseTarget}`
    )
  }
  const artifactsByPath = new Map(
    desktopArtifacts.map((artifact) => [artifact.path, artifact])
  )
  for (const relativePath of actualPaths) {
    await checkFile(
      artifactRoot,
      relativePath,
      artifactsByPath.get(relativePath),
      hashFile
    )
  }

  const stagedDir = path.join(root, STAGED_DIR)
  fs.mkdirSync(path.dirname(stagedDir), {recursive: true})
  fs.mkdirSync(stagedDir)
  for (const relativePath of actualPaths) {
    fs.renameSync(
      path.join(artifactRoot, relativePath),
      path.join(stagedDir, path.posix.basename(relativePath))
    )
  }
  return {target: releaseTarget, files: actualPaths}
}

function parseArgs(argv) {
  if (argv.length === 0) return {}
  if (
    argv.length === 4 &&
    argv[0] === '--target' &&
    argv[2] === '--artifact-root' &&
    REQUIRED_TARGETS.includes(argv[1]) &&
    argv[3]
  ) {
    return {target: argv[1], artifactRoot: path.resolve(argv[3])}
  }
  throw new Error('Expected --target TARGET --artifact-root DIRECTORY')
}

async function main(argv = process.argv.slice(2)) {
  const {target, files} = await verifyAndStageReleaseArtifacts(parseArgs(argv))
  console.log(
    `Verified and staged ${files.length} approved artifacts for ${target}`
  )
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[application-release-artifacts] ${error.message}`)
    process.exit(1)
  })
}

module.exports = {
  parseArgs,
  uploadableDesktopPaths,
  verifyAndStageReleaseArtifacts,
}
