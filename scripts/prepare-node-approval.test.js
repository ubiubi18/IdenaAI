const {approvedNodeDigest} = require('./prepare-node-approval')

describe('approved node rebuild digests', () => {
  const report = () => ({
    releaseArtifacts: [
      'linux-x64',
      'linux-arm64',
      'windows-x64',
      'macos-x64',
      'macos-arm64',
    ].map((platform, index) => ({platform, sha256: String(index).repeat(64)})),
  })

  it.each([
    ['linux-x64', '0'],
    ['win32-x64', '2'],
    ['darwin-arm64', '4'],
  ])('maps the approved platform for %s', (target, digest) => {
    expect(approvedNodeDigest(report(), target)).toBe(digest.repeat(64))
  })

  it('rejects an incomplete independent rebuild set', () => {
    const value = report()
    value.releaseArtifacts.pop()
    expect(() => approvedNodeDigest(value, 'linux-x64')).toThrow(/all five/u)
  })

  it('rejects duplicate platforms or an invalid digest', () => {
    const value = report()
    value.releaseArtifacts[1].platform = 'linux-x64'
    expect(() => approvedNodeDigest(value, 'linux-x64')).toThrow(/all five/u)
    value.releaseArtifacts[1].platform = 'linux-arm64'
    value.releaseArtifacts[0].sha256 = 'invalid'
    expect(() => approvedNodeDigest(value, 'linux-x64')).toThrow(/all five/u)
  })
})
