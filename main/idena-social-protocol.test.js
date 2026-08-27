/** @jest-environment node */

const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  IDENA_SOCIAL_ENTRY_URL,
  IDENA_SOCIAL_PROTOCOL_SCHEME,
  IDENA_SOCIAL_SCHEME_PRIVILEGES,
  createIdenaSocialProtocolHandler,
  registerIdenaSocialProtocol,
  registerIdenaSocialScheme,
  resolveIdenaSocialAssetPath,
  resolveIdenaSocialRoot,
} = require('./idena-social-protocol')

describe('idena.social isolated protocol', () => {
  let tempRoot
  let socialRoot

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'idena-social-protocol-'))
    socialRoot = path.join(tempRoot, 'idena-social')
    fs.mkdirSync(path.join(socialRoot, 'assets'), {recursive: true})
    fs.writeFileSync(path.join(socialRoot, 'index.html'), '<main>social</main>')
    fs.writeFileSync(path.join(socialRoot, 'assets', 'app.js'), 'window.ok=1')
  })

  afterEach(() => {
    fs.rmSync(tempRoot, {recursive: true, force: true})
  })

  it('registers a standard secure scheme without privileged bypasses', () => {
    expect(IDENA_SOCIAL_PROTOCOL_SCHEME).toBe('idena-social')
    expect(IDENA_SOCIAL_ENTRY_URL).toBe('idena-social://app/index.html#/')
    expect(IDENA_SOCIAL_SCHEME_PRIVILEGES).toEqual(
      expect.objectContaining({
        standard: true,
        secure: true,
        bypassCSP: false,
        allowServiceWorkers: false,
        supportFetchAPI: true,
        corsEnabled: true,
        allowExtensions: false,
      })
    )

    const protocolModule = {
      registerSchemesAsPrivileged: jest.fn(),
      handle: jest.fn(),
    }

    registerIdenaSocialScheme(protocolModule)
    registerIdenaSocialProtocol(protocolModule, socialRoot)

    expect(protocolModule.registerSchemesAsPrivileged).toHaveBeenCalledWith([
      {
        scheme: IDENA_SOCIAL_PROTOCOL_SCHEME,
        privileges: IDENA_SOCIAL_SCHEME_PRIVILEGES,
      },
    ])
    expect(protocolModule.handle).toHaveBeenCalledWith(
      IDENA_SOCIAL_PROTOCOL_SCHEME,
      expect.any(Function)
    )
  })

  it('selects the public development tree and packaged output tree', () => {
    expect(resolveIdenaSocialRoot('/app', false)).toBe(
      path.join('/app', 'renderer', 'public', 'idena-social')
    )
    expect(resolveIdenaSocialRoot('/app', true)).toBe(
      path.join('/app', 'renderer', 'out', 'idena-social')
    )
  })

  it('defers filesystem resolution until the first request', () => {
    const realpathSpy = jest.spyOn(fs.promises, 'realpath')

    try {
      createIdenaSocialProtocolHandler(socialRoot)
      expect(realpathSpy).not.toHaveBeenCalled()
    } finally {
      realpathSpy.mockRestore()
    }
  })

  it('resolves only paths on the dedicated app host inside the root', () => {
    expect(
      resolveIdenaSocialAssetPath(
        socialRoot,
        'idena-social://app/assets/app.js'
      )
    ).toBe(path.join(socialRoot, 'assets', 'app.js'))
    expect(resolveIdenaSocialAssetPath(socialRoot, 'idena-social://app/')).toBe(
      path.join(socialRoot, 'index.html')
    )

    for (const requestUrl of [
      'idena-social://other/index.html',
      'idena-social://user@app/index.html',
      'https://app/index.html',
      'idena-social://app/%2e%2e%2foutside.txt',
      'idena-social://app/%5c..%5coutside.txt',
      'idena-social://app/%00index.html',
      'not a URL',
    ]) {
      expect(resolveIdenaSocialAssetPath(socialRoot, requestUrl)).toBeNull()
    }
  })

  it('serves regular assets with strict response headers', async () => {
    const handler = createIdenaSocialProtocolHandler(socialRoot)
    const response = await handler({
      method: 'GET',
      url: 'idena-social://app/assets/app.js',
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(
      'text/javascript; charset=utf-8'
    )
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('cross-origin-resource-policy')).toBe(
      'same-origin'
    )
    expect(await response.text()).toBe('window.ok=1')
  })

  it('supports HEAD without returning the asset body', async () => {
    const handler = createIdenaSocialProtocolHandler(socialRoot)
    const response = await handler({
      method: 'HEAD',
      url: 'idena-social://app/index.html',
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-length')).toBe(
      String(Buffer.byteLength('<main>social</main>'))
    )
    expect(await response.text()).toBe('')
  })

  it('rejects writes, missing files, directories, and unknown media', async () => {
    fs.writeFileSync(path.join(socialRoot, 'secret.bin'), 'no')
    const handler = createIdenaSocialProtocolHandler(socialRoot)

    await expect(
      handler({method: 'POST', url: IDENA_SOCIAL_ENTRY_URL})
    ).resolves.toMatchObject({status: 405})
    await expect(
      handler({method: 'GET', url: 'idena-social://app/missing.js'})
    ).resolves.toMatchObject({status: 404})
    await expect(
      handler({method: 'GET', url: 'idena-social://app/assets'})
    ).resolves.toMatchObject({status: 404})
    await expect(
      handler({method: 'GET', url: 'idena-social://app/secret.bin'})
    ).resolves.toMatchObject({status: 415})
  })

  it('rejects a symlink that escapes the vendored tree', async () => {
    const outsidePath = path.join(tempRoot, 'outside.js')
    fs.writeFileSync(outsidePath, 'window.stolen=1')
    fs.symlinkSync(outsidePath, path.join(socialRoot, 'assets', 'escape.js'))

    const handler = createIdenaSocialProtocolHandler(socialRoot)
    const response = await handler({
      method: 'GET',
      url: 'idena-social://app/assets/escape.js',
    })

    expect(response.status).toBe(404)
  })
})
