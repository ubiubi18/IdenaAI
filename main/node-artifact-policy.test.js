const fs = require('fs')
const os = require('os')
const path = require('path')
const {canonicalJson, sha256} = require('./application-release-policy')
const {
  sha256File,
  verifyBundledNodeArtifact,
} = require('./node-artifact-policy')

describe('packaged bundled node approval', () => {
  let root
  let binaryPath
  let stack
  let approval

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'idena-ai-node-artifact-'))
    binaryPath = path.join(root, 'node/idena-go')
    fs.mkdirSync(path.dirname(binaryPath))
    fs.mkdirSync(path.join(root, 'compatibility'))
    fs.writeFileSync(binaryPath, Buffer.alloc(1024 * 1024 + 1, 7))
    // Deliberately no source lock, workflows, dependency lockfile, or vendor
    // sources. package.json has Electron Builder's reduced packaged shape.
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({
        name: 'idena-ai',
        version: '0.1.0-rc7',
        main: 'main/index.js',
      })
    )
    stack = {
      status: 'approved',
      releaseId: 'test-stack',
      chainInvariants: {consensusChangesAllowed: false},
    }
    approval = {
      schema: 1,
      applicationReleaseId: 'idena-ai-0.1.0-rc7',
      compatibilityReleaseId: stack.releaseId,
      stackLockSha256: sha256(canonicalJson(stack)),
      status: 'approved',
      nodeArtifact: {
        target: 'linux-x64',
        path: 'node/idena-go',
        sha256: await sha256File(binaryPath),
        size: fs.statSync(binaryPath).size,
      },
    }
  })

  afterEach(() => fs.rmSync(root, {recursive: true, force: true}))

  function check(options = {}) {
    fs.writeFileSync(
      path.join(root, 'compatibility/stack-lock.json'),
      canonicalJson(stack)
    )
    fs.writeFileSync(
      path.join(root, 'node/approval.json'),
      canonicalJson(approval)
    )
    return verifyBundledNodeArtifact(binaryPath, {
      root,
      platform: 'linux',
      arch: 'x64',
      ...options,
    })
  }

  it('accepts an exact approved node without source-only files or installer hashes', async () => {
    await expect(check()).resolves.toEqual(approval.nodeArtifact)
  })

  it.each(['node', 'stack'])(
    'rejects a candidate %s before hashing the executable',
    async (part) => {
      if (part === 'node') approval.status = 'candidate'
      else stack.status = 'candidate'
      const hashFile = jest.fn()
      await expect(check({hashFile})).rejects.toThrow(
        /not independently approved/u
      )
      expect(hashFile).not.toHaveBeenCalled()
    }
  )

  it('rejects a substituted node digest', async () => {
    fs.writeFileSync(binaryPath, Buffer.alloc(1024 * 1024 + 1, 8))
    await expect(check()).rejects.toThrow(/digest does not match/u)
  })

  it('rejects a different compatibility stack', async () => {
    stack.releaseId = 'other-stack'
    await expect(check()).rejects.toThrow(/not independently approved/u)
  })

  it('rejects wrong application version and platform approvals', async () => {
    approval.applicationReleaseId = 'idena-ai-0.0.1'
    await expect(check()).rejects.toThrow(/not independently approved/u)
    approval.applicationReleaseId = 'idena-ai-0.1.0-rc7'
    approval.nodeArtifact.target = 'darwin-arm64'
    await expect(check()).rejects.toThrow(/No approved bundled node/u)
  })
})
