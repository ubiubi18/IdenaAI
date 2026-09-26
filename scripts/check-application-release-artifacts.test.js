const fs = require('fs')
const os = require('os')
const path = require('path')
const {sha256} = require('../main/application-release-policy')
const {
  verifyAndStageReleaseArtifacts,
} = require('./check-application-release-artifacts')

describe('approved release artifact staging', () => {
  let root
  let lock
  let nodeFile
  let installerFile
  let verifyLock

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'idena-release-artifacts-'))
    nodeFile = path.join(root, 'build/node/current/idena-go')
    installerFile = path.join(root, 'dist/idena-ai-linux-0.1.0.deb')
    fs.mkdirSync(path.dirname(nodeFile), {recursive: true})
    fs.mkdirSync(path.dirname(installerFile), {recursive: true})
    const nodeData = Buffer.alloc(1024 * 1024 + 1, 'n')
    const installerData = Buffer.from('installer')
    fs.writeFileSync(nodeFile, nodeData)
    fs.writeFileSync(installerFile, installerData)
    lock = {
      nodeArtifacts: [
        {
          target: 'linux-x64',
          path: 'node/idena-go',
          sha256: sha256(nodeData),
          size: nodeData.length,
        },
      ],
      desktopArtifacts: [
        {
          target: 'linux-x64',
          path: 'dist/idena-ai-linux-0.1.0.deb',
          sha256: sha256(installerData),
          size: installerData.length,
        },
      ],
    }
    verifyLock = jest.fn()
  })

  afterEach(() => {
    fs.rmSync(root, {recursive: true, force: true})
  })

  function check() {
    return verifyAndStageReleaseArtifacts({
      root,
      platform: 'linux',
      arch: 'x64',
      readLock: () => lock,
      verifyLock,
    })
  }

  it('requires approval and stages only verified publishable files', async () => {
    fs.writeFileSync(path.join(root, 'dist/builder-debug.yml'), 'local only')
    await expect(check()).resolves.toEqual({
      target: 'linux-x64',
      files: ['dist/idena-ai-linux-0.1.0.deb'],
    })
    expect(verifyLock).toHaveBeenCalledWith(lock, root, {
      requireApproved: true,
    })
    expect(
      fs.readFileSync(
        path.join(root, 'build/release-verified/idena-ai-linux-0.1.0.deb'),
        'utf8'
      )
    ).toBe('installer')
    expect(fs.existsSync(installerFile)).toBe(false)
    expect(fs.existsSync(path.join(root, 'dist/builder-debug.yml'))).toBe(true)
  })

  it('stops before reading artifacts when approval is absent', async () => {
    verifyLock.mockImplementation(() => {
      throw new Error('Application release is not independently approved')
    })
    await expect(check()).rejects.toThrow(/not independently approved/u)
    expect(fs.existsSync(installerFile)).toBe(true)
  })

  it('rejects a changed installer digest', async () => {
    fs.writeFileSync(installerFile, 'tampered!')
    await expect(check()).rejects.toThrow(/digest does not match approval/u)
  })

  it('rejects a missing installer', async () => {
    fs.rmSync(installerFile)
    await expect(check()).rejects.toThrow(
      /artifact set does not match approval/u
    )
  })

  it('rejects an unexpected uploadable file', async () => {
    fs.writeFileSync(path.join(root, 'dist/unreviewed.blockmap'), 'unreviewed')
    await expect(check()).rejects.toThrow(
      /artifact set does not match approval/u
    )
  })

  it('rejects a changed bundled node', async () => {
    fs.writeFileSync(nodeFile, Buffer.alloc(1024 * 1024 + 1, 'x'))
    await expect(check()).rejects.toThrow(/digest does not match approval/u)
  })
})
