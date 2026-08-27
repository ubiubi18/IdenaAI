const {ReadableStream} = require('stream/web')
const {createFetchClient, readBufferedResponse} = require('./fetch-client')

function headers(values = {}) {
  const normalized = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key.toLowerCase(), value])
  )
  return {
    get: (key) => normalized[String(key).toLowerCase()] || null,
    forEach(callback) {
      Object.entries(normalized).forEach(([key, value]) => callback(value, key))
    },
  }
}

function responseFromChunks(chunks, headerValues = {}) {
  return {
    body: new ReadableStream({
      start(controller) {
        chunks.forEach((chunk) => controller.enqueue(Buffer.from(chunk)))
        controller.close()
      },
    }),
    headers: headers(headerValues),
  }
}

describe('bounded fetch client responses', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    jest.restoreAllMocks()
    if (typeof originalFetch === 'undefined') {
      delete global.fetch
    } else {
      global.fetch = originalFetch
    }
  })

  it('rejects an oversized declared content length before buffering', async () => {
    await expect(
      readBufferedResponse(
        responseFromChunks([], {'content-length': '4097'}),
        4096
      )
    ).rejects.toMatchObject({code: 'ERR_RESPONSE_TOO_LARGE'})
  })

  it('rejects a streamed response that crosses the byte limit', async () => {
    await expect(
      readBufferedResponse(responseFromChunks(['1234', '5678']), 7)
    ).rejects.toMatchObject({code: 'ERR_RESPONSE_TOO_LARGE'})
  })

  it('passes redirect policy and returns bounded JSON', async () => {
    const response = responseFromChunks(['{"ok":true}'], {
      'content-type': 'application/json',
    })
    Object.assign(response, {status: 200, statusText: 'OK'})
    const fetchSpy = jest.fn().mockResolvedValue(response)
    global.fetch = fetchSpy
    const client = createFetchClient()
    const dispatcher = {dispatch: jest.fn()}

    await expect(
      client.get('https://example.test/data', {
        redirect: 'error',
        maxResponseBytes: 1024,
        dispatcher,
      })
    ).resolves.toMatchObject({data: {ok: true}})
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.test/data',
      expect.objectContaining({dispatcher, redirect: 'error'})
    )
  })
})
