#!/usr/bin/env node

const fs = require('fs')
const crypto = require('crypto')
const os = require('os')
const path = require('path')
const {spawnSync} = require('child_process')
const {readManifest, verifyGitCheckout} = require('./setup-sources')

const ROOT = path.join(__dirname, '..')
const PINNED_NODE_VERSION = '1.1.2'
const MIN_NODE_BINARY_SIZE = 1024 * 1024
const DEFAULT_GO_TOOLCHAIN = process.env.IDENA_GO_GOTOOLCHAIN || 'go1.26.5'
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u

function readOptionValue(argv, index, option) {
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) {
    throw new Error(`${option} requires a value`)
  }
  return value
}

function parseArgs(argv) {
  const options = {
    output: '',
    platform: process.platform,
    arch: process.arch,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--platform') {
      options.platform = readOptionValue(argv, index, arg)
      index += 1
    } else if (arg === '--arch') {
      options.arch = readOptionValue(argv, index, arg)
      index += 1
    } else if (!options.output) {
      options.output = arg
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (!options.output) {
    options.output = path.join(
      ROOT,
      'build',
      'node',
      'current',
      options.platform === 'win32' ? 'idena-go.exe' : 'idena-go'
    )
  }

  return options
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT,
    env: options.env || process.env,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    shell: process.platform === 'win32' && /\.cmd$/i.test(command),
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    const stderr = result.stderr ? `\n${result.stderr.trim()}` : ''
    throw new Error(
      `${command} ${args.join(' ')} exited with ${result.status}${stderr}`
    )
  }

  return result.stdout ? result.stdout.trim() : ''
}

function relativePath(fromDir, toDir) {
  const relative = path.relative(fromDir, toDir) || '.'
  return relative.startsWith('.') ? relative : `.${path.sep}${relative}`
}

function linkerFlags({
  arch,
  bindingCommit,
  goToolchain,
  platform,
  sourceCommit,
}) {
  if (
    !COMMIT_PATTERN.test(sourceCommit || '') ||
    !COMMIT_PATTERN.test(bindingCommit || '') ||
    !/^[a-z0-9._-]+$/u.test(goToolchain || '') ||
    !/^[a-z0-9_-]+$/u.test(platform || '') ||
    !/^[a-z0-9_-]+$/u.test(arch || '')
  ) {
    throw new Error('node build inputs contain an invalid compatibility pin')
  }
  const buildId = crypto
    .createHash('sha256')
    .update(
      [
        `idena-go=${sourceCommit}`,
        `idena-wasm-binding=${bindingCommit}`,
        `go=${goToolchain}`,
        `platform=${platform}`,
        `arch=${arch}`,
        `version=${PINNED_NODE_VERSION}`,
      ].join('\n')
    )
    .digest('hex')
  return `-buildid=idena-go/${buildId} -s -w -X main.version=${PINNED_NODE_VERSION}`
}

function findSourceDir(envKey, defaultName, requiredFile) {
  const candidates = [
    process.env[envKey],
    path.join(ROOT, defaultName),
    path.join(process.cwd(), defaultName),
    path.join(ROOT, '..', defaultName),
  ].filter(Boolean)

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate)
    if (fs.existsSync(path.join(resolved, requiredFile))) {
      return resolved
    }
  }

  return null
}

function ensureDefaultSources() {
  run(process.execPath, [path.join(ROOT, 'scripts', 'setup-sources.js')])
}

function verifyPinnedBuildSource(
  manifest,
  sourceName,
  sourceDir,
  verify = verifyGitCheckout
) {
  const matches = (manifest.sources || []).filter(
    (source) => source.name === sourceName
  )
  if (manifest.version !== 1 || matches.length !== 1) {
    throw new Error(`source manifest has no unique ${sourceName} pin`)
  }
  verify(matches[0], sourceDir)
}

function normalizeArchForBinding(arch) {
  if (arch === 'x64') return 'amd64'
  if (arch === 'arm64') return 'aarch64'
  return arch
}

function bindingLibName(platform, arch) {
  const bindingArch = normalizeArchForBinding(arch)
  if (platform === 'darwin') {
    return arch === 'arm64'
      ? 'libidena_wasm_darwin_arm64.a'
      : `libidena_wasm_darwin_${bindingArch}.a`
  }
  if (platform === 'linux') {
    return `libidena_wasm_linux_${bindingArch}.a`
  }
  if (platform === 'win32') {
    return `libidena_wasm_windows_${bindingArch}.a`
  }
  return ''
}

function verifyBindingArtifact(bindingDir, libName) {
  const archivePath = path.join(bindingDir, 'lib', libName)
  const manifestPath = path.join(bindingDir, 'lib', 'SHA256SUMS')
  if (!fs.existsSync(archivePath) || !fs.existsSync(manifestPath)) {
    throw new Error(`verified wasm binding artifact is missing: ${libName}`)
  }

  const checksums = fs
    .readFileSync(manifestPath, 'utf8')
    .split(/\r?\n/u)
    .map((line) => line.trim().split(/\s+/u))
  const manifestEntry = checksums.find(([, name]) => name === libName)
  if (!manifestEntry || !/^[0-9a-f]{64}$/u.test(manifestEntry[0])) {
    throw new Error(`wasm binding checksum is missing: ${libName}`)
  }

  const actualChecksum = crypto
    .createHash('sha256')
    .update(fs.readFileSync(archivePath))
    .digest('hex')
  if (actualChecksum !== manifestEntry[0]) {
    throw new Error(`wasm binding checksum mismatch: ${libName}`)
  }
}

function goCommand() {
  return process.platform === 'win32' ? 'go.exe' : 'go'
}

function windowsMsysUcrtBinCandidates(
  env = process.env,
  platform = process.platform
) {
  if (platform !== 'win32') return []

  const candidates = [
    'C:\\msys64\\ucrt64\\bin',
    'C:\\ProgramData\\chocolatey\\lib\\mingw\\tools\\install\\mingw64\\bin',
    env.LOCALAPPDATA &&
      path.join(env.LOCALAPPDATA, 'Programs', 'msys64', 'ucrt64', 'bin'),
    env.ProgramFiles && path.join(env.ProgramFiles, 'msys64', 'ucrt64', 'bin'),
    env['ProgramFiles(x86)'] &&
      path.join(env['ProgramFiles(x86)'], 'msys64', 'ucrt64', 'bin'),
  ].filter(Boolean)

  const wingetPackagesDir =
    env.LOCALAPPDATA &&
    path.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages')
  try {
    if (wingetPackagesDir && fs.existsSync(wingetPackagesDir)) {
      fs.readdirSync(wingetPackagesDir, {withFileTypes: true})
        .filter(
          (entry) => entry.isDirectory() && /^MSYS2\.MSYS2/iu.test(entry.name)
        )
        .forEach((entry) => {
          const packageDir = path.join(wingetPackagesDir, entry.name)
          candidates.push(
            path.join(packageDir, 'msys64', 'ucrt64', 'bin'),
            path.join(packageDir, 'ucrt64', 'bin')
          )
        })
    }
  } catch {
    // Fall back to the standard install paths above.
  }

  return candidates
}

function assertNativeBuildTarget(
  options,
  runtime = {platform: process.platform, arch: process.arch}
) {
  if (options.platform !== runtime.platform) {
    throw new Error(
      `cross-platform node builds are not supported by this script: requested ${options.platform}, running on ${runtime.platform}`
    )
  }

  if (options.arch !== runtime.arch) {
    throw new Error(
      `cross-architecture node builds are not supported by this script: requested ${options.arch}, running on ${runtime.arch}`
    )
  }
}

function pathEnvKey(env = process.env) {
  return Object.keys(env).find((key) => key.toLowerCase() === 'path') || 'PATH'
}

function buildEnv() {
  const env = {
    ...process.env,
    CGO_ENABLED: '1',
    GOTOOLCHAIN: DEFAULT_GO_TOOLCHAIN,
  }

  if (process.platform === 'win32') {
    const gccDir = windowsMsysUcrtBinCandidates().find((candidate) =>
      fs.existsSync(path.join(candidate, 'gcc.exe'))
    )
    if (gccDir) {
      const envPathKey = pathEnvKey(env)
      env[envPathKey] = [gccDir, env[envPathKey] || '']
        .filter(Boolean)
        .join(path.delimiter)
      env.PATH = env[envPathKey]
      env.CC = path.join(gccDir, 'gcc.exe')
    }
  }

  return env
}

function getBinaryVersion(binaryPath) {
  const result = spawnSync(binaryPath, ['--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (result.error || result.status !== 0) {
    return ''
  }

  const output = `${result.stdout || ''}\n${result.stderr || ''}`
  const match = output.match(/\b(\d+\.\d+\.\d+)\b/u)
  return match ? match[1] : ''
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  assertNativeBuildTarget(options)

  let idenaGoDir = findSourceDir('IDENAAI_IDENA_GO_DIR', 'idena-go', 'go.mod')
  let wasmBindingDir = findSourceDir(
    'IDENAAI_IDENA_WASM_BINDING_DIR',
    'idena-wasm-binding',
    'go.mod'
  )

  if (!idenaGoDir || !wasmBindingDir) {
    ensureDefaultSources()
    idenaGoDir = findSourceDir('IDENAAI_IDENA_GO_DIR', 'idena-go', 'go.mod')
    wasmBindingDir = findSourceDir(
      'IDENAAI_IDENA_WASM_BINDING_DIR',
      'idena-wasm-binding',
      'go.mod'
    )
  }

  if (!idenaGoDir) {
    throw new Error('idena-go source directory is missing')
  }
  if (!wasmBindingDir) {
    throw new Error('idena-wasm-binding source directory is missing')
  }

  const sourceManifest = readManifest()
  verifyPinnedBuildSource(sourceManifest, 'idena-go', idenaGoDir)
  verifyPinnedBuildSource(sourceManifest, 'idena-wasm-binding', wasmBindingDir)
  const nodeSource = sourceManifest.sources.find(
    (source) => source.name === 'idena-go'
  )
  const bindingSource = sourceManifest.sources.find(
    (source) => source.name === 'idena-wasm-binding'
  )

  const libName = bindingLibName(options.platform, options.arch)
  if (!libName) {
    throw new Error(
      `missing idena-wasm-binding static library for ${options.platform}/${options.arch}: ${libName}`
    )
  }
  verifyBindingArtifact(wasmBindingDir, libName)

  fs.mkdirSync(path.dirname(options.output), {recursive: true})

  const localWasmBinding = relativePath(
    idenaGoDir,
    path.resolve(wasmBindingDir)
  )
  const modDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idena-ai-mod-'))
  const modFile = path.join(modDir, 'idena.mod')
  fs.copyFileSync(path.join(idenaGoDir, 'go.mod'), modFile)
  fs.copyFileSync(
    path.join(idenaGoDir, 'go.sum'),
    path.join(modDir, 'idena.sum')
  )

  try {
    run(
      goCommand(),
      [
        'mod',
        'edit',
        `-modfile=${modFile}`,
        `-replace=github.com/idena-network/idena-wasm-binding=${localWasmBinding}`,
      ],
      {cwd: idenaGoDir}
    )

    run(
      goCommand(),
      [
        'build',
        `-modfile=${modFile}`,
        '-mod=readonly',
        '-trimpath',
        '-ldflags',
        linkerFlags({
          arch: options.arch,
          bindingCommit: bindingSource.commit,
          goToolchain: DEFAULT_GO_TOOLCHAIN,
          platform: options.platform,
          sourceCommit: nodeSource.commit,
        }),
        '-o',
        path.resolve(options.output),
        '.',
      ],
      {
        cwd: idenaGoDir,
        env: buildEnv(),
      }
    )
  } finally {
    fs.rmSync(modDir, {recursive: true, force: true})
  }

  const stats = fs.statSync(options.output)
  if (!stats || stats.size < MIN_NODE_BINARY_SIZE) {
    throw new Error(
      `built node binary is too small (${stats ? stats.size : 0} bytes)`
    )
  }

  if (options.platform !== 'win32') {
    fs.chmodSync(options.output, 0o755)
  }

  const version = getBinaryVersion(options.output)
  if (version !== PINNED_NODE_VERSION) {
    throw new Error(
      `built node version ${
        version || 'unknown'
      } does not match ${PINNED_NODE_VERSION}`
    )
  }

  console.log(`Done. Node binary written to: ${path.resolve(options.output)}`)
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(`[build-node-from-sources] ${error.message}`)
    process.exit(1)
  }
}

module.exports = {
  assertNativeBuildTarget,
  bindingLibName,
  linkerFlags,
  normalizeArchForBinding,
  parseArgs,
  pathEnvKey,
  relativePath,
  verifyBindingArtifact,
  verifyPinnedBuildSource,
  windowsMsysUcrtBinCandidates,
}
