const {
  SOCIAL_CONTRACT_ADDRESS,
  SOCIAL_EMBED_DOCUMENT_PATH,
  SOCIAL_EMBED_ORIGIN,
  SOCIAL_MESSAGE_CRYPTO_VERSION,
  SOCIAL_DIRECT_V4_CONTRACT,
  parseSocialV4DeliveryOrder,
  validateSocialCryptoRequest,
  validateSocialDirectCheckRequest,
  validateSocialRpcRequest,
  isTrustedSocialFrameMessage,
} = require('./social-desktop-rpc-policy')
const {IDENA_SOCIAL_ENTRY_URL} = require('../../../main/idena-social-protocol')

describe('idena.social v12.9 desktop RPC boundary', () => {
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

  it('passes only one bounded delivery text to the local checker', () => {
    const valid = {
      requestId: 'check-1',
      message: '{"format":"fod.direct-delivery","version":2}',
    }
    expect(validateSocialDirectCheckRequest(valid)).toBeNull()
    expect(
      validateSocialDirectCheckRequest({...valid, binaryPath: '/tmp/other'})
    ).toBe('invalid_direct_check_request')
    expect(
      validateSocialDirectCheckRequest({...valid, message: 'ordinary message'})
    ).toBe('invalid_direct_check_request')
    expect(
      validateSocialDirectCheckRequest({...valid, message: 'x'.repeat(2049)})
    ).toBe('invalid_direct_check_request')
  })

  it('keeps the exact v4 order ID for a trusted saved-payment action', () => {
    const message = `{"format":"fod.direct-delivery","version":2,"network":"idena","contract":"${SOCIAL_DIRECT_V4_CONTRACT}","author":"${'a'.repeat(
      40
    )}","offerId":"${'d'.repeat(
      64
    )}","orderId":18446744073709551615,"orderNonce":1,"buyer":"${'b'.repeat(
      40
    )}","deliveryKey":"04${'e'.repeat(128)}","ciphertext":"${'c'.repeat(438)}"}`
    expect(parseSocialV4DeliveryOrder(message)).toEqual({
      orderId: '18446744073709551615',
      contract: `0x${SOCIAL_DIRECT_V4_CONTRACT}`,
    })
    expect(
      parseSocialV4DeliveryOrder(
        message.replace(
          '"orderId":18446744073709551615',
          '"orderId":18446744073709551616'
        )
      )
    ).toBeNull()
    expect(
      parseSocialV4DeliveryOrder(
        message.replace(SOCIAL_DIRECT_V4_CONTRACT, 'a'.repeat(40))
      )
    ).toBeNull()
    expect(
      parseSocialV4DeliveryOrder(
        message.replace('"orderNonce":1', '"orderNonce":1,"orderId":1')
      )
    ).toBeNull()
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

  it('allows DM fee estimates while preserving the pinned contract and exact amounts', () => {
    const messageCall = {
      from: '0x0000000000000000000000000000000000000001',
      contract: SOCIAL_CONTRACT_ADDRESS,
      method: 'sendMessage',
      amount: '0.00002',
      args: [
        {
          format: 'string',
          index: 0,
          value: JSON.stringify({
            message: [
              Buffer.from('sender ciphertext').toString('base64'),
              Buffer.from('recipient ciphertext').toString('base64'),
            ],
            messageHash: '11'.repeat(32),
            encrypted: true,
          }),
        },
      ],
      maxFee: '0.1',
    }

    expect(
      validateSocialRpcRequest('dm-1', 'contract_call', [messageCall])
    ).toBeNull()
    expect(
      validateSocialRpcRequest('dm-estimate', 'contract_estimateCall', [
        {...messageCall, maxFee: '10'},
      ])
    ).toBeNull()
    expect(
      validateSocialRpcRequest('post-estimate', 'contract_estimateCall', [
        {...messageCall, method: 'makePost', amount: '0.00001'},
      ])
    ).toBe('invalid_social_contract_call')
    expect(
      validateSocialRpcRequest(
        'other-contract-estimate',
        'contract_estimateCall',
        [
          {
            ...messageCall,
            contract: '0x0000000000000000000000000000000000000002',
          },
        ]
      )
    ).toBe('invalid_social_contract_call')
    expect(
      validateSocialRpcRequest(
        'wrong-amount-estimate',
        'contract_estimateCall',
        [{...messageCall, amount: '0.00001'}]
      )
    ).toBe('invalid_social_contract_call')
    expect(
      validateSocialRpcRequest('excess-fee-estimate', 'contract_estimateCall', [
        {...messageCall, maxFee: '20.000000000000000001'},
      ])
    ).toBe('invalid_social_contract_call')
    const messageArgument = JSON.parse(messageCall.args[0].value)
    const callWithCount = (count, maxFee) => ({
      ...messageCall,
      maxFee,
      args: [
        {
          ...messageCall.args[0],
          value: JSON.stringify({
            ...messageArgument,
            message: Array(count).fill('YQ=='),
          }),
        },
      ],
    })
    for (const [count, limit] of [
      [2, 20],
      [6, 20],
      [16, 20],
    ]) {
      for (const rpcMethod of ['contract_call', 'contract_estimateCall']) {
        expect(
          validateSocialRpcRequest(`fee-${rpcMethod}-${count}`, rpcMethod, [
            callWithCount(count, String(limit)),
          ])
        ).toBeNull()
        expect(
          validateSocialRpcRequest(
            `excess-fee-${rpcMethod}-${count}`,
            rpcMethod,
            [callWithCount(count, `${limit}.000000000000000001`)]
          )
        ).toBe('invalid_social_contract_call')
      }
    }
    for (const count of [0, 1, 17]) {
      expect(
        validateSocialRpcRequest(
          `invalid-count-${count}`,
          'contract_estimateCall',
          [callWithCount(count, '10')]
        )
      ).toBe('invalid_social_contract_call')
    }
    expect(
      validateSocialRpcRequest('dm-2', 'contract_call', [
        {...messageCall, amount: '0.00001'},
      ])
    ).toBe('invalid_social_contract_call')
    expect(
      validateSocialRpcRequest('dm-3', 'contract_call', [
        {...messageCall, amount: '0.00003'},
      ])
    ).toBe('invalid_social_contract_call')
  })
})
