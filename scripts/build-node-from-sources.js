#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const {spawnSync} = require('child_process')

const ROOT = path.join(__dirname, '..')
const PINNED_NODE_VERSION = '1.1.2'
const MIN_NODE_BINARY_SIZE = 1024 * 1024
const DEFAULT_GO_TOOLCHAIN = process.env.IDENA_GO_GOTOOLCHAIN || 'go1.19.13'

function parseArgs(argv) {
  const options = {
    output: '',
    platform: process.platform,
    arch: process.arch,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--platform') {
      index += 1
      options.platform = argv[index]
    } else if (arg === '--arch') {
      index += 1
      options.arch = argv[index]
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

function goCommand() {
  return process.platform === 'win32' ? 'go.exe' : 'go'
}

function windowsMsysUcrtBinCandidates() {
  if (process.platform !== 'win32') return []

  const candidates = [
    'C:\\msys64\\ucrt64\\bin',
    process.env.LOCALAPPDATA &&
      path.join(
        process.env.LOCALAPPDATA,
        'Programs',
        'msys64',
        'ucrt64',
        'bin'
      ),
    process.env.ProgramFiles &&
      path.join(process.env.ProgramFiles, 'msys64', 'ucrt64', 'bin'),
    process.env['ProgramFiles(x86)'] &&
      path.join(process.env['ProgramFiles(x86)'], 'msys64', 'ucrt64', 'bin'),
  ].filter(Boolean)

  const wingetPackagesDir =
    process.env.LOCALAPPDATA &&
    path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages')
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
      env.PATH = [gccDir, env.PATH || ''].filter(Boolean).join(path.delimiter)
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

  const libName = bindingLibName(options.platform, options.arch)
  if (!libName || !fs.existsSync(path.join(wasmBindingDir, 'lib', libName))) {
    throw new Error(
      `missing idena-wasm-binding static library for ${options.platform}/${options.arch}: ${libName}`
    )
  }

  fs.mkdirSync(path.dirname(options.output), {recursive: true})

  const localWasmBinding = relativePath(idenaGoDir, wasmBindingDir)
  run(
    goCommand(),
    [
      'mod',
      'edit',
      `-replace=github.com/idena-network/idena-wasm-binding=${localWasmBinding}`,
    ],
    {
      cwd: idenaGoDir,
    }
  )

  const env = buildEnv()

  run(
    goCommand(),
    [
      'build',
      '-ldflags',
      `-X main.version=${PINNED_NODE_VERSION}`,
      '-o',
      path.resolve(options.output),
      '.',
    ],
    {
      cwd: idenaGoDir,
      env,
    }
  )

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

try {
  main()
} catch (error) {
  console.error(`[build-node-from-sources] ${error.message}`)
  process.exit(1)
}
