#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const {spawnSync} = require('child_process')

const ROOT = path.join(__dirname, '..')
const MANIFEST_FILE = path.join(__dirname, 'source-manifest.json')

function readOptionValue(argv, index, option) {
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) {
    throw new Error(`${option} requires a value`)
  }
  return value
}

function parseArgs(argv) {
  const options = {
    check: false,
    update: false,
    targetRoot: ROOT,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--check') {
      options.check = true
    } else if (arg === '--update') {
      options.update = true
    } else if (arg === '--target-root') {
      options.targetRoot = path.resolve(readOptionValue(argv, index, arg))
      index += 1
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return options
}

function readManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'))
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT,
    env: process.env,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
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

function sourcePath(source, targetRoot) {
  return path.join(targetRoot, source.path)
}

function isGitCheckout(dir) {
  return fs.existsSync(path.join(dir, '.git'))
}

function requiredFilesPresent(source, dir) {
  return (source.requiredFiles || []).every((relativePath) =>
    fs.existsSync(path.join(dir, relativePath))
  )
}

function describeExistingPlainDirectory(source, dir) {
  if (requiredFilesPresent(source, dir)) {
    console.log(
      `[setup-sources] ${source.name}: using existing source directory at ${dir}`
    )
    return true
  }

  throw new Error(
    `${source.name}: ${dir} exists but is missing required source files`
  )
}

function currentGitCommit(dir) {
  return run('git', ['rev-parse', 'HEAD'], {cwd: dir, capture: true})
}

function verifyGitCheckout(source, dir) {
  const current = currentGitCommit(dir)
  if (source.commit && current !== source.commit) {
    throw new Error(
      `${source.name}: expected ${source.commit}, found ${current}. Run npm run setup:sources or edit scripts/source-manifest.json intentionally.`
    )
  }

  if (!requiredFilesPresent(source, dir)) {
    throw new Error(`${source.name}: checkout is missing required files`)
  }

  console.log(`[setup-sources] ${source.name}: ${current}`)
}

function cloneSource(source, dir) {
  fs.mkdirSync(path.dirname(dir), {recursive: true})
  fs.mkdirSync(dir)
  run('git', ['init'], {cwd: dir})
  run('git', ['remote', 'add', 'origin', source.url], {cwd: dir})
  fetchSource(source, dir)
  run('git', ['checkout', '--detach', 'FETCH_HEAD'], {cwd: dir})
  verifyGitCheckout(source, dir)
}

function updateGitSource(source, dir) {
  fetchSource(source, dir)
  run('git', ['checkout', '--detach', 'FETCH_HEAD'], {cwd: dir})
  verifyGitCheckout(source, dir)
}

function sourceFetchRef(source) {
  return source.commit || source.ref
}

function fetchSource(source, dir) {
  const revision = sourceFetchRef(source)
  if (!revision) {
    throw new Error(`${source.name}: source commit or ref is required`)
  }
  run('git', ['fetch', '--depth', '1', 'origin', revision], {cwd: dir})
}

function ensureSource(source, options) {
  const dir = sourcePath(source, options.targetRoot)

  if (!fs.existsSync(dir)) {
    if (options.check) {
      throw new Error(`${source.name}: missing at ${dir}`)
    }
    cloneSource(source, dir)
    return
  }

  if (!isGitCheckout(dir)) {
    describeExistingPlainDirectory(source, dir)
    return
  }

  if (options.update || !options.check) {
    updateGitSource(source, dir)
    return
  }

  verifyGitCheckout(source, dir)
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const manifest = readManifest()

  for (const source of manifest.sources || []) {
    ensureSource(source, options)
  }

  console.log('[setup-sources] Source setup complete.')
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(`[setup-sources] ${error.message}`)
    process.exit(1)
  }
}

module.exports = {
  parseArgs,
  sourceFetchRef,
  sourcePath,
}
