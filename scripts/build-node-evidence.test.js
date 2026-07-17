const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const lock = require('../compatibility/stack-lock.json')
const {
  compatibilityPins,
  createReport,
  parseArgs,
  reportProvenance,
  verifySourceManifest,
  writeNewJson,
} = require('./build-node-evidence')
const {
  compareBuildReports,
  verifyBuildReport,
  verifyCiProvenance,
} = require('./check-node-build-evidence')

function fileWithSize(dir, name, size, byte) {
  const filePath = path.join(dir, name)
  fs.writeFileSync(filePath, Buffer.alloc(size, byte))
  return filePath
}

function reportFixture(builderId) {
  const components = compatibilityPins()
  const bindingArtifact = 'libidena_wasm_linux_amd64.a'
  const bindingSha256 = lock.artifacts.find(
    (artifact) => artifact.name === bindingArtifact
  ).sha256
  return {
    schema: 1,
    releaseId: lock.releaseId,
    gate: 'independent-rebuild-digest-match',
    status: 'passed',
    completedAt: '2026-07-14T18:00:00Z',
    legacyBaselineCommit: lock.legacyBaseline.commit,
    sourceCommit: components['idena-go'],
    components,
    commands: ['build from fresh sources'],
    results: {
      arch: 'x64',
      binarySha256: 'a'.repeat(64),
      binarySize: 2 * 1024 * 1024,
      bindingArtifact,
      bindingSha256,
      builderId,
      goVersion: `go version go${lock.toolchains.go} linux/amd64`,
      nodeVersion: `v${lock.toolchains.node}`,
      platform: 'linux',
    },
    provenance: {},
  }
}

describe('node build evidence', () => {
  it('parses safe report and builder options', () => {
    const report = path.resolve('build/report.json')
    expect(
      parseArgs(['--builder-id', 'builder-a', '--report', report])
    ).toEqual({builderId: 'builder-a', report})
    expect(() => parseArgs([])).toThrow('--builder-id')
    expect(() => parseArgs(['--builder-id', '../unsafe'])).toThrow(
      'safe characters'
    )
  })

  it('requires source pins to match the compatibility lock', () => {
    const manifest = {
      version: 1,
      sources: Object.entries(compatibilityPins())
        .filter(([name]) => ['idena-go', 'idena-wasm-binding'].includes(name))
        .map(([name, commit]) => ({name, commit})),
    }
    expect(() => verifySourceManifest(manifest)).not.toThrow()
    manifest.sources[0].commit = '0'.repeat(40)
    expect(() => verifySourceManifest(manifest)).toThrow(
      'does not match compatibility lock'
    )

    manifest.sources[0].commit = compatibilityPins()[manifest.sources[0].name]
    const duplicate = {
      ...manifest,
      sources: [manifest.sources[0], {...manifest.sources[0]}],
    }
    expect(() => verifySourceManifest(duplicate)).toThrow(
      'duplicate source names'
    )

    manifest.sources.push({...manifest.sources[0]})
    expect(() => verifySourceManifest(manifest)).toThrow('exactly two')
  })

  it('creates digest-bound reports and refuses overwrite', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'node-evidence-test-'))
    try {
      const binaryPath = fileWithSize(dir, 'idena-go', 1024 * 1024 + 1, 1)
      const bindingPath = fileWithSize(
        dir,
        'libidena_wasm_linux_amd64.a',
        128,
        2
      )
      const report = createReport({
        arch: 'x64',
        binaryPath,
        bindingPath,
        builderId: 'builder-a',
        goVersion: `go version go${lock.toolchains.go} linux/amd64`,
        platform: 'linux',
        provenance: {},
      })
      expect(report.results.binarySha256).toBe(
        crypto
          .createHash('sha256')
          .update(fs.readFileSync(binaryPath))
          .digest('hex')
      )

      const reportPath = path.join(dir, 'report.json')
      writeNewJson(reportPath, report)
      expect(() => writeNewJson(reportPath, report)).toThrow()
    } finally {
      fs.rmSync(dir, {recursive: true, force: true})
    }
  })

  it('compares independent reports and rejects digest drift', () => {
    const first = reportFixture('builder-a')
    const second = reportFixture('builder-b')
    expect(() => verifyBuildReport(first)).not.toThrow()
    expect(compareBuildReports([first, second])).toBe('a'.repeat(64))

    second.results.binarySha256 = 'c'.repeat(64)
    expect(() => compareBuildReports([first, second])).toThrow(
      'differ in binarySha256'
    )

    const wrongBinding = reportFixture('builder-c')
    wrongBinding.results.bindingSha256 = 'd'.repeat(64)
    expect(() => verifyBuildReport(wrongBinding)).toThrow('invalid results')
  })

  it('records only explicit CI provenance fields', () => {
    expect(
      reportProvenance({
        GITHUB_RUN_ID: '123',
        GITHUB_SHA: 'a'.repeat(40),
        SECRET_TOKEN: 'must-not-appear',
      })
    ).toEqual({githubRunId: '123', githubSha: 'a'.repeat(40)})
  })

  it('requires complete matching GitHub run provenance', () => {
    const provenance = {
      githubRepository: 'ubiubi18/IdenaAI',
      githubRunAttempt: '1',
      githubRunId: '123',
      githubSha: 'a'.repeat(40),
      runnerArch: 'X64',
      runnerName: 'runner-a',
      runnerOs: 'Linux',
    }
    const first = reportFixture('builder-a')
    const second = reportFixture('builder-b')
    first.provenance = provenance
    second.provenance = {...provenance, runnerName: 'runner-b'}
    expect(() => verifyCiProvenance([first, second])).not.toThrow()

    second.provenance.githubSha = 'b'.repeat(40)
    expect(() => verifyCiProvenance([first, second])).toThrow(
      'differs in githubSha'
    )
    second.provenance.githubSha = provenance.githubSha
    delete second.provenance.githubSha
    expect(() => verifyCiProvenance([first, second])).toThrow(
      'incomplete provenance'
    )
  })
})
