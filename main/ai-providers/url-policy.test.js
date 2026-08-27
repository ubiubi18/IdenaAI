const {
  assertRemoteUrl,
  createProviderHttpClient,
  createRestrictedLookup,
  parseRemoteUrl,
} = require('./url-policy')

describe('AI provider URL policy', () => {
  it('allows public HTTPS and explicit loopback HTTP only', () => {
    expect(parseRemoteUrl('https://api.example.test/v1').origin).toBe(
      'https://api.example.test'
    )
    expect(
      parseRemoteUrl('http://127.0.0.1:11434/v1', {
        allowLoopbackHttp: true,
      }).origin
    ).toBe('http://127.0.0.1:11434')
    expect(() => parseRemoteUrl('http://api.example.test/v1')).toThrow(/HTTPS/u)
    expect(() => parseRemoteUrl('https://169.254.169.254/latest')).toThrow(
      /not public/u
    )
  })

  it('rejects a hostname that DNS resolves to private space', async () => {
    await expect(
      assertRemoteUrl('https://provider.example.test/v1', {
        lookup: async () => [{address: '10.0.0.4', family: 4}],
      })
    ).rejects.toThrow(/non-public/u)
  })

  it('forces bounded responses and rejects redirects', async () => {
    const client = {get: jest.fn().mockResolvedValue({data: {ok: true}})}
    const secure = createProviderHttpClient(client, {lookup: null})

    await secure.get('https://api.example.test/v1', {
      maxResponseBytes: 99999999,
    })
    expect(client.get).toHaveBeenCalledWith(
      'https://api.example.test/v1',
      expect.objectContaining({
        redirect: 'error',
        maxResponseBytes: 24 * 1024 * 1024,
      })
    )
  })

  it('rejects DNS rebinding at the connection lookup boundary', async () => {
    const lookup = createRestrictedLookup((hostname, options, callback) => {
      callback(null, [{address: '10.0.0.9', family: 4}])
    })

    await expect(
      new Promise((resolve, reject) => {
        lookup('provider.example.test', {all: false}, (error, address) => {
          if (error) reject(error)
          else resolve(address)
        })
      })
    ).rejects.toThrow(/non-public/u)
  })

  it.each(['2002:7f00:1::', '64:ff9b::7f00:1', '2001::1', '3fff::1'])(
    'rejects reserved IPv6 transition address %s',
    async (address) => {
      const lookup = createRestrictedLookup((hostname, options, callback) => {
        callback(null, [{address, family: 6}])
      })

      await expect(
        new Promise((resolve, reject) => {
          lookup('provider.example.test', {all: false}, (error, resolved) => {
            if (error) reject(error)
            else resolve(resolved)
          })
        })
      ).rejects.toThrow(/non-public/u)
    }
  )

  it('binds an unreplaceable restricted dispatcher to provider requests', async () => {
    const dispatcher = {dispatch: jest.fn()}
    const client = {get: jest.fn().mockResolvedValue({data: {ok: true}})}
    const secure = createProviderHttpClient(client, {
      lookup: null,
      connectionLookup: jest.fn(),
      dispatcherFactory: () => dispatcher,
    })

    await secure.get('https://api.example.test/v1', {
      dispatcher: {attackerControlled: true},
    })

    expect(client.get).toHaveBeenCalledWith(
      'https://api.example.test/v1',
      expect.objectContaining({dispatcher})
    )
  })
})
