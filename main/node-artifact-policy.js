const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const {
  readCanonicalJson,
  verifyApplicationReleaseLock,
} = require('./application-release-policy')

const ROOT = path.resolve(__dirname, '..')
const LOCK_PATH = path.join('compatibility', 'application-release-lock.json')

function targetName(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`
}

async function sha256File(filePath) {
  const digest = crypto.createHash('sha256')
  const stream = fs.createReadStream(filePath)
  for await (const chunk of stream) digest.update(chunk)
  return digest.digest('hex')
}

async function verifyBundledNodeArtifact(
  binaryPath,
  {
    root = ROOT,
    platform = process.platform,
    arch = process.arch,
    readLock = readCanonicalJson,
    hashFile = sha256File,
    verifyLock = verifyApplicationReleaseLock,
  } = {}
) {
  const lock = readLock(root, LOCK_PATH)
  verifyLock(lock, root, {requireApproved: true})

  const target = targetName(platform, arch)
  const artifact = lock.nodeArtifacts.find((item) => item.target === target)
  if (!artifact) {
    throw new Error(`No approved bundled node artifact for ${target}`)
  }

  const metadata = await fs.promises.lstat(binaryPath)
  if (
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    metadata.size !== artifact.size
  ) {
    throw new Error('Bundled node artifact metadata does not match approval')
  }

  if ((await hashFile(binaryPath)) !== artifact.sha256) {
    throw new Error('Bundled node artifact digest does not match approval')
  }
  return artifact
}

module.exports = {sha256File, targetName, verifyBundledNodeArtifact}
