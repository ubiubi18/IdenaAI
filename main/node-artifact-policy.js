const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const {
  canonicalJson,
  readCanonicalJson,
  sha256,
  validateArtifact,
} = require('./application-release-policy')

const ROOT = path.resolve(__dirname, '..')

function targetName(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`
}

async function sha256File(filePath) {
  const digest = crypto.createHash('sha256')
  const stream = fs.createReadStream(filePath)
  for await (const chunk of stream) digest.update(chunk)
  return digest.digest('hex')
}

function verifyNodeApproval(approval, stack, applicationVersion, target) {
  if (
    approval?.schema !== 1 ||
    approval.status !== 'approved' ||
    stack.status !== 'approved' ||
    approval.applicationReleaseId !== `idena-ai-${applicationVersion}` ||
    approval.compatibilityReleaseId !== stack.releaseId ||
    approval.stackLockSha256 !== sha256(canonicalJson(stack)) ||
    stack.chainInvariants?.consensusChangesAllowed !== false
  ) {
    throw new Error(
      'Bundled node is not independently approved for this application'
    )
  }
  validateArtifact(approval.nodeArtifact, 'node')
  if (approval.nodeArtifact.target !== target) {
    throw new Error(`No approved bundled node artifact for ${target}`)
  }
  return approval.nodeArtifact
}

async function verifyBundledNodeArtifact(
  binaryPath,
  {
    root = ROOT,
    platform = process.platform,
    arch = process.arch,
    hashFile = sha256File,
  } = {}
) {
  // Source and installer approval stays in the release pipeline. Those inputs
  // are absent or transformed in app.asar, and installer hashes cannot be
  // embedded in the installer whose bytes they describe.
  const approval = readCanonicalJson(path.dirname(binaryPath), 'approval.json')
  const stack = readCanonicalJson(root, 'compatibility/stack-lock.json')
  const {version} = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8')
  )
  const artifact = verifyNodeApproval(
    approval,
    stack,
    version,
    targetName(platform, arch)
  )

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

module.exports = {
  sha256File,
  targetName,
  verifyNodeApproval,
  verifyBundledNodeArtifact,
}
