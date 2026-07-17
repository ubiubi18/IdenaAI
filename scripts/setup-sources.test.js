const fs = require('fs')
const os = require('os')
const path = require('path')
const {execFileSync} = require('child_process')
const {
  parseArgs,
  sourceFetchRef,
  sourcePath,
  requireGitCheckout,
  verifyGitCheckout,
} = require('./setup-sources')

function git(cwd, args) {
  return execFileSync('git', args, {cwd, encoding: 'utf8'}).trim()
}

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

  it('rejects modified or untracked files in a pinned source checkout', () => {
    const sourceDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'idena-source-verification-')
    )

    try {
      git(sourceDir, ['init', '--initial-branch=main'])
      fs.writeFileSync(path.join(sourceDir, 'go.mod'), 'module example.test\n')
      git(sourceDir, ['add', 'go.mod'])
      git(sourceDir, [
        '-c',
        'user.name=Idena Test',
        '-c',
        'user.email=idena-test@example.invalid',
        'commit',
        '-m',
        'fixture',
      ])

      const source = {
        name: 'idena-go',
        commit: git(sourceDir, ['rev-parse', 'HEAD']),
        requiredFiles: ['go.mod'],
      }
      expect(() => verifyGitCheckout(source, sourceDir)).not.toThrow()

      fs.appendFileSync(path.join(sourceDir, 'go.mod'), '\n// modified\n')
      expect(() => verifyGitCheckout(source, sourceDir)).toThrow(
        'source checkout has uncommitted changes'
      )

      git(sourceDir, ['checkout', '--', 'go.mod'])
      fs.writeFileSync(path.join(sourceDir, 'untracked.txt'), 'untrusted\n')
      expect(() => verifyGitCheckout(source, sourceDir)).toThrow(
        'source checkout has uncommitted changes'
      )
    } finally {
      fs.rmSync(sourceDir, {recursive: true, force: true})
    }
  })

  it('rejects plain source directories that have no verifiable commit', () => {
    const sourceDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'idena-plain-source-')
    )

    try {
      fs.writeFileSync(path.join(sourceDir, 'go.mod'), 'module example.test\n')
      expect(() => requireGitCheckout({name: 'idena-go'}, sourceDir)).toThrow(
        'is not a verifiable Git checkout'
      )
    } finally {
      fs.rmSync(sourceDir, {recursive: true, force: true})
    }
  })
})
