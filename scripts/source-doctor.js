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

function commandVersion(command, args = ['--version']) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (result.error || result.status !== 0) {
    return null
  }

  return `${result.stdout || ''}${result.stderr || ''}`.trim().split('\n')[0]
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
  ok = printStatus('npm', commandVersion('npm')) && ok
  ok = printStatus('git', commandVersion('git')) && ok
  printInfo('python3', commandVersion('python3'))
  printInfo('go', commandVersion('go', ['version']))
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
