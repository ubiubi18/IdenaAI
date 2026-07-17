const fs = require('fs')
const os = require('os')
const path = require('path')

const lock = require('../compatibility/stack-lock.json')
const sources = require('./source-manifest.json')
const socialPackage = require('../vendor/idena.social-ui/package.json')
const socialLock = require('../vendor/idena.social-ui/package-lock.json')
const {
  parseArgs,
  readCanonicalJson,
  requireApproved,
  verifyCompatibilityLock,
} = require('./check-compatibility-lock')

const runnerGoMod = fs.readFileSync(
  path.join(
    __dirname,
    '..',
    'vendor',
    'idena.social-contract',
    'test-contract-runner',
    'go.mod'
  ),
  'utf8'
)

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

describe('IdenaAI compatibility lock', () => {
  it('pins all embedded chain consumers to the reviewed stack', () => {
    expect(() =>
      verifyCompatibilityLock(
        lock,
        sources,
        socialPackage,
        socialLock,
        runnerGoMod
      )
    ).not.toThrow()
  })

  it('rejects node source drift', () => {
    const changed = clone(sources)
    changed.sources[0].commit = '0'.repeat(40)
    expect(() =>
      verifyCompatibilityLock(
        lock,
        changed,
        socialPackage,
        socialLock,
        runnerGoMod
      )
    ).toThrow('idena-go does not match the desktop compatibility pin')
  })

  it('rejects embedded SDK drift', () => {
    const changed = clone(socialPackage)
    changed.dependencies['idena-sdk-js-lite'] = '^0.0.1'
    expect(() =>
      verifyCompatibilityLock(lock, sources, changed, socialLock, runnerGoMod)
    ).toThrow('Embedded social UI SDK drifted from the compatibility lock')
  })

  it('rejects a different contract-runner binding', () => {
    const bindingCommit =
      lock.consumerPins['idena-social-contract-runner']['idena-wasm-binding']
    const changed = runnerGoMod.replace(
      bindingCommit.slice(0, 12),
      '0'.repeat(12)
    )
    expect(() =>
      verifyCompatibilityLock(lock, sources, socialPackage, socialLock, changed)
    ).toThrow('Embedded contract runner does not require the locked binding')
  })

  it('rejects a lock that permits consensus changes', () => {
    const changed = clone(lock)
    changed.chainInvariants.consensusChangesAllowed = true
    expect(() =>
      verifyCompatibilityLock(
        changed,
        sources,
        socialPackage,
        socialLock,
        runnerGoMod
      )
    ).toThrow('Compatibility lock changed a legacy-chain invariant')
  })

  it('rejects a missing differential promotion gate', () => {
    const changed = clone(lock)
    changed.requiredGates = changed.requiredGates.filter(
      (gate) => gate !== 'legacy-modern-p2p-interoperability'
    )
    expect(() =>
      verifyCompatibilityLock(
        changed,
        sources,
        socialPackage,
        socialLock,
        runnerGoMod
      )
    ).toThrow('Compatibility lock changed the required promotion gates')
  })

  it('rejects unreviewed toolchain drift', () => {
    const changed = clone(lock)
    changed.toolchains.rust = 'nightly'
    expect(() =>
      verifyCompatibilityLock(
        changed,
        sources,
        socialPackage,
        socialLock,
        runnerGoMod
      )
    ).toThrow('Compatibility lock changed the reviewed toolchain set')
  })

  it('blocks releases while the compatibility stack is a candidate', () => {
    expect(parseArgs(['--require-approved'])).toEqual({
      requireApproved: true,
    })
    expect(() => requireApproved(lock)).toThrow(
      'release promotion gates have not been completed'
    )
    expect(() => parseArgs(['--unknown'])).toThrow('Unknown argument')
  })

  it('requires pinned evidence before accepting an approved stack', () => {
    const approved = clone(lock)
    approved.status = 'approved'
    approved.gateResults = Object.fromEntries(
      approved.requiredGates.map((gate) => [
        gate,
        {
          status: 'passed',
          evidence: `compatibility/evidence/${gate}.json`,
          sha256: '0'.repeat(64),
        },
      ])
    )
    const verifyEvidence = jest.fn()

    expect(() =>
      verifyCompatibilityLock(
        approved,
        sources,
        socialPackage,
        socialLock,
        runnerGoMod
      )
    ).not.toThrow()
    expect(() => requireApproved(approved, verifyEvidence)).not.toThrow()
    expect(verifyEvidence).toHaveBeenCalledWith(approved)
  })

  it('rejects approval without results for every required gate', () => {
    const approved = clone(lock)
    approved.status = 'approved'
    expect(() =>
      verifyCompatibilityLock(
        approved,
        sources,
        socialPackage,
        socialLock,
        runnerGoMod
      )
    ).toThrow('incomplete gate results')
  })

  it('rejects duplicate lock keys through canonical JSON enforcement', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'stack-lock-'))
    try {
      const lockPath = path.join(temporary, 'stack-lock.json')
      fs.writeFileSync(lockPath, '{"schema":1,"schema":1}\n')
      expect(() => readCanonicalJson(lockPath)).toThrow('canonical JSON')
    } finally {
      fs.rmSync(temporary, {recursive: true, force: true})
    }
  })
})
