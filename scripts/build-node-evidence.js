#!/usr/bin/env node

const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {spawnSync} = require('child_process')
const lock = require('../compatibility/stack-lock.json')
const {bindingLibName} = require('./build-node-from-sources')
const {readManifest} = require('./setup-sources')

const ROOT = path.resolve(__dirname, '..')
const GO_TOOLCHAIN = process.env.IDENA_GO_GOTOOLCHAIN || 'go1.26.5'
const SHA256_PATTERN = /^[0-9a-f]{64}$/u

function readOptionValue(argv, index, option) {
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) {
    throw new Error(`${option} requires a value`)
  }
  return value
}

function parseArgs(argv) {
  const options = {
    builderId: '',
    report: path.join(
      ROOT,
      'build',
      'compatibility',
      `node-build-${process.platform}-${process.arch}.json`
    ),
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--builder-id') {
      options.builderId = readOptionValue(argv, index, arg)
      index += 1
    } else if (arg === '--report') {
      options.report = path.resolve(readOptionValue(argv, index, arg))
      index += 1
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (!/^[a-zA-Z0-9._-]{1,80}$/u.test(options.builderId)) {
    throw new Error('--builder-id must contain 1-80 safe characters')
  }
  return options
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT,
    env: options.env || process.env,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    shell: process.platform === 'win32' && /\.cmd$/iu.test(command),
  })

  if (result.error) throw result.error
  if (result.status !== 0) {
    const stderr = result.stderr ? `\n${result.stderr.trim()}` : ''
    throw new Error(
      `${command} ${args.join(' ')} exited with ${result.status}${stderr}`
    )
  }
  return result.stdout ? result.stdout.trim() : ''
}

function sha256File(filePath) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex')
}

function compatibilityPins() {
  return Object.fromEntries(
    lock.components.map((component) => [component.name, component.commit])
  )
}

function verifySourceManifest(manifest) {
  if (
    manifest?.version !== 1 ||
    !Array.isArray(manifest.sources) ||
    manifest.sources.length !== 2
  ) {
    throw new Error('Source manifest must contain exactly two pinned sources')
  }
  const manifestPins = Object.fromEntries(
    manifest.sources.map((source) => [source.name, source.commit])
  )
  if (Object.keys(manifestPins).length !== manifest.sources.length) {
    throw new Error('Source manifest contains duplicate source names')
  }
  for (const name of ['idena-go', 'idena-wasm-binding']) {
    if (manifestPins[name] !== compatibilityPins()[name]) {
      throw new Error(
        `${name} source manifest does not match compatibility lock`
      )
    }
  }
  if (
    Object.keys(manifestPins).some(
      (name) => !['idena-go', 'idena-wasm-binding'].includes(name)
    )
  ) {
    throw new Error('Source manifest contains an unreviewed source')
  }
}

function reportProvenance(env = process.env) {
  const allowed = {
    githubRepository: env.GITHUB_REPOSITORY || '',
    githubRunAttempt: env.GITHUB_RUN_ATTEMPT || '',
    githubRunId: env.GITHUB_RUN_ID || '',
    githubSha: env.GITHUB_SHA || '',
    runnerArch: env.RUNNER_ARCH || '',
    runnerName: env.RUNNER_NAME || '',
    runnerOs: env.RUNNER_OS || '',
  }
  return Object.fromEntries(
    Object.entries(allowed).filter(([, value]) => value.length > 0)
  )
}

function createReport({
  arch,
  binaryPath,
  bindingPath,
  builderId,
  goVersion,
  platform,
  provenance,
}) {
  const binarySha256 = sha256File(binaryPath)
  const bindingSha256 = sha256File(bindingPath)
  if (
    !SHA256_PATTERN.test(binarySha256) ||
    !SHA256_PATTERN.test(bindingSha256)
  ) {
    throw new Error('Build evidence contains an invalid digest')
  }

  return {
    schema: 1,
    releaseId: lock.releaseId,
    gate: 'independent-rebuild-digest-match',
    status: 'passed',
    completedAt: new Date().toISOString(),
    legacyBaselineCommit: lock.legacyBaseline.commit,
    sourceCommit: compatibilityPins()['idena-go'],
    components: compatibilityPins(),
    commands: [
      'node scripts/setup-sources.js --target-root <fresh-directory>',
      `node scripts/build-node-from-sources.js <output> --platform ${platform} --arch ${arch}`,
    ],
    results: {
      arch,
      binarySha256,
      binarySize: fs.statSync(binaryPath).size,
      bindingArtifact: path.basename(bindingPath),
      bindingSha256,
      builderId,
      goVersion,
      nodeVersion: process.version,
      platform,
    },
    provenance,
  }
}

function writeNewJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), {recursive: true})
  const handle = fs.openSync(filePath, 'wx', 0o600)
  try {
    fs.writeFileSync(handle, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  } finally {
    fs.closeSync(handle)
  }
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  const manifest = readManifest()
  verifySourceManifest(manifest)

  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'idena-node-evidence-')
  )
  const sourceRoot = path.join(tempRoot, 'sources')
  const binaryName = process.platform === 'win32' ? 'idena-go.exe' : 'idena-go'
  const binaryPath = path.join(tempRoot, binaryName)

  try {
    run(process.execPath, [
      path.join(ROOT, 'scripts', 'setup-sources.js'),
      '--target-root',
      sourceRoot,
    ])

    const idenaGoDir = path.join(sourceRoot, 'idena-go')
    const bindingDir = path.join(sourceRoot, 'idena-wasm-binding')
    run(
      process.execPath,
      [
        path.join(ROOT, 'scripts', 'build-node-from-sources.js'),
        binaryPath,
        '--platform',
        process.platform,
        '--arch',
        process.arch,
      ],
      {
        env: {
          ...process.env,
          IDENAAI_IDENA_GO_DIR: idenaGoDir,
          IDENAAI_IDENA_WASM_BINDING_DIR: bindingDir,
          IDENA_GO_GOTOOLCHAIN: GO_TOOLCHAIN,
        },
      }
    )

    const archiveName = bindingLibName(process.platform, process.arch)
    if (!archiveName) {
      throw new Error(
        `No compatibility binding exists for ${process.platform}/${process.arch}`
      )
    }
    const bindingPath = path.join(bindingDir, 'lib', archiveName)
    const goVersion = run('go', ['version'], {
      capture: true,
      env: {...process.env, GOTOOLCHAIN: GO_TOOLCHAIN},
    })
    const report = createReport({
      arch: process.arch,
      binaryPath,
      bindingPath,
      builderId: options.builderId,
      goVersion,
      platform: process.platform,
      provenance: reportProvenance(),
    })
    writeNewJson(options.report, report)
    console.log(
      `[build-node-evidence] ${options.builderId}: ${report.results.binarySha256}`
    )
    console.log(`[build-node-evidence] Report: ${options.report}`)
  } finally {
    fs.rmSync(tempRoot, {recursive: true, force: true})
  }
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(`[build-node-evidence] ${error.message}`)
    process.exit(1)
  }
}

module.exports = {
  compatibilityPins,
  createReport,
  parseArgs,
  reportProvenance,
  sha256File,
  verifySourceManifest,
  writeNewJson,
}
