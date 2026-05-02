#!/usr/bin/env node

const path = require('path')
const {execFileSync, spawnSync} = require('child_process')

const ROOT = path.join(__dirname, '..')
const ELECTRON_BUILDER_CLI = require.resolve('electron-builder/out/cli/cli')
const PREPARE_BUNDLED_NODE = path.join(__dirname, 'prepare-bundled-node.js')

const MAC_PLATFORM_FLAGS = new Set(['--mac', '-m'])
const WIN_PLATFORM_FLAGS = new Set(['--win', '-w'])
const LINUX_PLATFORM_FLAGS = new Set(['--linux', '-l'])
const NON_MAC_PLATFORM_FLAGS = new Set([
  ...WIN_PLATFORM_FLAGS,
  ...LINUX_PLATFORM_FLAGS,
])
const ARCH_FLAGS = new Set([
  '--arm64',
  '--x64',
  '--ia32',
  '--armv7l',
  '--universal',
])

function detectMacMachineArch() {
  try {
    const appleSiliconAvailable = execFileSync(
      '/usr/sbin/sysctl',
      ['-in', 'hw.optional.arm64'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }
    )
      .trim()
      .toLowerCase()

    if (appleSiliconAvailable === '1') {
      return 'arm64'
    }

    const machineArch = execFileSync(
      '/usr/sbin/sysctl',
      ['-in', 'hw.machine'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }
    )
      .trim()
      .toLowerCase()

    return machineArch === 'arm64' ? 'arm64' : 'x64'
  } catch {
    return process.arch === 'arm64' ? 'arm64' : 'x64'
  }
}

function includesAny(argv, flags) {
  return argv.some((arg) => flags.has(arg))
}

function shouldAppendMacArch(argv) {
  if (process.platform !== 'darwin') {
    return false
  }

  if (includesAny(argv, ARCH_FLAGS)) {
    return false
  }

  const targetsMac = includesAny(argv, MAC_PLATFORM_FLAGS)
  const targetsNonMacOnly =
    includesAny(argv, NON_MAC_PLATFORM_FLAGS) && !targetsMac

  return !targetsNonMacOnly
}

function shouldPreparePlatformBundle(argv) {
  const targetsMacPlatform = includesAny(argv, MAC_PLATFORM_FLAGS)
  const targetsWinPlatform = includesAny(argv, WIN_PLATFORM_FLAGS)
  const targetsLinuxPlatform = includesAny(argv, LINUX_PLATFORM_FLAGS)
  const hasExplicitPlatform =
    targetsMacPlatform || targetsWinPlatform || targetsLinuxPlatform

  if (!hasExplicitPlatform) {
    return true
  }

  if (process.platform === 'darwin') {
    return targetsMacPlatform
  }
  if (process.platform === 'win32') {
    return targetsWinPlatform
  }
  if (process.platform === 'linux') {
    return targetsLinuxPlatform
  }
  return false
}

const args = process.argv.slice(2)

if (shouldAppendMacArch(args)) {
  const targetArch = detectMacMachineArch()
  args.push(targetArch === 'arm64' ? '--arm64' : '--x64')
  console.log(
    `[electron-builder-wrapper] Detected macOS machine architecture ${targetArch}; packaging target set to ${targetArch}.`
  )
}

if (shouldPreparePlatformBundle(args)) {
  const prepareResult = spawnSync(process.execPath, [PREPARE_BUNDLED_NODE], {
    cwd: ROOT,
    env: process.env,
    stdio: 'inherit',
  })

  if (prepareResult.error) {
    console.error(
      `preparing bundled Idena node failed: ${prepareResult.error.message}`
    )
    process.exit(1)
  }

  if (prepareResult.status !== 0) {
    process.exit(prepareResult.status || 1)
  }
}

const result = spawnSync(process.execPath, [ELECTRON_BUILDER_CLI, ...args], {
  cwd: ROOT,
  env: process.env,
  stdio: 'inherit',
})

if (result.error) {
  console.error(`electron-builder failed: ${result.error.message}`)
  process.exit(1)
}

process.exit(result.status || 0)
