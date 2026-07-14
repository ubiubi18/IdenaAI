const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const lock = require('../compatibility/stack-lock.json')
const {
  readRegular,
  requireSafeReportPath,
  verifyGateReport,
  verifyPromotionEvidence,
} = require('./check-promotion-evidence')

function digest(value) {
  return crypto
    .createHash('sha256')
    .update(Buffer.from(JSON.stringify(value)))
    .digest('hex')
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
    completedAt: '2026-07-14T18:00:00Z',
    legacyBaselineCommit: lock.legacyBaseline.commit,
    sourceCommit: pins()['idena-go'],
    components: pins(),
    commands: [`verify ${gate}`],
    results: {matched: true},
  }
}

function fixture() {
  const reports = new Map()
  const gates = lock.requiredGates.map((name) => {
    const value = report(name)
    const raw = Buffer.from(JSON.stringify(value))
    const reportPath = `compatibility/reports/${name}.json`
    reports.set(reportPath, raw)
    return {
      name,
      status: 'passed',
      reports: [{path: reportPath, sha256: digest(value)}],
    }
  })

  return {
    evidence: {
      schema: 1,
      releaseId: lock.releaseId,
      legacyBaselineCommit: lock.legacyBaseline.commit,
      sourceCommit: pins()['idena-go'],
      components: pins(),
      gates,
    },
    reports,
  }
}

describe('compatibility promotion evidence', () => {
  it('accepts checksum-bound reports for every required gate', () => {
    const {evidence, reports} = fixture()
    expect(() =>
      verifyPromotionEvidence(lock, evidence, (reportPath) =>
        reports.get(reportPath)
      )
    ).not.toThrow()
  })

  it('rejects missing gates and report tampering', () => {
    const {evidence, reports} = fixture()
    evidence.gates.pop()
    expect(() =>
      verifyPromotionEvidence(lock, evidence, (reportPath) =>
        reports.get(reportPath)
      )
    ).toThrow('incomplete gate set')

    const tampered = fixture()
    const firstPath = tampered.evidence.gates[0].reports[0].path
    tampered.reports.set(firstPath, Buffer.from('{}'))
    expect(() =>
      verifyPromotionEvidence(lock, tampered.evidence, (reportPath) =>
        tampered.reports.get(reportPath)
      )
    ).toThrow('checksum mismatch')
  })

  it('rejects stale component pins and unsafe report paths', () => {
    const {evidence, reports} = fixture()
    evidence.components['idena-go'] = '0'.repeat(40)
    expect(() =>
      verifyPromotionEvidence(lock, evidence, (reportPath) =>
        reports.get(reportPath)
      )
    ).toThrow('component pins')

    for (const unsafePath of [
      '../report.json',
      '/tmp/report.json',
      'compatibility/reports/../report.json',
      'compatibility\\reports\\report.json',
    ]) {
      expect(() => requireSafeReportPath(unsafePath)).toThrow(
        'Unsafe promotion report path'
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

  it('rejects evidence below a symlinked parent directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'promotion-root-'))
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'promotion-outside-'))
    try {
      fs.mkdirSync(path.join(root, 'compatibility'))
      fs.writeFileSync(path.join(outside, 'report.json'), '{}')
      fs.symlinkSync(
        outside,
        path.join(root, 'compatibility', 'reports'),
        process.platform === 'win32' ? 'junction' : 'dir'
      )
      expect(() =>
        readRegular(root, 'compatibility/reports/report.json')
      ).toThrow('without symlinked parents')
    } finally {
      fs.rmSync(root, {recursive: true, force: true})
      fs.rmSync(outside, {recursive: true, force: true})
    }
  })
})
