#!/usr/bin/env node

const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const {spawn} = require('child_process')
const {assertDevRuntimeCanStart} = require('./runtime-safety')

const ROOT = path.join(__dirname, '..')
const RENDERER_ROOT = path.join(ROOT, 'renderer', 'out')
const LOOPBACK_HOST = '127.0.0.1'

const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
])

function defaultUserDataDir(env = process.env) {
  const configHome =
    String(env.XDG_CONFIG_HOME || '').trim() ||
    path.join(os.homedir(), '.config')
  return path.join(configHome, 'IdenaAI')
}

function isPathInside(parent, child) {
  const relative = path.relative(parent, child)
  return Boolean(
    relative && !relative.startsWith('..') && !path.isAbsolute(relative)
  )
}

function candidateRelativePaths(rawPathname) {
  let pathname
  try {
    pathname = decodeURIComponent(rawPathname || '/')
  } catch {
    return []
  }

  if (pathname.includes('\0') || pathname.includes('\\')) return []

  const segments = pathname.split('/').filter(Boolean)
  if (segments.some((segment) => segment === '..')) return []

  const relativePath = segments.join('/')
  if (!relativePath) return ['home.html']
  if (path.posix.extname(relativePath)) return [relativePath]
  return [`${relativePath}.html`, path.posix.join(relativePath, 'index.html')]
}

function resolveStaticFile(rawPathname, rendererRoot = RENDERER_ROOT) {
  const canonicalRoot = fs.realpathSync(rendererRoot)

  for (const relativePath of candidateRelativePaths(rawPathname)) {
    const candidate = path.resolve(canonicalRoot, relativePath)
    if (isPathInside(canonicalRoot, candidate)) {
      try {
        const canonicalCandidate = fs.realpathSync(candidate)
        const metadata = fs.statSync(canonicalCandidate)
        if (
          metadata.isFile() &&
          isPathInside(canonicalRoot, canonicalCandidate)
        ) {
          return canonicalCandidate
        }
      } catch {
        // Try the next static-export path.
      }
    }
  }

  return null
}

function createStaticServer(rendererRoot = RENDERER_ROOT) {
  return http.createServer((request, response) => {
    if (!['GET', 'HEAD'].includes(request.method || '')) {
      response.writeHead(405, {Allow: 'GET, HEAD'})
      response.end()
      return
    }

    let pathname = '/'
    try {
      pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname
    } catch {
      response.writeHead(400)
      response.end()
      return
    }

    const filePath = resolveStaticFile(pathname, rendererRoot)
    if (!filePath) {
      response.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'})
      response.end('Not found\n')
      return
    }

    const metadata = fs.statSync(filePath)
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Length': metadata.size,
      'Content-Type':
        MIME_TYPES.get(path.extname(filePath).toLowerCase()) ||
        'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    })

    if (request.method === 'HEAD') {
      response.end()
      return
    }

    fs.createReadStream(filePath).pipe(response)
  })
}

function resolveElectronBinary(env = process.env) {
  const electronBinary = String(env.IDENAAI_ELECTRON_BIN || '').trim()
  if (
    !electronBinary ||
    !path.isAbsolute(electronBinary) ||
    /[\0\r\n]/u.test(electronBinary)
  ) {
    throw new Error('IDENAAI_ELECTRON_BIN must be an absolute executable path')
  }
  fs.accessSync(electronBinary, fs.constants.X_OK)
  return electronBinary
}

async function main() {
  fs.accessSync(path.join(RENDERER_ROOT, 'home.html'), fs.constants.R_OK)

  process.env.IDENA_DESKTOP_USER_DATA_DIR =
    String(process.env.IDENA_DESKTOP_USER_DATA_DIR || '').trim() ||
    defaultUserDataDir(process.env)
  assertDevRuntimeCanStart(process.env)

  const electronBinary = resolveElectronBinary(process.env)
  const server = createStaticServer()

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, LOOPBACK_HOST, resolve)
  })

  const address = server.address()
  const rendererUrl = `http://${LOOPBACK_HOST}:${address.port}`
  const electronProcess = spawn(electronBinary, ['.'], {
    cwd: ROOT,
    env: {
      ...process.env,
      IDENA_DESKTOP_RENDERER_DEV_SERVER_URL: rendererUrl,
      NODE_ENV: 'production',
    },
    stdio: 'inherit',
  })

  const forwardSignal = (signal) => {
    if (electronProcess.exitCode === null) electronProcess.kill(signal)
  }
  process.once('SIGINT', () => forwardSignal('SIGINT'))
  process.once('SIGTERM', () => forwardSignal('SIGTERM'))

  electronProcess.once('error', (error) => {
    console.error(`Unable to start Electron: ${error.message}`)
    server.close(() => process.exit(1))
  })
  electronProcess.once('exit', (code, signal) => {
    let exitCode = 0
    if (Number.isInteger(code)) exitCode = code
    else if (signal) exitCode = 1
    server.close(() => process.exit(exitCode))
  })
}

if (require.main === module) {
  main().catch((error) => {
    console.error(
      `Unable to start the static IdenaAI runtime: ${error.message}`
    )
    process.exit(1)
  })
}

module.exports = {
  candidateRelativePaths,
  createStaticServer,
  defaultUserDataDir,
  resolveElectronBinary,
  resolveStaticFile,
}
