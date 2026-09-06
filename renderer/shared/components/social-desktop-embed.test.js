const {
  SOCIAL_CONTRACT_ADDRESS,
  SOCIAL_EMBED_DOCUMENT_PATH,
  SOCIAL_EMBED_ORIGIN,
  SOCIAL_MESSAGE_CRYPTO_VERSION,
  validateSocialCryptoRequest,
  validateSocialRpcRequest,
  isTrustedSocialFrameMessage,
} = require('./social-desktop-rpc-policy')
const {IDENA_SOCIAL_ENTRY_URL} = require('../../../main/idena-social-protocol')

describe('idena.social v12.8 desktop RPC boundary', () => {
  it('targets the exact v12 contract', () => {
    expect(SOCIAL_CONTRACT_ADDRESS).toBe(
      '0x840e092e31e9656fF15E541505039ed77585338E'
    )
  })

  it('uses the isolated read-only Electron origin in every runtime', () => {
    expect(SOCIAL_EMBED_DOCUMENT_PATH).toBe(IDENA_SOCIAL_ENTRY_URL)
    expect(SOCIAL_EMBED_ORIGIN).toBe('idena-social://app')
    expect(SOCIAL_MESSAGE_CRYPTO_VERSION).toBe('host-v1')
  })

  it('accepts bootstrap messages only from the exact embedded frame origin', () => {
    const frameWindow = {}
    expect(
      isTrustedSocialFrameMessage(
        {source: frameWindow, origin: SOCIAL_EMBED_ORIGIN},
        frameWindow
      )
    ).toBe(true)
    expect(
      isTrustedSocialFrameMessage(
        {source: frameWindow, origin: 'https://attacker.example'},
        frameWindow
      )
    ).toBe(false)
    expect(
      isTrustedSocialFrameMessage(
        {source: {}, origin: SOCIAL_EMBED_ORIGIN},
        frameWindow
      )
    ).toBe(false)
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

    const groupCiphertexts = ['sender', 'recipient-1', 'recipient-2'].map(
      (value) => Buffer.from(value).toString('base64')
    )
    expect(
      validateSocialCryptoRequest('crypto-group', {
        operation: 'decrypt-message',
        address,
        txHash: `0x${'44'.repeat(32)}`,
        messageHash: '55'.repeat(32),
        senderCiphertext: groupCiphertexts[0],
        recipientCiphertext: groupCiphertexts[1],
        ciphertexts: groupCiphertexts,
      })
    ).toBeNull()
    expect(
      validateSocialCryptoRequest('crypto-group-mismatch', {
        operation: 'decrypt-message',
        address,
        txHash: `0x${'44'.repeat(32)}`,
        messageHash: '55'.repeat(32),
        senderCiphertext: groupCiphertexts[1],
        recipientCiphertext: groupCiphertexts[0],
        ciphertexts: groupCiphertexts,
      })
    ).toBe('invalid_crypto_request')
    expect(
      validateSocialCryptoRequest('crypto-group-too-large', {
        operation: 'decrypt-message',
        address,
        txHash: `0x${'44'.repeat(32)}`,
        messageHash: '55'.repeat(32),
        ciphertexts: Array(17).fill(groupCiphertexts[0]),
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

  it('rejects arbitrary social contract calls and value substitution', () => {
    const call = {
      from: '0x0000000000000000000000000000000000000001',
      contract: SOCIAL_CONTRACT_ADDRESS,
      method: 'makePost',
      amount: '0.00001',
      args: [{format: 'string', index: 0, value: '{"message":"hello"}'}],
      maxFee: '0.1',
    }
    expect(
      validateSocialRpcRequest('request-2', 'contract_call', [call])
    ).toBeNull()
    expect(
      validateSocialRpcRequest('request-3', 'contract_call', [
        {...call, method: 'terminate'},
      ])
    ).toBe('invalid_social_contract_call')
    expect(
      validateSocialRpcRequest('request-4', 'contract_call', [
        {...call, amount: '100'},
      ])
    ).toBe('invalid_social_contract_call')
  })
})
