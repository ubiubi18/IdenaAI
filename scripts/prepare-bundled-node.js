#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const {spawnSync} = require('child_process')

const ROOT = path.join(__dirname, '..')
const PINNED_NODE_VERSION = '1.1.2'
const MIN_NODE_BINARY_SIZE = 1024 * 1024
const TARGET_DIR = path.join(ROOT, 'build', 'node', 'current')
const TARGET_FILE = path.join(
  TARGET_DIR,
  process.platform === 'win32' ? 'idena-go.exe' : 'idena-go'
)
const REQUIRED_SOURCE_FILES = [
  path.join(ROOT, 'idena-go', 'go.mod'),
  path.join(ROOT, 'idena-wasm-binding', 'go.mod'),
]

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: process.env,
    stdio: 'inherit',
    ...options,
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`)
  }
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

function isUsableNodeBinary(binaryPath) {
  if (!fs.existsSync(binaryPath)) {
    return false
  }

  const stats = fs.statSync(binaryPath)
  if (!stats || stats.size < MIN_NODE_BINARY_SIZE) {
    return false
  }

  return getBinaryVersion(binaryPath) === PINNED_NODE_VERSION
}

function hasRequiredSources() {
  return REQUIRED_SOURCE_FILES.every((filePath) => fs.existsSync(filePath))
}

function isSupportedSourceBuildPlatform(
  platform = process.platform,
  arch = process.arch
) {
  if (platform === 'darwin') {
    return ['arm64', 'x64'].includes(arch)
  }
  if (platform === 'linux') {
    return ['arm64', 'x64'].includes(arch)
  }
  if (platform === 'win32') {
    return arch === 'x64'
  }
  return false
}

function prepareBundledNode({
  platform = process.platform,
  arch = process.arch,
  targetFile = TARGET_FILE,
  requiredSourcesPresent = hasRequiredSources,
  runCommand = run,
  verifyBinary = isUsableNodeBinary,
} = {}) {
  if (!isSupportedSourceBuildPlatform(platform, arch)) {
    console.log(
      `[prepare-bundled-node] Skipping bundled node for unsupported ${platform}/${arch}`
    )
    return
  }

  if (!requiredSourcesPresent()) {
    runCommand(process.execPath, [
      path.join(ROOT, 'scripts', 'setup-sources.js'),
    ])
  }

  runCommand(process.execPath, [
    path.join(ROOT, 'scripts', 'build-node-from-sources.js'),
    targetFile,
    '--platform',
    platform,
    '--arch',
    arch,
  ])

  if (!verifyBinary(targetFile)) {
    throw new Error('prepared bundled idena-go binary is missing or invalid')
  }
}

if (require.main === module) prepareBundledNode()

module.exports = {isSupportedSourceBuildPlatform, prepareBundledNode}
