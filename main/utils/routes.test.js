jest.mock('electron', () => ({
  app: {
    isPackaged: true,
    getAppPath: () => '/Applications/IdenaAI.app/Contents/Resources/app.asar',
  },
}))

const path = require('path')
const loadRoute = require('./routes')

const appPath = '/Applications/IdenaAI.app/Contents/Resources/app.asar'

function resolveRoute(url, existingRoutes = []) {
  const existingFiles = new Set(
    existingRoutes.map((routeName) =>
      path.join(appPath, 'renderer', 'out', `${routeName}.html`)
    )
  )

  return loadRoute.resolvePackagedRouteNameFromUrl(url, appPath, (routeFile) =>
    existingFiles.has(routeFile)
  )
}

describe('renderer routes', () => {
  it('normalizes app route names', () => {
    expect(loadRoute.normalizeRouteName('/settings/general')).toBe(
      'settings/general'
    )
    expect(loadRoute.normalizeRouteName('/settings/general.html')).toBe(
      'settings/general'
    )
    expect(loadRoute.normalizeRouteName('/settings/general?setup=1')).toBe(
      'settings/general'
    )
  })

  it('recovers packaged root file URLs as exported renderer routes', () => {
    expect(resolveRoute('file:///settings/general', ['settings/general'])).toBe(
      'settings/general'
    )
    expect(
      resolveRoute('file:///settings/general.html?setup=1', [
        'settings/general',
      ])
    ).toBe('settings/general')
  })

  it('ignores already resolved packaged renderer files', () => {
    expect(
      resolveRoute(
        'file:///Applications/IdenaAI.app/Contents/Resources/app.asar/renderer/out/settings/general.html',
        ['settings/general']
      )
    ).toBeNull()
  })

  it('does not treat assets or missing files as renderer routes', () => {
    expect(resolveRoute('file:///_next/static/chunks/main.js')).toBeNull()
    expect(resolveRoute('file:///static/identity-mark.png')).toBeNull()
    expect(resolveRoute('file:///settings/missing')).toBeNull()
  })

  it('trusts only canonical HTML files inside the packaged renderer root', () => {
    const rendererRoot = path.join(appPath, 'renderer', 'out')
    const canonicalize = (value) => path.resolve(value)

    expect(
      loadRoute.isPackagedRendererUrl(
        `file://${path.join(rendererRoot, 'home.html')}`,
        appPath,
        canonicalize
      )
    ).toBe(true)
    expect(
      loadRoute.isPackagedRendererUrl(
        'file:///private/tmp/attacker.html',
        appPath,
        canonicalize
      )
    ).toBe(false)
    expect(
      loadRoute.isPackagedRendererUrl(
        `file://${path.join(rendererRoot, 'runtime.js')}`,
        appPath,
        canonicalize
      )
    ).toBe(false)
  })

  it('rejects renderer files whose canonical path escapes through a symlink', () => {
    const rendererRoot = path.join(appPath, 'renderer', 'out')
    const requestedFile = path.join(rendererRoot, 'linked.html')
    const canonicalize = (value) =>
      path.resolve(value) === path.resolve(requestedFile)
        ? '/private/tmp/attacker.html'
        : path.resolve(value)

    expect(
      loadRoute.isPackagedRendererUrl(
        `file://${requestedFile}`,
        appPath,
        canonicalize
      )
    ).toBe(false)
  })
})
