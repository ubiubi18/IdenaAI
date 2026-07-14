const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  copyStagedOutput,
  hasExplicitOutputDirectory,
  shouldStageBuilderOutput,
} = require('./run-electron-builder')

describe('electron builder output staging', () => {
  it('stages macOS output when the checkout path is shell-unsafe', () => {
    const unsafeRoot = path.join('/tmp', 'idena-go & desktop')

    expect(shouldStageBuilderOutput(['--mac'], unsafeRoot, 'darwin')).toBe(true)
    expect(shouldStageBuilderOutput(['--linux'], unsafeRoot, 'darwin')).toBe(
      false
    )
    expect(shouldStageBuilderOutput(['--mac'], '/tmp/idena-go', 'darwin')).toBe(
      false
    )
  })

  it('preserves an explicitly configured output directory', () => {
    expect(
      hasExplicitOutputDirectory(['-c.directories.output=/tmp/custom'])
    ).toBe(true)
    expect(
      shouldStageBuilderOutput(
        ['--mac', '--config.directories.output=/tmp/custom'],
        '/tmp/idena & desktop',
        'darwin'
      )
    ).toBe(false)
  })

  it('replaces stale local output with the staged build', () => {
    const fixtureRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'idena-builder-output-test-')
    )
    const stagedOutput = path.join(fixtureRoot, 'staged')
    const destination = path.join(fixtureRoot, 'dist')

    try {
      fs.mkdirSync(stagedOutput)
      fs.mkdirSync(destination)
      fs.writeFileSync(path.join(stagedOutput, 'artifact.txt'), 'current\n')
      fs.symlinkSync('artifact.txt', path.join(stagedOutput, 'artifact-link'))
      fs.writeFileSync(path.join(destination, 'stale.txt'), 'stale\n')

      copyStagedOutput(stagedOutput, destination)

      expect(
        fs.readFileSync(path.join(destination, 'artifact.txt'), 'utf8')
      ).toBe('current\n')
      expect(fs.readlinkSync(path.join(destination, 'artifact-link'))).toBe(
        'artifact.txt'
      )
      expect(fs.existsSync(path.join(destination, 'stale.txt'))).toBe(false)
    } finally {
      fs.rmSync(fixtureRoot, {recursive: true, force: true})
    }
  })
})
