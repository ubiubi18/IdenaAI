#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const {spawnSync} = require('child_process')

const ROOT = path.join(__dirname, '..')

function parseArgs(argv) {
  const options = {
    split: 'test',
    skipFlips: 0,
    maxFlips: 200,
    output: '',
    check: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--check') {
      options.check = true
    } else if (arg === '--split') {
      index += 1
      options.split = argv[index]
    } else if (arg === '--skip-flips') {
      index += 1
      options.skipFlips = Number.parseInt(argv[index], 10)
    } else if (arg === '--max-flips') {
      index += 1
      options.maxFlips = Number.parseInt(argv[index], 10)
    } else if (arg === '--output') {
      index += 1
      options.output = argv[index]
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (!Number.isInteger(options.skipFlips) || options.skipFlips < 0) {
    throw new Error('--skip-flips must be a non-negative integer')
  }
  if (!Number.isInteger(options.maxFlips) || options.maxFlips <= 0) {
    throw new Error('--max-flips must be a positive integer')
  }

  if (!options.output) {
    const end = options.skipFlips + options.maxFlips - 1
    const suffix =
      options.skipFlips > 0
        ? `${options.skipFlips}-to-${end}`
        : `${options.maxFlips}`
    options.output = path.join(
      'data',
      `flip-challenge-${options.split}-${suffix}-decoded.json`
    )
  }

  return options
}

function hasLocalFlipInput(output) {
  const localOutput = path.resolve(ROOT, output)
  const bundledSample = path.join(
    ROOT,
    'samples',
    'flips',
    'flip-challenge-test-20-decoded-labeled.json'
  )

  return fs.existsSync(localOutput) || fs.existsSync(bundledSample)
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: process.env,
    stdio: 'inherit',
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`)
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2))

  if (options.check) {
    if (!hasLocalFlipInput(options.output)) {
      throw new Error(
        `No prepared flips found. Run npm run setup:flips -- --output ${options.output}`
      )
    }
    console.log('[setup-flips] Local flip input is available.')
    return
  }

  const outputPath = path.resolve(ROOT, options.output)
  fs.mkdirSync(path.dirname(outputPath), {recursive: true})

  run(process.execPath, [
    path.join('scripts', 'run-python.js'),
    path.join('scripts', 'import_flip_challenge.py'),
    '--split',
    options.split,
    '--skip-flips',
    String(options.skipFlips),
    '--max-flips',
    String(options.maxFlips),
    '--output',
    options.output,
  ])

  console.log(`[setup-flips] Wrote ${outputPath}`)
}

try {
  main()
} catch (error) {
  console.error(`[setup-flips] ${error.message}`)
  process.exit(1)
}
