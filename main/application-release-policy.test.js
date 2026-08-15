const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  REQUIRED_PROTECTED_FILES,
  REQUIRED_TARGETS,
  canonicalJson,
  protectedFileDigests,
  protectedFilesRoot,
  sha256,
  verifyApplicationReleaseLock,
} = require('./application-release-policy')

function createRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'idena-ai-release-lock-'))
  for (const relativePath of REQUIRED_PROTECTED_FILES) {
    const filePath = path.join(root, relativePath)
    fs.mkdirSync(path.dirname(filePath), {recursive: true})
    fs.writeFileSync(filePath, `${relativePath}\n`)
  }
  return root
}

function candidateLock(root) {
  return {
    schema: 1,
    releaseId: 'idena-ai-0.1.0-test',
    status: 'candidate',
    compatibilityReleaseId: 'idena-mainnet-legacy-compat-2026.07.17-rc7',
    consensusChangesAllowed: false,
    protectedFiles: protectedFileDigests(root),
    requiredTargets: [...REQUIRED_TARGETS],
    nodeArtifacts: [],
    desktopArtifacts: [],
    verifierEvidence: [],
  }
}

function approveLock(root, lock) {
  lock.status = 'approved'
  lock.nodeArtifacts = REQUIRED_TARGETS.map((target) => ({
    target,
    path: target === 'win32-x64' ? 'node/idena-go.exe' : 'node/idena-go',
    sha256: sha256(`node-${target}`),
    size: 2 * 1024 * 1024,
  }))
  lock.desktopArtifacts = REQUIRED_TARGETS.map((target) => ({
    target,
    path: `dist/idena-ai-${target}.artifact`,
    sha256: sha256(`desktop-${target}`),
    size: 4096,
  }))
  const protectedRoot = protectedFilesRoot(lock.protectedFiles)
  lock.verifierEvidence = []

  for (const target of REQUIRED_TARGETS) {
    for (let index = 1; index <= 2; index += 1) {
      const evidence = {
        schema: 1,
        releaseId: lock.releaseId,
        target,
        verifierId: `${target}-verifier-${index}`,
        protectedFilesRoot: protectedRoot,
        nodeArtifact: lock.nodeArtifacts.find((item) => item.target === target),
        desktopArtifacts: lock.desktopArtifacts.filter(
          (item) => item.target === target
        ),
        commands: ['npm ci', 'npm run release:check'],
      }
      const relativePath = `compatibility/application-evidence/${target}-${index}.json`
      const raw = canonicalJson(evidence)
      const filePath = path.join(root, relativePath)
      fs.mkdirSync(path.dirname(filePath), {recursive: true})
      fs.writeFileSync(filePath, raw)
      lock.verifierEvidence.push({
        target,
        path: relativePath,
        sha256: sha256(raw),
      })
    }
  }
  return lock
}

describe('application release lock', () => {
  let root

  beforeEach(() => {
    root = createRoot()
  })

  afterEach(() => {
    fs.rmSync(root, {recursive: true, force: true})
  })

  it('accepts a candidate while production approval remains closed', () => {
    const lock = candidateLock(root)
    expect(() => verifyApplicationReleaseLock(lock, root)).not.toThrow()
    expect(() =>
      verifyApplicationReleaseLock(lock, root, {requireApproved: true})
    ).toThrow(/not independently approved/u)
  })

  it('rejects protected dependency or build input drift', () => {
    const lock = candidateLock(root)
    fs.appendFileSync(path.join(root, 'package-lock.json'), 'tampered\n')
    expect(() => verifyApplicationReleaseLock(lock, root)).toThrow(
      /protected files do not match/u
    )
  })

  it('accepts approval only with complete artifacts and two verifiers per target', () => {
    const lock = approveLock(root, candidateLock(root))
    expect(() =>
      verifyApplicationReleaseLock(lock, root, {requireApproved: true})
    ).not.toThrow()

    lock.verifierEvidence.pop()
    expect(() =>
      verifyApplicationReleaseLock(lock, root, {requireApproved: true})
    ).toThrow(/lacks two verifiers/u)
  })
})
