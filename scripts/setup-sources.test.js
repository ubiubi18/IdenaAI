const path = require('path')
const {parseArgs, sourceFetchRef, sourcePath} = require('./setup-sources')

describe('setup sources script', () => {
  it('parses check, update, and target root options', () => {
    const targetRoot = path.join(path.sep, 'tmp', 'idena-sources')

    expect(
      parseArgs(['--check', '--update', '--target-root', targetRoot])
    ).toEqual({
      check: true,
      update: true,
      targetRoot,
    })
  })

  it('rejects target-root without a value', () => {
    expect(() => parseArgs(['--target-root'])).toThrow(
      '--target-root requires a value'
    )
    expect(() => parseArgs(['--target-root', '--check'])).toThrow(
      '--target-root requires a value'
    )
  })

  it('resolves source paths beneath the requested target root', () => {
    expect(sourcePath({path: 'idena-go'}, path.join(path.sep, 'tmp'))).toBe(
      path.join(path.sep, 'tmp', 'idena-go')
    )
  })

  it('fetches an exact commit instead of a moving branch when available', () => {
    expect(
      sourceFetchRef({commit: 'abc123', ref: 'vibe/clean-modern-fork'})
    ).toBe('abc123')
    expect(sourceFetchRef({ref: 'vibe/clean-modern-fork'})).toBe(
      'vibe/clean-modern-fork'
    )
  })
})
