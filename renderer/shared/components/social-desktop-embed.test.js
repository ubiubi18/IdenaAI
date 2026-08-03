const {
  SOCIAL_CONTRACT_ADDRESS,
  SOCIAL_EMBED_DOCUMENT_PATH,
  validateSocialRpcRequest,
} = require('./social-desktop-rpc-policy')
const {IDENA_SOCIAL_ENTRY_URL} = require('../../../main/idena-social-protocol')

describe('idena.social v12 desktop RPC boundary', () => {
  it('targets the exact v12.1.0 contract', () => {
    expect(SOCIAL_CONTRACT_ADDRESS).toBe(
      '0x840e092e31e9656fF15E541505039ed77585338E'
    )
  })

  it('uses the isolated read-only Electron origin in every runtime', () => {
    expect(SOCIAL_EMBED_DOCUMENT_PATH).toBe(IDENA_SOCIAL_ENTRY_URL)
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
