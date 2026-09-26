const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  canonicalJson,
  protectedFilesRoot,
  sha256,
} = require('../main/application-release-policy')
const {
  parseArgs,
  verifyAndStageReleaseArtifacts,
} = require('./check-application-release-artifacts')

describe('approved release artifact staging', () => {
  let root
  let artifactRoot
  let lock
  let manifest
  let approval
  let nodeFile
  let installerFile
  let verifyLock

  function writeJson(relativePath, data, base = artifactRoot) {
    const file = path.join(base, relativePath)
    fs.mkdirSync(path.dirname(file), {recursive: true})
    fs.writeFileSync(file, canonicalJson(data))
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'idena-release-artifacts-'))
    artifactRoot = path.join(root, 'candidate-input')
    nodeFile = path.join(artifactRoot, 'build/node/current/idena-go')
    installerFile = path.join(artifactRoot, 'dist/idena-ai-linux-0.1.0.deb')
    fs.mkdirSync(path.dirname(nodeFile), {recursive: true})
    fs.mkdirSync(path.dirname(installerFile), {recursive: true})
    const nodeData = Buffer.alloc(1024 * 1024 + 1, 'n')
    const installerData = Buffer.from('installer')
    fs.writeFileSync(nodeFile, nodeData)
    fs.writeFileSync(installerFile, installerData)
    const stack = {
      releaseId: 'approved-stack',
      status: 'approved',
      chainInvariants: {consensusChangesAllowed: false},
    }
    writeJson('compatibility/stack-lock.json', stack, root)
    writeJson('package.json', {version: '0.1.0'}, root)
    lock = {
      releaseId: 'idena-ai-0.1.0',
      compatibilityReleaseId: stack.releaseId,
      candidateSource: {runId: '123456789', commit: 'a'.repeat(40)},
      protectedFiles: {'scripts/check-candidate-run.js': 'b'.repeat(64)},
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
    manifest = {
      schema: 1,
      sourceCommit: lock.candidateSource.commit,
      protectedFilesRoot: protectedFilesRoot(lock.protectedFiles),
      nodeApprovalStatus: 'approved',
      applicationReleaseId: lock.releaseId,
      compatibilityReleaseId: lock.compatibilityReleaseId,
      target: 'linux-x64',
      nodeSourcePath: 'build/node/current/idena-go',
      nodeArtifact: lock.nodeArtifacts[0],
      desktopArtifacts: lock.desktopArtifacts,
    }
    approval = {
      schema: 1,
      applicationReleaseId: lock.releaseId,
      compatibilityReleaseId: lock.compatibilityReleaseId,
      stackLockSha256: sha256(canonicalJson(stack)),
      status: 'approved',
      nodeArtifact: lock.nodeArtifacts[0],
    }
    writeJson('build/candidate/manifest.json', manifest)
    writeJson('build/node/current/approval.json', approval)
    verifyLock = jest.fn()
  })

  afterEach(() => {
    fs.rmSync(root, {recursive: true, force: true})
  })

  function check(target = 'linux-x64') {
    return verifyAndStageReleaseArtifacts({
      root,
      artifactRoot,
      target,
      readLock: () => lock,
      verifyLock,
    })
  }

  it('requires approval and stages only verified publishable files', async () => {
    fs.writeFileSync(
      path.join(artifactRoot, 'dist/builder-debug.yml'),
      'local only'
    )
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
    expect(
      fs.existsSync(path.join(artifactRoot, 'dist/builder-debug.yml'))
    ).toBe(true)
  })

  it('stops before reading artifacts when approval is absent', async () => {
    verifyLock.mockImplementation(() => {
      throw new Error('Application release is not independently approved')
    })
    await expect(check()).rejects.toThrow(/not independently approved/u)
    expect(fs.existsSync(installerFile)).toBe(true)
  })

  it.each([
    ['sourceCommit', 'c'.repeat(40)],
    ['protectedFilesRoot', 'c'.repeat(64)],
    ['nodeApprovalStatus', 'candidate'],
    ['applicationReleaseId', 'other-release'],
  ])('rejects candidate manifest %s mismatch', async (field, value) => {
    writeJson('build/candidate/manifest.json', {...manifest, [field]: value})
    await expect(check()).rejects.toThrow(/manifest does not match/u)
  })

  it('rejects a candidate node without approved status', async () => {
    writeJson('build/node/current/approval.json', {
      ...approval,
      status: 'candidate',
    })
    await expect(check()).rejects.toThrow(/not independently approved/u)
  })

  it('rejects a candidate node approved against another stack', async () => {
    writeJson('build/node/current/approval.json', {
      ...approval,
      stackLockSha256: 'c'.repeat(64),
    })
    await expect(check()).rejects.toThrow(/not independently approved/u)
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
    fs.writeFileSync(
      path.join(artifactRoot, 'dist/unreviewed.blockmap'),
      'extra'
    )
    await expect(check()).rejects.toThrow(
      /artifact set does not match approval/u
    )
  })

  it('rejects a changed bundled node', async () => {
    fs.writeFileSync(nodeFile, Buffer.alloc(1024 * 1024 + 1, 'x'))
    await expect(check()).rejects.toThrow(/digest does not match approval/u)
  })

  it('accepts an explicit non-native target', async () => {
    const windowsNode = {
      ...lock.nodeArtifacts[0],
      target: 'win32-x64',
      path: 'node/idena-go.exe',
    }
    const windowsDesktop = {
      ...lock.desktopArtifacts[0],
      target: 'win32-x64',
      path: 'dist/idena-ai-win-0.1.0.exe',
    }
    fs.renameSync(nodeFile, `${nodeFile}.exe`)
    fs.renameSync(installerFile, path.join(artifactRoot, windowsDesktop.path))
    lock.nodeArtifacts = [windowsNode]
    lock.desktopArtifacts = [windowsDesktop]
    writeJson('build/candidate/manifest.json', {
      ...manifest,
      target: 'win32-x64',
      nodeSourcePath: 'build/node/current/idena-go.exe',
      nodeArtifact: windowsNode,
      desktopArtifacts: [windowsDesktop],
    })
    writeJson('build/node/current/approval.json', {
      ...approval,
      nodeArtifact: windowsNode,
    })
    await expect(check('win32-x64')).resolves.toEqual({
      target: 'win32-x64',
      files: [windowsDesktop.path],
    })
  })

  it('accepts only the explicit target and artifact root CLI form', () => {
    expect(
      parseArgs(['--target', 'win32-x64', '--artifact-root', artifactRoot])
    ).toEqual({target: 'win32-x64', artifactRoot})
    expect(() =>
      parseArgs(['--target', 'other', '--artifact-root', artifactRoot])
    ).toThrow(/Expected/u)
  })
})
