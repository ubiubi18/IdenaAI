const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const lock = require('../compatibility/stack-lock.json')
const {
  readRegular,
  requireSafeEvidencePath,
  verifyGateReport,
  verifyGateResults,
} = require('./check-promotion-evidence')

function encode(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
}

function digest(value) {
  return crypto.createHash('sha256').update(encode(value)).digest('hex')
}

function pins() {
  return Object.fromEntries(
    lock.components.map((component) => [component.name, component.commit])
  )
}

function report(gate) {
  return {
    schema: 1,
    releaseId: lock.releaseId,
    gate,
    status: 'passed',
    completedAt: '2026-07-17T18:00:00Z',
    legacyBaselineCommit: lock.legacyBaseline.commit,
    sourceCommit: pins()['idena-go'],
    components: pins(),
    commands: [`verify ${gate}`],
    results: {matched: true},
  }
}

function fixture() {
  const evidence = new Map()
  const gateResults = Object.fromEntries(
    lock.requiredGates.map((gate) => {
      const value = report(gate)
      const raw = encode(value)
      const evidencePath = `compatibility/evidence/${gate}.json`
      evidence.set(evidencePath, raw)
      return [
        gate,
        {status: 'passed', evidence: evidencePath, sha256: digest(value)},
      ]
    })
  )
  return {approved: {...lock, status: 'approved', gateResults}, evidence}
}

describe('compatibility gate evidence', () => {
  it('accepts checksum-bound evidence for every required gate', () => {
    const {approved, evidence} = fixture()
    expect(() =>
      verifyGateResults(approved, (evidencePath) => evidence.get(evidencePath))
    ).not.toThrow()
  })

  it('rejects missing gates and evidence tampering', () => {
    const missing = fixture()
    delete missing.approved.gateResults[lock.requiredGates[0]]
    expect(() =>
      verifyGateResults(missing.approved, (evidencePath) =>
        missing.evidence.get(evidencePath)
      )
    ).toThrow('incomplete gate set')

    const tampered = fixture()
    const firstPath =
      tampered.approved.gateResults[lock.requiredGates[0]].evidence
    tampered.evidence.set(firstPath, Buffer.from('{}'))
    expect(() =>
      verifyGateResults(tampered.approved, (evidencePath) =>
        tampered.evidence.get(evidencePath)
      )
    ).toThrow('checksum mismatch')
  })

  it('rejects stale component pins and unsafe evidence paths', () => {
    const stale = fixture()
    const firstPath = stale.approved.gateResults[lock.requiredGates[0]].evidence
    const value = JSON.parse(stale.evidence.get(firstPath).toString('utf8'))
    value.components['idena-go'] = '0'.repeat(40)
    stale.evidence.set(firstPath, encode(value))
    stale.approved.gateResults[lock.requiredGates[0]].sha256 = digest(value)
    expect(() =>
      verifyGateResults(stale.approved, (evidencePath) =>
        stale.evidence.get(evidencePath)
      )
    ).toThrow('component pins')

    for (const unsafePath of [
      '../evidence.json',
      '/tmp/evidence.json',
      'compatibility/evidence/../evidence.json',
      'compatibility\\evidence\\evidence.json',
    ]) {
      expect(() => requireSafeEvidencePath(unsafePath)).toThrow(
        'Unsafe gate evidence path'
      )
    }
  })

  it('rejects impossible completion timestamps', () => {
    const value = report(lock.requiredGates[0])
    value.completedAt = '2026-02-30T18:00:00Z'
    expect(() => verifyGateReport(lock, value.gate, value)).toThrow(
      'invalid completion timestamp'
    )
  })

  it('rejects duplicate evidence keys', () => {
    const duplicate = fixture()
    const firstGate = lock.requiredGates[0]
    const firstPath = duplicate.approved.gateResults[firstGate].evidence
    const raw = Buffer.from('{"schema":1,"schema":1}\n')
    duplicate.evidence.set(firstPath, raw)
    duplicate.approved.gateResults[firstGate].sha256 = crypto
      .createHash('sha256')
      .update(raw)
      .digest('hex')
    expect(() =>
      verifyGateResults(duplicate.approved, (evidencePath) =>
        duplicate.evidence.get(evidencePath)
      )
    ).toThrow('canonical JSON')
  })

  it('rejects evidence below a symlinked parent directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-root-'))
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-outside-'))
    try {
      fs.mkdirSync(path.join(root, 'compatibility'))
      fs.writeFileSync(path.join(outside, 'evidence.json'), '{}')
      fs.symlinkSync(
        outside,
        path.join(root, 'compatibility', 'evidence'),
        process.platform === 'win32' ? 'junction' : 'dir'
      )
      expect(() =>
        readRegular(root, 'compatibility/evidence/evidence.json')
      ).toThrow('without symlinked parents')
    } finally {
      fs.rmSync(root, {recursive: true, force: true})
      fs.rmSync(outside, {recursive: true, force: true})
    }
  })
})
