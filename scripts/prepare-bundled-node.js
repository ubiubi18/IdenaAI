#!/usr/bin/env node

const fs = require('fs')
const os = require('os')
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

function copyBinary(sourcePath) {
  fs.mkdirSync(TARGET_DIR, {recursive: true})
  fs.copyFileSync(sourcePath, TARGET_FILE)
  fs.chmodSync(TARGET_FILE, 0o755)
  console.log(`[prepare-bundled-node] Bundled ${sourcePath} -> ${TARGET_FILE}`)
}

function getExistingNodeCandidates() {
  let platformProfileDir = path.join(os.homedir(), '.config', 'IdenaAI')
  if (process.platform === 'darwin') {
    platformProfileDir = path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'IdenaAI'
    )
  } else if (process.platform === 'win32') {
    platformProfileDir = path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'IdenaAI'
    )
  }

  return [
    path.join(
      platformProfileDir,
      'node',
      process.platform === 'win32' ? 'idena-go.exe' : 'idena-go'
    ),
    process.env.IDENAAI_BUNDLED_NODE_SOURCE,
  ].filter(Boolean)
}

function hasRequiredSources() {
  return REQUIRED_SOURCE_FILES.every((filePath) => fs.existsSync(filePath))
}

function isSupportedSourceBuildPlatform() {
  if (process.platform === 'darwin') {
    return ['arm64', 'x64'].includes(process.arch)
  }
  if (process.platform === 'linux') {
    return ['arm64', 'x64'].includes(process.arch)
  }
  if (process.platform === 'win32') {
    return process.arch === 'x64'
  }
  return false
}

function main() {
  if (!isSupportedSourceBuildPlatform()) {
    console.log(
      `[prepare-bundled-node] Skipping bundled node for unsupported ${process.platform}/${process.arch}`
    )
    return
  }

  if (isUsableNodeBinary(TARGET_FILE)) {
    console.log(`[prepare-bundled-node] Existing bundle is current`)
    return
  }

  for (const candidate of getExistingNodeCandidates()) {
    if (isUsableNodeBinary(candidate)) {
      copyBinary(candidate)
      return
    }
  }

  if (!hasRequiredSources()) {
    run(process.execPath, [path.join(ROOT, 'scripts', 'setup-sources.js')])
  }

  if (process.platform === 'darwin' && process.arch === 'arm64') {
    run('/bin/bash', [
      path.join(ROOT, 'scripts', 'build-node-macos-arm64.sh'),
      TARGET_FILE,
    ])
  } else {
    run(process.execPath, [
      path.join(ROOT, 'scripts', 'build-node-from-sources.js'),
      TARGET_FILE,
    ])
  }

  if (!isUsableNodeBinary(TARGET_FILE)) {
    throw new Error('prepared bundled idena-go binary is missing or invalid')
  }
}

main()
