#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const {
  readCanonicalJson,
  validateArtifact,
  verifyApplicationReleaseLock,
  REQUIRED_TARGETS,
} = require('../main/application-release-policy')
const {sha256File, targetName} = require('../main/node-artifact-policy')

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
  platform = process.platform,
  arch = process.arch,
  readLock = readCanonicalJson,
  verifyLock = verifyApplicationReleaseLock,
  hashFile = sha256File,
} = {}) {
  const lock = readLock(root, LOCK_PATH)
  verifyLock(lock, root, {requireApproved: true})

  const target = targetName(platform, arch)
  if (!REQUIRED_TARGETS.includes(target)) {
    throw new Error(`Unsupported application release target: ${target}`)
  }

  const nodeArtifact = lock.nodeArtifacts.find(
    (artifact) => artifact.target === target
  )
  validateArtifact(nodeArtifact, 'node')
  const nodeFile = `build/node/current/${path.posix.basename(
    nodeArtifact.path
  )}`
  await checkFile(root, nodeFile, nodeArtifact, hashFile)

  const desktopArtifacts = lock.desktopArtifacts.filter(
    (artifact) => artifact.target === target
  )
  desktopArtifacts.forEach((artifact) => validateArtifact(artifact, 'desktop'))
  const expectedPaths = desktopArtifacts.map((artifact) => artifact.path).sort()
  const actualPaths = uploadableDesktopPaths(root)
  if (
    actualPaths.length === 0 ||
    JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)
  ) {
    throw new Error(
      `Release desktop artifact set does not match approval: ${target}`
    )
  }
  const artifactsByPath = new Map(
    desktopArtifacts.map((artifact) => [artifact.path, artifact])
  )
  for (const relativePath of actualPaths) {
    await checkFile(
      root,
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
      path.join(root, relativePath),
      path.join(stagedDir, path.posix.basename(relativePath))
    )
  }
  return {target, files: actualPaths}
}

async function main() {
  const {target, files} = await verifyAndStageReleaseArtifacts()
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

module.exports = {uploadableDesktopPaths, verifyAndStageReleaseArtifacts}
