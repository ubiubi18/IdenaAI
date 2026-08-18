const http = require('http')

jest.mock('electron', () => '/mock/electron')

const {
  isRendererReady,
  resolveRendererDevOutputPaths,
  resolveRendererWarmupRoutes,
  waitForRenderer,
} = require('./start-electron-dev')

describe('Electron renderer readiness', () => {
  it('waits for the renderer route response instead of the listening socket', async () => {
    let releaseResponse
    let markRequestReceived
    const responseGate = new Promise((resolve) => {
      releaseResponse = resolve
    })
    const requestReceived = new Promise((resolve) => {
      markRequestReceived = resolve
    })
    const server = http.createServer(async (request, response) => {
      markRequestReceived()
      await responseGate
      response.writeHead(request.url === '/home' ? 200 : 404)
      response.end()
    })

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', resolve)
    })
    const {port} = server.address()

    try {
      let settled = false
      const readiness = isRendererReady({
        timeoutMs: 1000,
        url: `http://127.0.0.1:${port}/home`,
      }).then((value) => {
        settled = true
        return value
      })

      await requestReceived
      expect(settled).toBe(false)

      releaseResponse()
      await expect(readiness).resolves.toBe(true)
    } finally {
      releaseResponse()
      await new Promise((resolve) => {
        server.close(resolve)
      })
    }
  })

  it('does not treat a missing renderer route as ready', async () => {
    const response = {
      resume: jest.fn(),
      statusCode: 404,
    }
    const request = {
      destroy: jest.fn(),
      on: jest.fn(),
      setTimeout: jest.fn(),
    }
    const httpGet = jest.fn((url, options, onResponse) => {
      onResponse(response)
      return request
    })

    await expect(isRendererReady({httpGet})).resolves.toBe(false)
    expect(response.resume).toHaveBeenCalledTimes(1)
  })

  it('warms every configured renderer route before Electron starts', async () => {
    const readinessResolvers = []
    const isReady = jest.fn(
      () =>
        new Promise((resolve) => {
          readinessResolvers.push(resolve)
        })
    )
    const log = jest.fn()

    const warming = waitForRenderer({
      isReady,
      log,
      now: () => 0,
      routes: ['/home', '/validation', '/ai-chat', '/social'],
    })

    expect(isReady).toHaveBeenCalledTimes(1)
    expect(isReady.mock.calls[0][0].url).toBe('http://127.0.0.1:8000/home')

    readinessResolvers.shift()(true)
    await Promise.resolve()
    expect(isReady).toHaveBeenCalledTimes(2)
    expect(isReady.mock.calls[1][0].url).toBe(
      'http://127.0.0.1:8000/validation'
    )

    readinessResolvers.shift()(true)
    await Promise.resolve()
    expect(isReady).toHaveBeenCalledTimes(3)
    expect(isReady.mock.calls[2][0].url).toBe('http://127.0.0.1:8000/ai-chat')

    readinessResolvers.shift()(true)
    await Promise.resolve()
    expect(isReady).toHaveBeenCalledTimes(4)
    expect(isReady.mock.calls[3][0].url).toBe('http://127.0.0.1:8000/social')

    readinessResolvers.shift()(true)
    await warming
    expect(log).toHaveBeenLastCalledWith(
      '[IdenaAI] Renderer route ready /social'
    )
  })
})

describe('Pi renderer warmup configuration', () => {
  it('always warms home and de-duplicates configured local routes', () => {
    expect(
      resolveRendererWarmupRoutes({
        IDENA_DESKTOP_RENDERER_WARMUP_ROUTES: '/social, /ai-chat, /social',
      })
    ).toEqual(['/home', '/social', '/ai-chat'])
    expect(resolveRendererWarmupRoutes({})).toEqual(['/home'])
  })

  it('rejects non-local renderer warmup targets', () => {
    expect(() =>
      resolveRendererWarmupRoutes({
        IDENA_DESKTOP_RENDERER_WARMUP_ROUTES: 'https://example.com/',
      })
    ).toThrow('Invalid renderer warmup route')
  })

  it('preserves the development cache only when explicitly enabled', () => {
    expect(resolveRendererDevOutputPaths({})).toEqual([
      'renderer/.next',
      'renderer/out',
    ])
    expect(
      resolveRendererDevOutputPaths({
        IDENA_DESKTOP_PRESERVE_RENDERER_DEV_CACHE: '1',
      })
    ).toEqual(['renderer/out'])
  })
})
