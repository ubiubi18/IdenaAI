/* eslint-disable import/no-extraneous-dependencies */
const fs = require('fs')
const path = require('path')
const {app} = require('electron')

const ROUTE_NAME_PATTERN = /^[a-z0-9_-]+(?:\/[a-z0-9_-]+)*$/i
const STATIC_ROUTE_PREFIXES = ['_next', 'static']

function resolveDevServerUrl() {
  const rawUrl =
    process.env.IDENA_DESKTOP_RENDERER_DEV_SERVER_URL || 'http://127.0.0.1:8000'
  const nextUrl = new URL(rawUrl)

  if (!['127.0.0.1', 'localhost'].includes(nextUrl.hostname)) {
    throw new Error('IDENA_DESKTOP_RENDERER_DEV_SERVER_URL must use loopback')
  }

  return nextUrl
}

const DEV_SERVER = resolveDevServerUrl()
const DEV_SERVER_URL = DEV_SERVER.toString().replace(/\/$/, '')
const DEV_SERVER_ORIGIN = DEV_SERVER.origin
const isDev = !app.isPackaged

function normalizeRouteName(routeName) {
  const baseRoute = String(routeName || '')
    .trim()
    .split(/[?#]/, 1)[0]
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.html$/i, '')

  if (!baseRoute || !ROUTE_NAME_PATTERN.test(baseRoute)) {
    return null
  }

  return baseRoute
}

function resolvePackagedRouteFile(routeName) {
  const normalizedRouteName = normalizeRouteName(routeName)

  if (!normalizedRouteName) {
    throw new Error(`Unsupported renderer route: ${routeName || 'empty'}`)
  }

  return path.join(
    app.getAppPath(),
    'renderer',
    'out',
    `${normalizedRouteName}.html`
  )
}

function resolvePackagedRouteNameFromUrl(
  url,
  appPath = app.getAppPath(),
  fileExists = fs.existsSync
) {
  try {
    const nextUrl = new URL(String(url || ''))

    if (nextUrl.protocol !== 'file:') {
      return null
    }

    const pathname = decodeURIComponent(nextUrl.pathname || '')
    const packagedRendererOutPath = path.join(appPath, 'renderer', 'out')

    if (pathname.startsWith(packagedRendererOutPath)) {
      return null
    }

    const routeName = normalizeRouteName(pathname)

    if (
      !routeName ||
      STATIC_ROUTE_PREFIXES.some(
        (prefix) => routeName === prefix || routeName.startsWith(`${prefix}/`)
      )
    ) {
      return null
    }

    const routeFile = path.join(appPath, 'renderer', 'out', `${routeName}.html`)

    return !fileExists || fileExists(routeFile) ? routeName : null
  } catch {
    return null
  }
}

const loadRoute = (win, routeName) => {
  const normalizedRouteName = normalizeRouteName(routeName)

  if (!normalizedRouteName) {
    throw new Error(`Unsupported renderer route: ${routeName || 'empty'}`)
  }

  if (isDev) {
    win.loadURL(`${DEV_SERVER_URL}/${normalizedRouteName}`)
  } else {
    win.loadFile(resolvePackagedRouteFile(normalizedRouteName))
  }
}

loadRoute.DEV_SERVER_URL = DEV_SERVER_URL
loadRoute.DEV_SERVER_ORIGIN = DEV_SERVER_ORIGIN
loadRoute.normalizeRouteName = normalizeRouteName
loadRoute.resolvePackagedRouteFile = resolvePackagedRouteFile
loadRoute.resolvePackagedRouteNameFromUrl = resolvePackagedRouteNameFromUrl

module.exports = loadRoute
