const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  assertNativeBuildTarget,
  bindingLibName,
  linkerFlags,
  parseArgs,
  pathEnvKey,
  relativePath,
  verifyBindingArtifact,
  verifyPinnedBuildSource,
  windowsMsysUcrtBinCandidates,
} = require('./build-node-from-sources')

describe('build node from sources script', () => {
  it('parses explicit output, platform, and architecture', () => {
    expect(
      parseArgs([
        'build/node/current/idena-go.exe',
        '--platform',
        'win32',
        '--arch',
        'x64',
      ])
    ).toEqual({
      output: 'build/node/current/idena-go.exe',
      platform: 'win32',
      arch: 'x64',
    })
  })

  it('uses platform-specific default output names', () => {
    expect(parseArgs(['--platform', 'win32', '--arch', 'x64']).output).toMatch(
      /build[/\\]node[/\\]current[/\\]idena-go\.exe$/u
    )
    expect(
      parseArgs(['--platform', 'darwin', '--arch', 'arm64']).output
    ).toMatch(/build[/\\]node[/\\]current[/\\]idena-go$/u)
  })

  it('rejects unknown or incomplete arguments', () => {
    expect(() => parseArgs(['out', '--unknown'])).toThrow('Unknown argument')
    expect(() => parseArgs(['--platform'])).toThrow(
      '--platform requires a value'
    )
    expect(() => parseArgs(['--platform', '--arch', 'x64'])).toThrow(
      '--platform requires a value'
    )
    expect(() => parseArgs(['--arch'])).toThrow('--arch requires a value')
  })

  it('rejects cross-platform and cross-architecture builds', () => {
    expect(() =>
      assertNativeBuildTarget(
        {platform: 'win32', arch: 'x64'},
        {platform: 'darwin', arch: 'x64'}
      )
    ).toThrow('cross-platform')

    expect(() =>
      assertNativeBuildTarget(
        {platform: 'darwin', arch: 'arm64'},
        {platform: 'darwin', arch: 'x64'}
      )
    ).toThrow('cross-architecture')
  })

  it('maps platform and architecture names to binding archives', () => {
    expect(bindingLibName('win32', 'x64')).toBe('libidena_wasm_windows_amd64.a')
    expect(bindingLibName('darwin', 'arm64')).toBe(
      'libidena_wasm_darwin_arm64.a'
    )
    expect(bindingLibName('linux', 'arm64')).toBe(
      'libidena_wasm_linux_aarch64.a'
    )
    expect(bindingLibName('freebsd', 'x64')).toBe('')
  })

  it('returns relative paths suitable for Go replace directives', () => {
    expect(relativePath('/repo/idena-go', '/repo/idena-wasm-binding')).toBe(
      `..${path.sep}idena-wasm-binding`
    )
    expect(relativePath('/repo/idena-go', '/repo/idena-go')).toBe('.')
  })

  it('derives a deterministic linker build ID from all pinned inputs', () => {
    const commit = 'a'.repeat(40)
    const inputs = {
      arch: 'arm64',
      bindingCommit: 'b'.repeat(40),
      goToolchain: 'go1.26.5',
      platform: 'darwin',
      sourceCommit: commit,
    }
    const flags = linkerFlags(inputs)
    expect(flags).toMatch(/-buildid=idena-go\/[0-9a-f]{64}/u)
    expect(flags).toContain('-X main.version=1.1.2')
    expect(linkerFlags(inputs)).toBe(flags)
    expect(linkerFlags({...inputs, bindingCommit: 'c'.repeat(40)})).not.toBe(
      flags
    )
    expect(() => linkerFlags({...inputs, sourceCommit: 'main'})).toThrow(
      'invalid compatibility pin'
    )
  })

  it('discovers Windows MSYS2 and Chocolatey toolchain candidates', () => {
    const candidates = windowsMsysUcrtBinCandidates(
      {
        LOCALAPPDATA: 'C:\\Users\\idena\\AppData\\Local',
        ProgramFiles: 'C:\\Program Files',
        'ProgramFiles(x86)': 'C:\\Program Files (x86)',
      },
      'win32'
    )

    expect(candidates).toContain('C:\\msys64\\ucrt64\\bin')
    expect(candidates).toContain(
      'C:\\ProgramData\\chocolatey\\lib\\mingw\\tools\\install\\mingw64\\bin'
    )
    expect(candidates).toContain(
      path.join('C:\\Program Files', 'msys64', 'ucrt64', 'bin')
    )
  })

  it('detects the canonical PATH key case-insensitively', () => {
    expect(pathEnvKey({Path: 'x'})).toBe('Path')
    expect(pathEnvKey({})).toBe('PATH')
  })

  it('verifies binding artifacts against the checked-in manifest', () => {
    const bindingDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'idena-binding-test-')
    )
    const libDir = path.join(bindingDir, 'lib')
    const libName = 'libidena_wasm_darwin_arm64.a'
    const archive = Buffer.from('verified archive')
    const checksum = crypto.createHash('sha256').update(archive).digest('hex')
    fs.mkdirSync(libDir)
    fs.writeFileSync(path.join(libDir, libName), archive)
    fs.writeFileSync(
      path.join(libDir, 'SHA256SUMS'),
      `${checksum}  ${libName}\n`
    )

    expect(() => verifyBindingArtifact(bindingDir, libName)).not.toThrow()

    fs.writeFileSync(path.join(libDir, libName), 'tampered')
    expect(() => verifyBindingArtifact(bindingDir, libName)).toThrow(
      'checksum mismatch'
    )
    fs.rmSync(bindingDir, {recursive: true, force: true})
  })

  it('verifies every build source against its unique manifest pin', () => {
    const manifest = {
      version: 1,
      sources: [
        {
          name: 'idena-go',
          commit: 'a'.repeat(40),
          requiredFiles: ['go.mod'],
        },
      ],
    }
    const verify = jest.fn()

    verifyPinnedBuildSource(manifest, 'idena-go', '/tmp/idena-go', verify)
    expect(verify).toHaveBeenCalledWith(manifest.sources[0], '/tmp/idena-go')

    expect(() =>
      verifyPinnedBuildSource(
        {...manifest, sources: manifest.sources.concat(manifest.sources[0])},
        'idena-go',
        '/tmp/idena-go',
        verify
      )
    ).toThrow('source manifest has no unique idena-go pin')
  })
})
