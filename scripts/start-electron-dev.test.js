const http = require('http')

jest.mock('electron', () => '/mock/electron')

const {isRendererReady} = require('./start-electron-dev')

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
})
