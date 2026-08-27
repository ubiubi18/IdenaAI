#!/usr/bin/env node

const fs = require('fs')
const os = require('os')
const path = require('path')
const {execFileSync, spawnSync} = require('child_process')

const ROOT = path.join(__dirname, '..')
const ELECTRON_BUILDER_CLI = require.resolve('electron-builder/out/cli/cli')
const PREPARE_BUNDLED_NODE = path.join(__dirname, 'prepare-bundled-node.js')
const CHECK_APPLICATION_RELEASE = path.join(
  __dirname,
  'check-application-release-lock.js'
)
const CHECK_BUNDLED_NODE = path.join(
  __dirname,
  'check-bundled-node-artifact.js'
)
const MIN_NODE_BINARY_SIZE = 1024 * 1024
const WINDOWS_BUNDLED_NODE = path.join(
  ROOT,
  'build',
  'node',
  'current',
  'idena-go.exe'
)

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
const UNSAFE_SHELL_PATH = /[\0\r\n"'`$;&|<>]/u

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

function isLikelyWindowsNodeBinary(filePath) {
  let fd = null
  try {
    const stats = fs.statSync(filePath)
    if (!stats || stats.size < MIN_NODE_BINARY_SIZE) {
      return false
    }

    fd = fs.openSync(filePath, 'r')
    const header = Buffer.alloc(2)
    fs.readSync(fd, header, 0, header.length, 0)
    return header[0] === 0x4d && header[1] === 0x5a
  } catch {
    return false
  } finally {
    if (fd !== null) {
      fs.closeSync(fd)
    }
  }
}

function ensureWindowsBundleForTarget(argv) {
  if (!includesAny(argv, WIN_PLATFORM_FLAGS)) {
    return
  }

  if (isLikelyWindowsNodeBinary(WINDOWS_BUNDLED_NODE)) {
    return
  }

  console.error(
    [
      '[electron-builder-wrapper] Windows packaging needs a prepared bundled node at:',
      `  ${WINDOWS_BUNDLED_NODE}`,
      'Build on Windows, or place a pinned idena-go.exe there before running --win from another platform.',
    ].join('\n')
  )
  process.exit(1)
}

function hasExplicitOutputDirectory(argv) {
  return argv.some((arg) =>
    /^(?:-c|--config)\.directories\.output(?:=|$)/u.test(arg)
  )
}

function requiresApprovedRelease(argv) {
  return !argv.includes('--dir')
}

function shouldStageBuilderOutput(
  argv,
  root = ROOT,
  platform = process.platform
) {
  if (platform !== 'darwin' || hasExplicitOutputDirectory(argv)) {
    return false
  }

  const targetsMac = includesAny(argv, MAC_PLATFORM_FLAGS)
  const targetsAnotherPlatform =
    includesAny(argv, WIN_PLATFORM_FLAGS) ||
    includesAny(argv, LINUX_PLATFORM_FLAGS)
  if (!targetsMac && targetsAnotherPlatform) {
    return false
  }

  return UNSAFE_SHELL_PATH.test(path.resolve(root, 'dist'))
}

function copyStagedOutput(stagedOutput, destination) {
  fs.rmSync(destination, {recursive: true, force: true})
  fs.mkdirSync(path.dirname(destination), {recursive: true})
  fs.cpSync(stagedOutput, destination, {
    recursive: true,
    verbatimSymlinks: true,
  })
}

function runElectronBuilder(argv = process.argv.slice(2)) {
  const args = argv.slice()

  if (requiresApprovedRelease(args)) {
    const approvalResult = spawnSync(
      process.execPath,
      [CHECK_APPLICATION_RELEASE, '--require-approved'],
      {cwd: ROOT, env: process.env, stdio: 'inherit'}
    )
    if (approvalResult.error) {
      console.error(
        `checking application release approval failed: ${approvalResult.error.message}`
      )
      return 1
    }
    if (approvalResult.status !== 0) return approvalResult.status || 1
  }

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
      return 1
    }

    if (prepareResult.status !== 0) {
      return prepareResult.status || 1
    }

    if (requiresApprovedRelease(args)) {
      const artifactResult = spawnSync(process.execPath, [CHECK_BUNDLED_NODE], {
        cwd: ROOT,
        env: process.env,
        stdio: 'inherit',
      })
      if (artifactResult.error) {
        console.error(
          `checking bundled node approval failed: ${artifactResult.error.message}`
        )
        return 1
      }
      if (artifactResult.status !== 0) return artifactResult.status || 1
    }
  }

  ensureWindowsBundleForTarget(args)

  let stagedOutput = ''
  const destination = path.join(ROOT, 'dist')
  if (shouldStageBuilderOutput(args)) {
    stagedOutput = fs.mkdtempSync(
      path.join(os.tmpdir(), 'idena-ai-electron-builder-')
    )
    if (UNSAFE_SHELL_PATH.test(stagedOutput)) {
      throw new Error('Temporary Electron Builder path is shell-unsafe')
    }
    args.push(`-c.directories.output=${stagedOutput}`)
    console.log(
      `[electron-builder-wrapper] Staging output outside shell-unsafe checkout path: ${stagedOutput}`
    )
  }

  try {
    const result = spawnSync(
      process.execPath,
      [ELECTRON_BUILDER_CLI, ...args],
      {
        cwd: ROOT,
        env: process.env,
        stdio: 'inherit',
      }
    )

    if (result.error) {
      console.error(`electron-builder failed: ${result.error.message}`)
      return 1
    }
    if (result.status !== 0) {
      return result.status || 1
    }

    if (stagedOutput) {
      copyStagedOutput(stagedOutput, destination)
      console.log(
        `[electron-builder-wrapper] Copied staged output to ${destination}`
      )
    }
    return 0
  } finally {
    if (stagedOutput) {
      fs.rmSync(stagedOutput, {recursive: true, force: true})
    }
  }
}

if (require.main === module) process.exit(runElectronBuilder())

module.exports = {
  copyStagedOutput,
  hasExplicitOutputDirectory,
  requiresApprovedRelease,
  runElectronBuilder,
  shouldStageBuilderOutput,
}
