import {createRpcCaller} from './utils'

describe('createRpcCaller', () => {
  const originalFetch = global.fetch
  const originalIdena = global.window?.idena

  afterEach(() => {
    global.fetch = originalFetch

    if (typeof window !== 'undefined') {
      if (typeof originalIdena === 'undefined') {
        delete window.idena
      } else {
        window.idena = originalIdena
      }
    }
  })

  it('does not request an undefined URL when no RPC bridge or fallback URL exists', async () => {
    const fetchMock = jest.fn()
    global.fetch = fetchMock
    if (typeof window !== 'undefined') {
      delete window.idena
    }

    await expect(createRpcCaller()('bcn_syncing')).rejects.toMatchObject({
      code: 'RPC_BRIDGE_UNAVAILABLE',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses an explicit fallback RPC URL when no bridge exists', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      json: async () => ({result: {syncing: false}}),
    })
    global.fetch = fetchMock
    if (typeof window !== 'undefined') {
      delete window.idena
    }

    await expect(
      createRpcCaller({url: 'http://127.0.0.1:9129/', key: 'rpc-key'})(
        'bcn_syncing'
      )
    ).resolves.toEqual({syncing: false})

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:9129/',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          method: 'bcn_syncing',
          params: [],
          id: 1,
          key: 'rpc-key',
        }),
      })
    )
  })
})
