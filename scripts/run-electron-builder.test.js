const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  candidateBuildArgs,
  nonPublishingBuildArgs,
  copyStagedOutput,
  hasExplicitOutputDirectory,
  requiresApprovedRelease,
  shouldStageBuilderOutput,
} = require('./run-electron-builder')

describe('electron builder output staging', () => {
  it('blocks distributable installers until application release approval', () => {
    expect(requiresApprovedRelease(['--mac', '--publish', 'never'])).toBe(true)
    expect(requiresApprovedRelease(['--dir', '--mac'])).toBe(false)
    expect(candidateBuildArgs(['--mac', '--publish', 'never'])).toBeNull()
  })

  it.each([
    ['darwin', 'arm64', '--mac', '--arm64'],
    ['linux', 'x64', '--linux', '--x64'],
    ['win32', 'x64', '--win', '--x64'],
  ])(
    'restricts %s/%s candidate packaging to unpublished native artifacts',
    (platform, arch, platformFlag, archFlag) => {
      expect(
        candidateBuildArgs(
          ['--candidate', platformFlag, archFlag],
          platform,
          arch
        )
      ).toEqual([platformFlag, archFlag, '--publish', 'never'])
      expect(
        candidateBuildArgs(
          ['--candidate', platformFlag, archFlag, '-p=never'],
          platform,
          arch
        )
      ).toEqual([platformFlag, archFlag, '--publish', 'never'])
    }
  )

  it.each([
    ['--publish', 'always'],
    ['--publish=onTag'],
    ['-p', 'always'],
    ['-p=onTag'],
    ['--publish', 'never', '--publish=always'],
    ['--dir'],
    ['--config.directories.output=/tmp/other'],
    ['--linux'],
    ['--candidate'],
  ])('rejects unsafe candidate arguments: %j', (...extraArgs) => {
    expect(() =>
      candidateBuildArgs(
        ['--candidate', '--mac', '--arm64', ...extraArgs],
        'darwin',
        'arm64'
      )
    ).toThrow()
  })

  it('rejects cross-architecture candidate packages', () => {
    expect(() =>
      candidateBuildArgs(['--candidate', '--mac', '--arm64'], 'darwin', 'x64')
    ).toThrow(/Unsupported native candidate target/u)
  })

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

describe('publishing reviewed bytes only', () => {
  it('disables implicit tag publishing', () => {
    expect(nonPublishingBuildArgs(['--mac'])).toEqual([
      '--mac',
      '--publish',
      'never',
    ])
  })
  it.each([
    ['--publish', 'always'],
    ['--publish=onTag'],
    ['-p', 'onTagOrDraft'],
  ])('rejects direct publishing: %s', (...argv) => {
    expect(() => nonPublishingBuildArgs(argv)).toThrow(
      /reviewed candidate artifacts/u
    )
  })
})
