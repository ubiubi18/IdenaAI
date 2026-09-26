const lock = require('../compatibility/stack-lock.json')
const {bindingLibName} = require('./build-node-from-sources')
const {approvedNodeDigest} = require('./prepare-node-approval')

function report() {
  const components = Object.fromEntries(
    lock.components.map((item) => [item.name, item.commit])
  )
  return {
    releaseArtifacts: [
      'linux-x64',
      'linux-arm64',
      'windows-x64',
      'macos-x64',
      'macos-arm64',
    ].map((platform) => ({platform, sha256: 'b'.repeat(64)})),
    results: {
      applicationNodeBuilds: ['linux-x64', 'win32-x64', 'darwin-arm64'].flatMap(
        (target) => {
          const [platform, arch] = target.split('-')
          const bindingArtifact = bindingLibName(platform, arch)
          return ['builder-a', 'builder-b'].map((builderId) => ({
            schema: 1,
            releaseId: lock.releaseId,
            gate: 'independent-rebuild-digest-match',
            status: 'passed',
            completedAt: '2026-09-26T12:00:00Z',
            legacyBaselineCommit: lock.legacyBaseline.commit,
            sourceCommit: components['idena-go'],
            components,
            commands: ['build from fresh desktop sources'],
            results: {
              platform,
              arch,
              builderId,
              binarySha256: 'a'.repeat(64),
              binarySize: 2 * 1024 * 1024,
              bindingArtifact,
              bindingSha256: lock.artifacts.find(
                (item) => item.name === bindingArtifact
              ).sha256,
              goVersion: `go version go${lock.toolchains.go} ${
                platform === 'win32' ? 'windows' : platform
              }/${arch === 'x64' ? 'amd64' : arch}`,
              nodeVersion: `v${lock.toolchains.node}`,
            },
          }))
        }
      ),
    },
  }
}

describe('approved desktop node rebuild digests', () => {
  it.each(['linux-x64', 'win32-x64', 'darwin-arm64'])(
    'uses matching desktop rebuilds for %s, not standalone release bytes',
    (target) => {
      expect(approvedNodeDigest(report(), target, lock)).toBe('a'.repeat(64))
    }
  )
  it('rejects incomplete standalone platform evidence', () => {
    const value = report()
    value.releaseArtifacts.pop()
    expect(() => approvedNodeDigest(value, 'linux-x64', lock)).toThrow(
      /all five/u
    )
  })
  it('rejects absent or single-builder desktop evidence', () => {
    const value = report()
    delete value.results.applicationNodeBuilds
    expect(() => approvedNodeDigest(value, 'linux-x64', lock)).toThrow(
      /desktop node build reports/u
    )
    value.results.applicationNodeBuilds = [
      report().results.applicationNodeBuilds[0],
    ]
    expect(() => approvedNodeDigest(value, 'linux-x64', lock)).toThrow(
      /two independent/u
    )
  })
  it('rejects mismatching desktop rebuilds and reused builder identities', () => {
    const value = report()
    value.results.applicationNodeBuilds[1].results.binarySha256 = 'c'.repeat(64)
    expect(() => approvedNodeDigest(value, 'linux-x64', lock)).toThrow(
      /differ/u
    )
    value.results.applicationNodeBuilds[1].results.binarySha256 = 'a'.repeat(64)
    value.results.applicationNodeBuilds[1].results.builderId = 'builder-a'
    expect(() => approvedNodeDigest(value, 'linux-x64', lock)).toThrow(/reuse/u)
  })
})
