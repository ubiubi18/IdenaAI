#!/usr/bin/env node

const {spawn, spawnSync} = require('child_process')

const MIN_PYTHON = [3, 11]

function parsePythonVersion(value) {
  const match = String(value)
    .trim()
    .match(/^(\d+)\.(\d+)\.(\d+)$/u)
  if (!match) return null
  return match.slice(1).map(Number)
}

function isSupportedPythonVersion(version) {
  return Boolean(
    version &&
      (version[0] > MIN_PYTHON[0] ||
        (version[0] === MIN_PYTHON[0] && version[1] >= MIN_PYTHON[1]))
  )
}

function requireSupportedPython(command, prefixArgs, run = spawnSync) {
  const probe = run(
    command,
    prefixArgs.concat([
      '-c',
      'import sys; print(".".join(map(str, sys.version_info[:3])))',
    ]),
    {encoding: 'utf8', windowsHide: true}
  )
  if (probe.error) throw probe.error
  if (probe.status !== 0) {
    throw new Error('Configured Python runtime could not be inspected')
  }
  const version = parsePythonVersion(probe.stdout)
  if (!isSupportedPythonVersion(version)) {
    throw new Error(
      `IdenaAI Python tooling requires Python ${MIN_PYTHON.join(
        '.'
      )} or newer; ` +
        `configured runtime reported ${
          String(probe.stdout).trim() || 'unknown'
        }`
    )
  }
  return version
}

function parseConfiguredRuntime(configured, platform = process.platform) {
  const requested = String(configured || '').trim()
  if (!requested) return null

  if (platform === 'win32') {
    const launcher = requested.match(/^(py(?:\.exe)?)\s+(-3(?:\.\d+)?)$/iu)
    if (launcher) {
      return {command: launcher[1], prefixArgs: [launcher[2]]}
    }
  }

  return {command: requested, prefixArgs: []}
}

function resolvePythonRuntime(
  configured,
  platform = process.platform,
  run = spawnSync
) {
  const requested = parseConfiguredRuntime(configured, platform)
  if (requested) {
    const {command, prefixArgs} = requested
    return {
      command,
      prefixArgs,
      version: requireSupportedPython(command, prefixArgs, run),
    }
  }

  const candidates =
    platform === 'win32'
      ? [['py', ['-3']]]
      : [
          ['python3', []],
          ['python3.14', []],
          ['python3.13', []],
          ['python3.12', []],
          ['python3.11', []],
        ]
  for (const [command, prefixArgs] of candidates) {
    try {
      return {
        command,
        prefixArgs,
        version: requireSupportedPython(command, prefixArgs, run),
      }
    } catch {
      // Continue through known platform candidates before failing closed.
    }
  }
  throw new Error(
    `No supported Python runtime found; install Python ${MIN_PYTHON.join(
      '.'
    )}+ or set IDENAAI_PYTHON`
  )
}

function main() {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    console.error('Usage: node scripts/run-python.js <script.py> [args...]')
    process.exit(1)
  }

  let runtime
  try {
    runtime = resolvePythonRuntime(process.env.IDENAAI_PYTHON)
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
  const {command, prefixArgs} = runtime

  const child = spawn(command, prefixArgs.concat(args), {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MPLBACKEND: process.env.MPLBACKEND || 'Agg',
    },
    stdio: 'inherit',
  })

  child.on('error', (error) => {
    console.error(error.message)
    process.exit(1)
  })

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal)
      return
    }
    process.exit(code == null ? 1 : code)
  })
}

if (require.main === module) main()

module.exports = {
  isSupportedPythonVersion,
  parseConfiguredRuntime,
  parsePythonVersion,
  requireSupportedPython,
  resolvePythonRuntime,
}
