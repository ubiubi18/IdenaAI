const {
  SOCIAL_CONTRACT_ADDRESS,
  SOCIAL_EMBED_DOCUMENT_PATH,
  validateSocialRpcRequest,
} = require('./social-desktop-rpc-policy')

describe('idena.social v12 desktop RPC boundary', () => {
  it('targets the exact v12.1.0 contract', () => {
    expect(SOCIAL_CONTRACT_ADDRESS).toBe(
      '0x840e092e31e9656fF15E541505039ed77585338E'
    )
  })

  it('resolves the embedded document inside the packaged renderer output', () => {
    expect(
      new URL(
        SOCIAL_EMBED_DOCUMENT_PATH,
        'file:///opt/IdenaAI/resources/app.asar/renderer/out/social.html'
      ).href
    ).toBe(
      'file:///opt/IdenaAI/resources/app.asar/renderer/out/idena-social/index.html#/'
    )
  })

  it('resolves the same embedded document from the development route', () => {
    expect(
      new URL(SOCIAL_EMBED_DOCUMENT_PATH, 'http://127.0.0.1:8000/social').href
    ).toBe('http://127.0.0.1:8000/idena-social/index.html#/')
  })

  it('allows the bounded transaction-history lookup required for messaging', () => {
    expect(
      validateSocialRpcRequest('request-1', 'bcn_transactions', [
        {
          address: '0x0000000000000000000000000000000000000001',
          count: 100,
        },
      ])
    ).toBeNull()
  })

  it.each([
    [{address: 'not-an-address', count: 100}],
    [{address: '0x0000000000000000000000000000000000000001', count: 101}],
    [{address: '0x0000000000000000000000000000000000000001', count: 0}],
    [
      {
        address: '0x0000000000000000000000000000000000000001',
        count: 1,
        token: '',
      },
    ],
  ])('rejects malformed transaction-history params: %p', (query) => {
    expect(
      validateSocialRpcRequest('request-1', 'bcn_transactions', [query])
    ).toBe('invalid_rpc_params')
  })
})
