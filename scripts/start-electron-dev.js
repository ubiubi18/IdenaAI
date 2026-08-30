#!/usr/bin/env node

// eslint-disable-next-line import/no-extraneous-dependencies
const http = require('http')
const fs = require('fs')
const net = require('net')
const path = require('path')
const {spawn} = require('child_process')
const {
  DEFAULT_DEV_USER_DATA_NAME,
  assertDevRuntimeCanStart,
} = require('./runtime-safety')

const ROOT = path.join(__dirname, '..')
const NEXT_BIN = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next')
// eslint-disable-next-line import/no-extraneous-dependencies
const ELECTRON_BIN = require('electron')

const DEV_PORT = Number.parseInt(
  process.env.IDENA_DESKTOP_RENDERER_PORT || '8000',
  10
)
const DEV_HOST = process.env.IDENA_DESKTOP_RENDERER_HOST || '127.0.0.1'
const DEV_SERVER_URL = `http://${DEV_HOST}:${DEV_PORT}`
const RENDERER_ROUTE_TIMEOUT_MS = 300000
const RENDERER_PROBE_TIMEOUT_MS = 300000
const POLL_INTERVAL_MS = 1000
const DEFAULT_RENDERER_WARMUP_ROUTES = ['/home']
const RENDERER_ROUTE_PATTERN = /^\/[a-z0-9_-]+(?:\/[a-z0-9_-]+)*$/i
const APP_USER_DATA_NAME =
  process.env.IDENA_DESKTOP_APP_USER_DATA_NAME || DEFAULT_DEV_USER_DATA_NAME
const WORKSPACE_RUNTIME_DIR =
  process.env.IDENA_DESKTOP_WORKSPACE_RUNTIME_DIR ||
  path.join(path.dirname(ROOT), 'IdenaAI-runtime')
const PRESERVE_RENDERER_CACHE_ENV = 'IDENA_DESKTOP_PRESERVE_RENDERER_DEV_CACHE'
const RENDERER_WARMUP_ROUTES_ENV = 'IDENA_DESKTOP_RENDERER_WARMUP_ROUTES'

let rendererProcess = null
let electronProcess = null
let shuttingDown = false
let electronLogFd = null

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, {recursive: true})
  return dirPath
}

function resolveRendererDevOutputPaths(env = process.env) {
  return [
    ...(isTruthyEnv(env[PRESERVE_RENDERER_CACHE_ENV])
      ? []
      : ['renderer/.next']),
    'renderer/out',
  ]
}

function cleanRendererDevOutput(env = process.env) {
  resolveRendererDevOutputPaths(env).forEach((relativePath) => {
    fs.rmSync(path.join(ROOT, relativePath), {
      recursive: true,
      force: true,
    })
  })
}

function resolveDevUserDataDir(env) {
  if (env.IDENA_DESKTOP_USER_DATA_DIR) {
    return env.IDENA_DESKTOP_USER_DATA_DIR
  }

  return resolveDefaultUserDataDir()
}

function resolveDefaultUserDataDir() {
  return path.join(WORKSPACE_RUNTIME_DIR, APP_USER_DATA_NAME)
}

function isTruthyEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(
    String(value || '')
      .trim()
      .toLowerCase()
  )
}

function resolveRendererWarmupRoutes(env = process.env) {
  const configuredRoutes = String(env[RENDERER_WARMUP_ROUTES_ENV] || '')
    .split(/[\s,]+/)
    .map((routePath) => routePath.trim())
    .filter(Boolean)
  const routes = configuredRoutes.length
    ? configuredRoutes
    : DEFAULT_RENDERER_WARMUP_ROUTES
  const uniqueRoutes = ['/home', ...routes].filter(
    (routePath, index, values) => values.indexOf(routePath) === index
  )

  uniqueRoutes.forEach((routePath) => {
    if (!RENDERER_ROUTE_PATTERN.test(routePath)) {
      throw new Error(
        `Invalid renderer warmup route in ${RENDERER_WARMUP_ROUTES_ENV}: ${routePath}`
      )
    }
  })

  return uniqueRoutes
}

function assertRendererPortFree() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()

    server.once('error', (error) => {
      reject(
        new Error(
          error.code === 'EADDRINUSE'
            ? `Renderer dev port ${DEV_PORT} is already in use. Stop the existing IdenaAI dev runtime before starting this one.`
            : `Unable to check renderer dev port ${DEV_PORT}: ${error.message}`
        )
      )
    })

    server.once('listening', () => {
      server.close(resolve)
    })

    server.listen(DEV_PORT, DEV_HOST)
  })
}

function resolveUserDataDir() {
  if (process.env.IDENA_DESKTOP_USER_DATA_DIR) {
    return process.env.IDENA_DESKTOP_USER_DATA_DIR
  }

  return resolveDefaultUserDataDir()
}

function openElectronDevLogFd() {
  const fallbackLogsDir = ensureDir(path.join(ROOT, '.tmp', 'logs'))

  try {
    const logsDir = ensureDir(path.join(resolveUserDataDir(), 'logs'))
    const logPath = path.join(logsDir, 'electron-dev.log')
    fs.appendFileSync(
      logPath,
      `\n[${new Date().toISOString()}] starting Electron dev runtime\n`
    )
    return {
      fd: fs.openSync(logPath, 'a'),
      path: logPath,
    }
  } catch {
    const logPath = path.join(fallbackLogsDir, 'electron-dev.log')
    fs.appendFileSync(
      logPath,
      `\n[${new Date().toISOString()}] starting Electron dev runtime\n`
    )
    return {
      fd: fs.openSync(logPath, 'a'),
      path: logPath,
    }
  }
}

function resolveRendererNodeLaunch(env) {
  const baseNodeOptions = env.NODE_OPTIONS || ''
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10)
  const needsLegacyProvider =
    nodeMajor >= 17 && !baseNodeOptions.includes('--openssl-legacy-provider')
  const requestedHeapMb = Number.parseInt(
    env.IDENA_DESKTOP_DEV_HEAP_MB || '8192',
    10
  )
  const needsHeapIncrease =
    Number.isFinite(requestedHeapMb) &&
    requestedHeapMb > 0 &&
    !/--max-old-space-size=\d+/.test(baseNodeOptions)

  const nodeOptions = [baseNodeOptions]

  if (needsLegacyProvider) {
    nodeOptions.push('--openssl-legacy-provider')
  }

  if (needsHeapIncrease) {
    nodeOptions.push(`--max-old-space-size=${requestedHeapMb}`)
  }

  return {
    env: {
      ...env,
      NODE_OPTIONS: nodeOptions.join(' ').trim(),
    },
    nodeArgs: [
      ...(needsLegacyProvider ? ['--openssl-legacy-provider'] : []),
      ...(needsHeapIncrease ? [`--max-old-space-size=${requestedHeapMb}`] : []),
    ],
    heapMb:
      Number.isFinite(requestedHeapMb) && requestedHeapMb > 0
        ? requestedHeapMb
        : null,
  }
}

function resolveElectronLaunch(env) {
  const requestedHeapMb = Number.parseInt(
    env.IDENA_DESKTOP_ELECTRON_HEAP_MB ||
      env.IDENA_DESKTOP_DEV_HEAP_MB ||
      '8192',
    10
  )

  return {
    env: {
      ...env,
      ...(Number.isFinite(requestedHeapMb) && requestedHeapMb > 0
        ? {
            IDENA_DESKTOP_ELECTRON_HEAP_MB: String(requestedHeapMb),
          }
        : {}),
    },
    heapMb:
      Number.isFinite(requestedHeapMb) && requestedHeapMb > 0
        ? requestedHeapMb
        : null,
  }
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function isRendererReady({
  httpGet = http.get,
  timeoutMs = RENDERER_PROBE_TIMEOUT_MS,
  url = `${DEV_SERVER_URL}/home`,
} = {}) {
  return new Promise((resolve) => {
    let settled = false

    const finish = (ready) => {
      if (settled) return
      settled = true
      resolve(ready)
    }

    // A listening socket only means that Next.js has started accepting work.
    // Wait for the initial route compilation so Electron's HMR client cannot
    // receive build messages before its router has been initialized.
    const request = httpGet(
      url,
      {
        headers: {
          Connection: 'close',
        },
      },
      (response) => {
        response.resume()
        finish(response.statusCode >= 200 && response.statusCode < 400)
      }
    )

    request.on('error', () => {
      finish(false)
    })
    request.setTimeout(timeoutMs, () => {
      request.destroy()
      finish(false)
    })
  })
}

async function waitForRenderer({
  isReady = isRendererReady,
  log = console.log,
  now = Date.now,
  routes = resolveRendererWarmupRoutes(),
  routeTimeoutMs = RENDERER_ROUTE_TIMEOUT_MS,
  waitFn = wait,
} = {}) {
  for (const routePath of routes) {
    const deadline = now() + routeTimeoutMs
    const url = `${DEV_SERVER_URL}${routePath}`
    let ready = false

    log(`[IdenaAI] Warming renderer route ${routePath}`)

    while (now() < deadline) {
      if (rendererProcess && rendererProcess.exitCode !== null) {
        throw new Error(
          `Renderer dev server exited early with code ${rendererProcess.exitCode}`
        )
      }

      const remainingMs = deadline - now()
      if (
        await isReady({
          timeoutMs: Math.min(RENDERER_PROBE_TIMEOUT_MS, remainingMs),
          url,
        })
      ) {
        ready = true
        break
      }

      await waitFn(POLL_INTERVAL_MS)
    }

    if (!ready) {
      throw new Error(
        `Renderer route ${routePath} did not become ready within ${
          routeTimeoutMs / 1000
        }s at ${url}`
      )
    }

    log(`[IdenaAI] Renderer route ready ${routePath}`)
  }
}

function terminateChild(child, signal = 'SIGTERM') {
  if (!child || child.killed || child.exitCode !== null) {
    return
  }

  try {
    child.kill(signal)
  } catch (error) {
    // Ignore shutdown races when the child has already exited.
  }
}

function shutdown(code = 0) {
  if (shuttingDown) {
    return
  }

  shuttingDown = true
  terminateChild(electronProcess)
  terminateChild(rendererProcess)
  if (Number.isInteger(electronLogFd)) {
    try {
      fs.closeSync(electronLogFd)
    } catch {
      // Ignore log-fd shutdown races.
    }
    electronLogFd = null
  }
  process.exit(code)
}

async function main() {
  const baseEnv = {
    ...process.env,
    IDENA_DESKTOP_USER_DATA_DIR: resolveDevUserDataDir(process.env),
  }
  process.env.IDENA_DESKTOP_USER_DATA_DIR = baseEnv.IDENA_DESKTOP_USER_DATA_DIR

  assertDevRuntimeCanStart(baseEnv)

  await assertRendererPortFree()
  cleanRendererDevOutput()

  const rendererNodeLaunch = resolveRendererNodeLaunch(baseEnv)
  const electronLaunch = resolveElectronLaunch(baseEnv)

  if (rendererNodeLaunch.heapMb) {
    console.log(
      `[IdenaAI] Starting renderer dev server with Node heap ${rendererNodeLaunch.heapMb} MB`
    )
  }

  console.log(`[IdenaAI] Dev user data: ${baseEnv.IDENA_DESKTOP_USER_DATA_DIR}`)

  if (electronLaunch.heapMb) {
    console.log(
      `[IdenaAI] Starting Electron with V8 heap ${electronLaunch.heapMb} MB`
    )
  }

  rendererProcess = spawn(
    process.execPath,
    [
      ...rendererNodeLaunch.nodeArgs,
      NEXT_BIN,
      'dev',
      'renderer',
      '-p',
      String(DEV_PORT),
      '-H',
      DEV_HOST,
    ],
    {
      cwd: ROOT,
      env: {
        ...rendererNodeLaunch.env,
        BROWSERSLIST_IGNORE_OLD_DATA: '1',
        NEXT_TELEMETRY_DISABLED: '1',
      },
      stdio: 'inherit',
    }
  )

  rendererProcess.on('exit', (code) => {
    if (!shuttingDown && !electronProcess) {
      process.exit(code || 1)
    }

    if (!shuttingDown && electronProcess && electronProcess.exitCode === null) {
      shutdown(code || 1)
    }
  })

  await waitForRenderer()

  const electronLog = openElectronDevLogFd()
  electronLogFd = electronLog.fd
  console.log(`[IdenaAI] Electron main-process log: ${electronLog.path}`)

  electronProcess = spawn(ELECTRON_BIN, ['.'], {
    cwd: ROOT,
    env: {
      ...electronLaunch.env,
      IDENA_DESKTOP_RENDERER_DEV_SERVER_URL: DEV_SERVER_URL,
      NODE_ENV: process.env.NODE_ENV || 'development',
    },
    stdio: ['ignore', electronLog.fd, electronLog.fd],
  })

  electronProcess.on('exit', (code) => {
    shutdown(code || 0)
  })
}

if (require.main === module) {
  process.on('SIGINT', () => shutdown(130))
  process.on('SIGTERM', () => shutdown(143))
  process.on('exit', () => {
    terminateChild(electronProcess, 'SIGKILL')
    terminateChild(rendererProcess, 'SIGKILL')
  })

  main().catch((error) => {
    console.error(
      `Unable to start the desktop development runtime: ${error.message}`
    )
    shutdown(1)
  })
}

module.exports = {
  assertDevRuntimeCanStart,
  isRendererReady,
  resolveRendererDevOutputPaths,
  resolveRendererWarmupRoutes,
  waitForRenderer,
}
