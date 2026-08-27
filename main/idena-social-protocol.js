const fs = require('fs')
const path = require('path')

const IDENA_SOCIAL_PROTOCOL_SCHEME = 'idena-social'
const IDENA_SOCIAL_PROTOCOL_HOST = 'app'
const IDENA_SOCIAL_ENTRY_URL = `${IDENA_SOCIAL_PROTOCOL_SCHEME}://${IDENA_SOCIAL_PROTOCOL_HOST}/index.html#/`

const IDENA_SOCIAL_SCHEME_PRIVILEGES = Object.freeze({
  standard: true,
  secure: true,
  bypassCSP: false,
  allowServiceWorkers: false,
  supportFetchAPI: true,
  corsEnabled: true,
  codeCache: true,
  allowExtensions: false,
})

const CONTENT_TYPES = Object.freeze({
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
})

function isPathInside(rootPath, candidatePath) {
  const relativePath = path.relative(rootPath, candidatePath)

  return Boolean(
    relativePath &&
      relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath)
  )
}

function resolveIdenaSocialAssetPath(rootPath, requestUrl) {
  let parsedUrl

  try {
    parsedUrl = new URL(String(requestUrl || ''))
  } catch {
    return null
  }

  if (
    parsedUrl.protocol !== `${IDENA_SOCIAL_PROTOCOL_SCHEME}:` ||
    parsedUrl.hostname !== IDENA_SOCIAL_PROTOCOL_HOST ||
    parsedUrl.username ||
    parsedUrl.password ||
    parsedUrl.port
  ) {
    return null
  }

  let decodedPath

  try {
    decodedPath = decodeURIComponent(parsedUrl.pathname || '/')
  } catch {
    return null
  }

  if (decodedPath.includes('\0') || decodedPath.includes('\\')) {
    return null
  }

  const resolvedRoot = path.resolve(rootPath)
  const relativePath = decodedPath.replace(/^\/+/, '') || 'index.html'
  const candidatePath = path.resolve(resolvedRoot, relativePath)

  return isPathInside(resolvedRoot, candidatePath) ? candidatePath : null
}

function createResponse(status, body = null, headers = {}) {
  return new Response(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  })
}

function createIdenaSocialProtocolHandler(rootPath) {
  const resolvedRoot = path.resolve(rootPath)
  let realRootPromise

  const resolveRealRoot = () => {
    if (!realRootPromise) {
      realRootPromise = fs.promises.realpath(resolvedRoot)
    }

    return realRootPromise
  }

  return async function handleIdenaSocialRequest(request) {
    const method = String(request?.method || 'GET').toUpperCase()

    if (!['GET', 'HEAD'].includes(method)) {
      return createResponse(405, 'Method Not Allowed', {Allow: 'GET, HEAD'})
    }

    const candidatePath = resolveIdenaSocialAssetPath(
      resolvedRoot,
      request?.url
    )

    if (!candidatePath) {
      return createResponse(404, 'Not Found')
    }

    try {
      const [realRoot, stats, realCandidatePath] = await Promise.all([
        resolveRealRoot(),
        fs.promises.stat(candidatePath),
        fs.promises.realpath(candidatePath),
      ])

      if (!stats.isFile() || !isPathInside(realRoot, realCandidatePath)) {
        return createResponse(404, 'Not Found')
      }

      const contentType =
        CONTENT_TYPES[path.extname(realCandidatePath).toLowerCase()]

      if (!contentType) {
        return createResponse(415, 'Unsupported Media Type')
      }

      const body = await fs.promises.readFile(realCandidatePath)
      const headers = {
        'Content-Length': String(body.length),
        'Content-Type': contentType,
        'Cross-Origin-Resource-Policy': 'same-origin',
      }

      return createResponse(200, method === 'HEAD' ? null : body, headers)
    } catch (error) {
      if (['ENOENT', 'ENOTDIR', 'EACCES'].includes(error?.code)) {
        return createResponse(404, 'Not Found')
      }

      return createResponse(500, 'Internal Server Error')
    }
  }
}

function resolveIdenaSocialRoot(appPath, isPackaged) {
  return path.join(
    appPath,
    'renderer',
    isPackaged ? 'out' : 'public',
    'idena-social'
  )
}

function registerIdenaSocialScheme(protocolModule) {
  protocolModule.registerSchemesAsPrivileged([
    {
      scheme: IDENA_SOCIAL_PROTOCOL_SCHEME,
      privileges: IDENA_SOCIAL_SCHEME_PRIVILEGES,
    },
  ])
}

function registerIdenaSocialProtocol(protocolModule, rootPath) {
  protocolModule.handle(
    IDENA_SOCIAL_PROTOCOL_SCHEME,
    createIdenaSocialProtocolHandler(rootPath)
  )
}

module.exports = {
  IDENA_SOCIAL_ENTRY_URL,
  IDENA_SOCIAL_PROTOCOL_HOST,
  IDENA_SOCIAL_PROTOCOL_SCHEME,
  IDENA_SOCIAL_SCHEME_PRIVILEGES,
  createIdenaSocialProtocolHandler,
  registerIdenaSocialProtocol,
  registerIdenaSocialScheme,
  resolveIdenaSocialAssetPath,
  resolveIdenaSocialRoot,
}
