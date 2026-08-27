const semver = require('semver')

const packageJson = require('../package.json')
const packageLock = require('../package-lock.json')

describe('dependency security locks', () => {
  test('every installed sharp package includes the libvips security fixes', () => {
    const sharpPackages = Object.entries(packageLock.packages || {}).filter(
      ([packagePath]) =>
        packagePath === 'node_modules/sharp' ||
        packagePath.endsWith('/node_modules/sharp')
    )

    expect(sharpPackages.length).toBeGreaterThan(0)
    expect(packageJson.overrides.sharp).toBe('0.35.3')

    for (const [packagePath, metadata] of sharpPackages) {
      expect({packagePath, version: metadata.version}).toEqual(
        expect.objectContaining({
          version: expect.stringMatching(/^0\.35\./),
        })
      )
      expect(semver.gte(metadata.version, '0.35.3')).toBe(true)
    }

    expect(packageJson.allowScripts['sharp@0.35.3']).toBe(true)
  })
})
