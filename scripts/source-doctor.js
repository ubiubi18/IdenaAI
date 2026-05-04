#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const {spawnSync} = require('child_process')

const ROOT = path.join(__dirname, '..')
const manifest = require('./source-manifest.json')

const DEFAULT_DEV_USER_DATA_NAME = 'IdenaAIDev'
const APP_USER_DATA_NAME =
  process.env.IDENA_DESKTOP_APP_USER_DATA_NAME || DEFAULT_DEV_USER_DATA_NAME
const WORKSPACE_RUNTIME_DIR =
  process.env.IDENA_DESKTOP_WORKSPACE_RUNTIME_DIR ||
  path.join(path.dirname(ROOT), 'IdenaAI-runtime')

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

function windowsCommandCandidates(command) {
  if (process.platform !== 'win32' || path.isAbsolute(command)) {
    return [command]
  }

  return [command, `${command}.cmd`, `${command}.exe`]
}

function pathEnvKey(env = process.env) {
  return Object.keys(env).find((key) => key.toLowerCase() === 'path') || 'PATH'
}

function commandEnv(prependDirs = []) {
  const env = {...process.env}
  if (prependDirs.length === 0) return env

  const envPathKey = pathEnvKey(env)
  env[envPathKey] = [...prependDirs, env[envPathKey] || '']
    .filter(Boolean)
    .join(path.delimiter)
  env.PATH = env[envPathKey]
  return env
}

function windowsNodeToolCandidates(command) {
  if (process.platform !== 'win32' || command !== 'npm') return []

  const nodeDir = path.dirname(process.execPath)
  return [path.join(nodeDir, 'npm.cmd'), path.join(nodeDir, 'npm')].filter(
    (candidate) => fs.existsSync(candidate)
  )
}

function windowsGoCommandCandidates() {
  if (process.platform !== 'win32') return []

  return [
    process.env.ProgramFiles &&
      path.join(process.env.ProgramFiles, 'Go', 'bin', 'go.exe'),
    process.env['ProgramFiles(x86)'] &&
      path.join(process.env['ProgramFiles(x86)'], 'Go', 'bin', 'go.exe'),
    'C:\\Program Files\\Go\\bin\\go.exe',
  ].filter((candidate) => candidate && fs.existsSync(candidate))
}

function commandVersion(command, args = ['--version'], extraCandidates = []) {
  const candidates = [
    ...extraCandidates,
    ...windowsCommandCandidates(command),
  ].filter(
    (candidate, index, all) => candidate && all.indexOf(candidate) === index
  )
  const env = commandEnv(
    process.platform === 'win32' ? windowsMsysUcrtBinCandidates() : []
  )

  for (const candidate of candidates) {
    const result = spawnSync(candidate, args, {
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32' && /\.cmd$/i.test(candidate),
    })

    if (!result.error && result.status === 0) {
      return `${result.stdout || ''}${result.stderr || ''}`
        .trim()
        .split('\n')[0]
    }
  }

  return null
}

function gccCommandCandidates() {
  return windowsMsysUcrtBinCandidates()
    .map((candidate) => path.join(candidate, 'gcc.exe'))
    .filter((candidate) => fs.existsSync(candidate))
}

function hasRequiredFiles(source) {
  const dir = path.join(ROOT, source.path)
  return (
    fs.existsSync(dir) &&
    (source.requiredFiles || []).every((relativePath) =>
      fs.existsSync(path.join(dir, relativePath))
    )
  )
}

function localFlipStatus() {
  const dataDir = path.join(ROOT, 'data')
  const generated =
    fs.existsSync(dataDir) &&
    fs
      .readdirSync(dataDir)
      .filter((name) => /^flip-challenge-.*\.json$/u.test(name))
  const bundledSample = path.join(
    ROOT,
    'samples',
    'flips',
    'flip-challenge-test-20-decoded-labeled.json'
  )

  if (generated && generated.length > 0) {
    return `prepared data/${generated[0]}`
  }

  if (fs.existsSync(bundledSample)) {
    return 'bundled small sample available'
  }

  return 'missing; run npm run setup:flips'
}

function printStatus(label, value, ok = Boolean(value)) {
  console.log(`${ok ? 'OK ' : 'NO '} ${label}: ${value || 'missing'}`)
  return ok
}

function printInfo(label, value) {
  console.log(`INFO ${label}: ${value || 'missing'}`)
}

function main() {
  let ok = true

  ok =
    printStatus('node', process.version, /^v24\./u.test(process.version)) && ok
  ok =
    printStatus(
      'npm',
      commandVersion('npm', ['--version'], windowsNodeToolCandidates('npm'))
    ) && ok
  ok = printStatus('git', commandVersion('git')) && ok
  printInfo(
    process.platform === 'win32' ? 'python' : 'python3',
    process.platform === 'win32'
      ? commandVersion('python')
      : commandVersion('python3')
  )
  printInfo(
    'go',
    commandVersion('go', ['version'], windowsGoCommandCandidates())
  )
  const gccVersion = commandVersion(
    'gcc',
    ['--version'],
    gccCommandCandidates()
  )
  if (process.platform === 'win32') {
    ok = printStatus('gcc', gccVersion) && ok
  } else {
    printInfo('gcc', gccVersion)
  }
  printInfo('rustc', commandVersion('rustc'))

  for (const source of manifest.sources || []) {
    ok =
      printStatus(
        `source ${source.name}`,
        hasRequiredFiles(source)
          ? source.path
          : `missing; run npm run setup:sources`,
        hasRequiredFiles(source)
      ) && ok
  }

  printStatus('FLIP-Challenge input', localFlipStatus(), true)
  console.log(
    `Source dev profile: ${path.resolve(
      WORKSPACE_RUNTIME_DIR,
      APP_USER_DATA_NAME
    )}`
  )
  console.log('Packaged macOS profile: ~/Library/Application Support/IdenaAI')
  console.log('Packaged Windows profile: %APPDATA%\\IdenaAI')
  console.log('Packaged Linux profile: ~/.config/IdenaAI')

  if (!ok) {
    process.exit(1)
  }
}

main()
