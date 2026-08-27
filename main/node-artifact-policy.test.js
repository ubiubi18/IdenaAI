const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  sha256File,
  verifyBundledNodeArtifact,
} = require('./node-artifact-policy')

describe('bundled node artifact policy', () => {
  let root
  let binaryPath

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'idena-ai-node-artifact-'))
    binaryPath = path.join(root, 'idena-go')
    fs.writeFileSync(binaryPath, Buffer.alloc(1024 * 1024 + 1, 7))
  })

  afterEach(() => {
    fs.rmSync(root, {recursive: true, force: true})
  })

  it('rejects an unapproved release before hashing the executable', async () => {
    const hashFile = jest.fn()
    await expect(
      verifyBundledNodeArtifact(binaryPath, {
        root,
        platform: 'linux',
        arch: 'x64',
        readLock: () => ({status: 'candidate'}),
        verifyLock: () => {
          throw new Error('Application release is not independently approved')
        },
        hashFile,
      })
    ).rejects.toThrow(/not independently approved/u)
    expect(hashFile).not.toHaveBeenCalled()
  })

  it('rejects a substituted node digest', async () => {
    const lock = {
      nodeArtifacts: [
        {
          target: 'linux-x64',
          path: 'node/idena-go',
          sha256: '0'.repeat(64),
          size: fs.statSync(binaryPath).size,
        },
      ],
    }
    await expect(
      verifyBundledNodeArtifact(binaryPath, {
        root,
        platform: 'linux',
        arch: 'x64',
        readLock: () => lock,
        verifyLock: () => {},
      })
    ).rejects.toThrow(/digest does not match/u)
  })

  it('accepts the exact independently approved node artifact', async () => {
    const lock = {
      nodeArtifacts: [
        {
          target: 'linux-x64',
          path: 'node/idena-go',
          sha256: await sha256File(binaryPath),
          size: fs.statSync(binaryPath).size,
        },
      ],
    }
    await expect(
      verifyBundledNodeArtifact(binaryPath, {
        root,
        platform: 'linux',
        arch: 'x64',
        readLock: () => lock,
        verifyLock: () => {},
      })
    ).resolves.toEqual(lock.nodeArtifacts[0])
  })
})
