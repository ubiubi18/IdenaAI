const {
  SOCIAL_CONTRACT_ADDRESS,
  SOCIAL_PROFILE_CONTRACT_ADDRESS,
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

  it('allows only the pinned profile reads and dedicated picture fetch', () => {
    const address = '0x0000000000000000000000000000000000000001'
    const addressKey = `0x${Buffer.from(address).toString('hex')}`
    const nameKey = `0x${Buffer.from('alice_1').toString('hex')}`

    expect(
      validateSocialRpcRequest('profile-fee', 'bcn_feePerGas', [])
    ).toBeNull()
    expect(
      validateSocialRpcRequest('profile-fee-extra', 'bcn_feePerGas', [1])
    ).toBe('invalid_rpc_params')
    for (const [map, key] of [
      ['a:', addressKey],
      ['b:', addressKey],
      ['p:', addressKey],
      ['i:', addressKey],
      ['v:', addressKey],
      ['r:', addressKey],
      ['n:', nameKey],
      ['x:', nameKey],
    ]) {
      expect(
        validateSocialRpcRequest('profile-map', 'contract_readMap', [
          SOCIAL_PROFILE_CONTRACT_ADDRESS,
          map,
          key,
          'string',
        ])
      ).toBeNull()
    }
    for (const params of [
      [SOCIAL_CONTRACT_ADDRESS, 'a:', addressKey, 'string'],
      [SOCIAL_PROFILE_CONTRACT_ADDRESS, 'other:', addressKey, 'string'],
      [SOCIAL_PROFILE_CONTRACT_ADDRESS, 'a:', nameKey, 'string'],
      [SOCIAL_PROFILE_CONTRACT_ADDRESS, 'n:', addressKey, 'string'],
      [SOCIAL_PROFILE_CONTRACT_ADDRESS, 'a:', addressKey, 'hex'],
    ]) {
      expect(
        validateSocialRpcRequest('profile-map-bad', 'contract_readMap', params)
      ).toBe('invalid_rpc_params')
    }
    const cid = 'bafybeigdyrzt5z4jj7f26dx3e6nqoeqcn2xyv4lrfjltx3dyx47n56lcfi'
    expect(
      validateSocialRpcRequest('profile-picture', 'ipfs_getProfilePicture', [
        cid,
      ])
    ).toBeNull()
    expect(
      validateSocialRpcRequest(
        'profile-picture-bad',
        'ipfs_getProfilePicture',
        ['cid/../other']
      )
    ).toBe('invalid_rpc_params')
  })

  it('accepts only exact zero-value profile writes', () => {
    const makeProfileCall = (method, argument) => ({
      from: '0x0000000000000000000000000000000000000001',
      contract: SOCIAL_PROFILE_CONTRACT_ADDRESS,
      method,
      amount: 0,
      args: argument
        ? [{format: 'string', index: 0, value: JSON.stringify(argument)}]
        : [],
      maxFee: '1.5',
    })
    const gas = {_gas: 3_000_000, _keepGas: 1_000_000}
    const nameCall = makeProfileCall('claimName', {name: 'alice_1', ...gas})
    const dropCall = makeProfileCall('dropName')
    const bioCall = makeProfileCall('setProfile', {
      bio: 'Hello',
      picture:
        'ipfs://bafybeigdyrzt5z4jj7f26dx3e6nqoeqcn2xyv4lrfjltx3dyx47n56lcfi',
      ...gas,
    })

    for (const call of [nameCall, dropCall, bioCall]) {
      expect(
        validateSocialRpcRequest('profile-write', 'contract_call', [call])
      ).toBeNull()
      expect(
        validateSocialRpcRequest('profile-value', 'contract_call', [
          {...call, amount: '0.1'},
        ])
      ).toBe('invalid_social_contract_call')
      expect(
        validateSocialRpcRequest('profile-fee', 'contract_call', [
          {...call, maxFee: '10.000000000000000001'},
        ])
      ).toBe('invalid_social_contract_call')
      expect(
        validateSocialRpcRequest('profile-estimate', 'contract_estimateCall', [
          call,
        ])
      ).toBe('invalid_social_contract_call')
    }
    for (const call of [
      {...nameCall, method: 'terminate'},
      {
        ...nameCall,
        args: [
          {...nameCall.args[0], value: JSON.stringify({name: 'Alice', ...gas})},
        ],
      },
      {
        ...nameCall,
        args: [
          {
            ...nameCall.args[0],
            value: JSON.stringify({
              name: 'alice_1',
              _gas: 4_000_000,
              _keepGas: 1_000_000,
            }),
          },
        ],
      },
      {...dropCall, args: [{}]},
      {
        ...bioCall,
        args: [
          {
            ...bioCall.args[0],
            value: JSON.stringify({bio: 'x'.repeat(161), picture: '', ...gas}),
          },
        ],
      },
      {
        ...bioCall,
        args: [
          {
            ...bioCall.args[0],
            value: JSON.stringify({
              bio: '',
              picture: 'https://example.test',
              ...gas,
            }),
          },
        ],
      },
    ]) {
      expect(
        validateSocialRpcRequest('profile-invalid', 'contract_call', [call])
      ).toBe('invalid_social_contract_call')
    }
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
