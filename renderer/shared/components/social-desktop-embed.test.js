const {
  SOCIAL_CONTRACT_ADDRESS,
  SOCIAL_EMBED_DOCUMENT_PATH,
  SOCIAL_MESSAGE_CRYPTO_VERSION,
  validateSocialCryptoRequest,
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
    expect(SOCIAL_MESSAGE_CRYPTO_VERSION).toBe('host-v1')
  })

  it('allows only bounded direct-message crypto requests', () => {
    const address = '0x0000000000000000000000000000000000000001'
    const publicKey = `04${'11'.repeat(64)}`

    expect(
      validateSocialCryptoRequest('crypto-1', {
        operation: 'encrypt-message',
        address,
        recipientPublicKey: publicKey,
        plaintext: 'hello',
      })
    ).toBeNull()
    expect(
      validateSocialCryptoRequest('crypto-2', {
        operation: 'decrypt-message',
        address,
        txHash: `0x${'22'.repeat(32)}`,
        messageHash: '33'.repeat(32),
        senderCiphertext: Buffer.from('sender').toString('base64'),
        recipientCiphertext: Buffer.from('recipient').toString('base64'),
      })
    ).toBeNull()
    expect(
      validateSocialCryptoRequest('crypto-3', {
        operation: 'decrypt-message',
        address,
        txHash: `0x${'22'.repeat(32)}`,
        messageHash: '33'.repeat(32),
        senderCiphertext: 'not-base64',
        recipientCiphertext: 'not-base64',
      })
    ).toBe('invalid_crypto_request')
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
