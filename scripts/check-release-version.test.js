const {verifyReleaseVersion} = require('./check-release-version')

const packageJson = {version: '0.1.0-rc7'}
const packageLock = {
  version: '0.1.0-rc7',
  packages: {'': {version: '0.1.0-rc7'}},
}
const applicationLock = {releaseId: 'idena-ai-0.1.0-rc7'}

describe('release tag version', () => {
  it('accepts only the checked-in version', () => {
    expect(
      verifyReleaseVersion(
        'v0.1.0-rc7',
        packageJson,
        packageLock,
        applicationLock
      )
    ).toBe('0.1.0-rc7')
  })

  it.each([
    ['v0.1.1-rc7', packageJson, packageLock],
    ['v0.1.0-rc7', {version: '0.1.0'}, packageLock],
    ['v0.1.0-rc7', packageJson, {...packageLock, version: '0.1.0'}],
    [
      'v0.1.0-rc7',
      packageJson,
      {...packageLock, packages: {'': {version: '0.1.0'}}},
    ],
    ['not-a-tag', packageJson, packageLock],
  ])('rejects mismatched tag or package version', (tag, pkg, lock) => {
    expect(() =>
      verifyReleaseVersion(tag, pkg, lock, applicationLock)
    ).toThrow()
  })

  it('rejects a tag from another application release candidate', () => {
    expect(() =>
      verifyReleaseVersion('v0.1.0-rc7', packageJson, packageLock, {
        releaseId: 'idena-ai-0.1.0-rc6',
      })
    ).toThrow(/does not match/u)
  })
})
