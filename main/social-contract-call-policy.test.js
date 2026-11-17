const {
  SOCIAL_PROFILE_CONTRACT_ADDRESS,
  SOCIAL_PROFILE_PICTURE_MAX_RESPONSE_BYTES,
  decimalToAtoms,
  socialContractCallRequiresConfirmation,
  validateSocialContractCall,
  validateSocialProfileCall,
  validateSocialProfilePictureCid,
  validateSocialProfileReadMap,
} = require('./social-contract-call-policy')

function makeCall(overrides = {}) {
  const method = overrides.method || 'makePost'
  let defaultArgument = {message: 'hello'}
  if (method === 'sendTip') {
    defaultArgument = {postId: 'post-1', tipAmount: '2.5'}
  } else if (method === 'sendMessage') {
    defaultArgument = {
      message: [
        Buffer.from('sender ciphertext').toString('base64'),
        Buffer.from('recipient ciphertext').toString('base64'),
      ],
      messageHash: '11'.repeat(32),
      encrypted: true,
    }
  }
  const argument = overrides.argument || defaultArgument
  const amount =
    overrides.amount ||
    {
      makePost: '0.00001',
      sendMessage: '0.00002',
      sendTip: '2.5',
    }[method]

  return {
    from: '0x0000000000000000000000000000000000000001',
    contract: '0x840e092e31e9656fF15E541505039ed77585338E',
    method,
    amount,
    args: [{format: 'string', index: 0, value: JSON.stringify(argument)}],
    maxFee: '0.1',
  }
}

function makeMessageCall(ciphertextCount) {
  return makeCall({
    method: 'sendMessage',
    argument: {
      message: Array.from({length: ciphertextCount}, (_, index) =>
        Buffer.from(`ciphertext ${index}`).toString('base64')
      ),
      messageHash: '11'.repeat(32),
      encrypted: true,
    },
  })
}

describe('social contract-call policy', () => {
  it('accepts only the pinned contract and expected method payloads', () => {
    expect(validateSocialContractCall(makeCall())).toBeNull()
    expect(
      validateSocialContractCall(makeCall({method: 'sendMessage'}))
    ).toBeNull()
    expect(validateSocialContractCall(makeCall({method: 'sendTip'}))).toBeNull()
    expect(
      validateSocialContractCall({
        ...makeCall(),
        contract: '0x0000000000000000000000000000000000000002',
      })
    ).toBe('invalid_social_contract_call')
  })

  it('accepts the exact DM amount without widening other calls', () => {
    expect(
      validateSocialContractCall(
        makeCall({method: 'sendMessage', amount: '0.00002'})
      )
    ).toBeNull()
    expect(
      validateSocialContractCall(
        makeCall({method: 'sendMessage', amount: '0.00001'})
      )
    ).toBe('invalid_social_contract_call')
    expect(
      validateSocialContractCall(
        makeCall({method: 'sendMessage', amount: '0.00003'})
      )
    ).toBe('invalid_social_contract_call')
    expect(
      validateSocialContractCall(
        makeCall({method: 'makePost', amount: '0.00002'})
      )
    ).toBe('invalid_social_contract_call')
  })

  it('accepts 2 through 16 ciphertexts for direct and group messages', () => {
    for (const count of [2, 3, 6, 16]) {
      expect(validateSocialContractCall(makeMessageCall(count))).toBeNull()
    }
  })

  it('rejects message ciphertext counts outside the supported range', () => {
    for (const count of [0, 1, 17]) {
      expect(validateSocialContractCall(makeMessageCall(count))).toBe(
        'invalid_social_contract_call'
      )
    }
  })

  it('limits message fees to 20 IDNA while posts and tips stay at 10', () => {
    for (const [count, limit] of [
      [2, 20],
      [6, 20],
      [16, 20],
    ]) {
      const call = makeMessageCall(count)
      expect(
        validateSocialContractCall({...call, maxFee: String(limit)})
      ).toBeNull()
      expect(
        validateSocialContractCall({
          ...call,
          maxFee: `${limit}.000000000000000001`,
        })
      ).toBe('invalid_social_contract_call')
    }

    for (const method of ['makePost', 'sendTip']) {
      expect(
        validateSocialContractCall({
          ...makeCall({method}),
          maxFee: '10.000000000000000001',
        })
      ).toBe('invalid_social_contract_call')
    }
  })

  it('keeps ciphertext, hash, and argument limits for group messages', () => {
    const groupArgument = JSON.parse(makeMessageCall(3).args[0].value)
    const invalidArguments = [
      {
        ...groupArgument,
        message: [...groupArgument.message.slice(0, 2), 'not-base64'],
      },
      {...groupArgument, messageHash: 'not-a-hash'},
      {...groupArgument, encrypted: false},
      {
        ...groupArgument,
        message: Array(16).fill(Buffer.alloc(64 * 1024).toString('base64')),
      },
    ]

    for (const argument of invalidArguments) {
      expect(
        validateSocialContractCall(makeCall({method: 'sendMessage', argument}))
      ).toBe('invalid_social_contract_call')
    }
  })

  it('rejects value and argument substitution', () => {
    expect(validateSocialContractCall(makeCall({amount: '1'}))).toBe(
      'invalid_social_contract_call'
    )
    expect(
      validateSocialContractCall(
        makeCall({
          method: 'sendTip',
          amount: '2.5',
          argument: {postId: 'post-1', tipAmount: '3'},
        })
      )
    ).toBe('invalid_social_contract_call')
    expect(validateSocialContractCall({...makeCall(), maxFee: '1000000'})).toBe(
      'invalid_social_contract_call'
    )
    expect(
      validateSocialContractCall(
        makeCall({argument: {message: 'hello', unexpected: true}})
      )
    ).toBe('invalid_social_contract_call')
    expect(
      validateSocialContractCall(
        makeCall({
          method: 'sendMessage',
          argument: {
            message: ['not-base64', 'also-not-base64'],
            messageHash: '11'.repeat(32),
            encrypted: true,
          },
        })
      )
    ).toBe('invalid_social_contract_call')
  })

  it('uses exact 18-decimal integer conversion and confirms tips', () => {
    expect(decimalToAtoms('0.00001')).toBe(10000000000000n)
    expect(decimalToAtoms('1.000000000000000001')).toBe(1000000000000000001n)
    expect(decimalToAtoms('1e3')).toBeNull()
    expect(socialContractCallRequiresConfirmation(makeCall())).toBe(false)
    expect(
      socialContractCallRequiresConfirmation(makeCall({method: 'sendTip'}))
    ).toBe(true)
  })
})

function makeProfileCall(method, overrides = {}) {
  const argument =
    method === 'claimName'
      ? {name: 'alice_1', _gas: 3_000_000, _keepGas: 1_000_000}
      : {
          bio: 'Hello',
          picture:
            'ipfs://bafybeigdyrzt5z4jj7f26dx3e6nqoeqcn2xyv4lrfjltx3dyx47n56lcfi',
          _gas: 3_000_000,
          _keepGas: 1_000_000,
        }

  return {
    from: '0x0000000000000000000000000000000000000001',
    contract: SOCIAL_PROFILE_CONTRACT_ADDRESS,
    method,
    amount: 0,
    args:
      method === 'dropName'
        ? []
        : [{format: 'string', index: 0, value: JSON.stringify(argument)}],
    maxFee: '1.5',
    ...overrides,
  }
}

describe('pinned social profile RPC policy', () => {
  it('limits map reads to the official contract, known maps, and canonical keys', () => {
    const address = '0x0000000000000000000000000000000000000001'
    const addressKey = `0x${Buffer.from(address).toString('hex')}`
    const nameKey = `0x${Buffer.from('alice_1').toString('hex')}`

    for (const map of ['a:', 'b:', 'p:', 'i:', 'v:', 'r:']) {
      expect(
        validateSocialProfileReadMap([
          SOCIAL_PROFILE_CONTRACT_ADDRESS,
          map,
          addressKey,
          'string',
        ])
      ).toBeNull()
    }
    for (const map of ['n:', 'x:']) {
      expect(
        validateSocialProfileReadMap([
          SOCIAL_PROFILE_CONTRACT_ADDRESS,
          map,
          nameKey,
          'string',
        ])
      ).toBeNull()
    }

    for (const invalid of [
      [
        '0x0000000000000000000000000000000000000002',
        'a:',
        addressKey,
        'string',
      ],
      [SOCIAL_PROFILE_CONTRACT_ADDRESS, 'owner:', addressKey, 'string'],
      [SOCIAL_PROFILE_CONTRACT_ADDRESS, 'a:', nameKey, 'string'],
      [SOCIAL_PROFILE_CONTRACT_ADDRESS, 'n:', addressKey, 'string'],
      [SOCIAL_PROFILE_CONTRACT_ADDRESS, 'a:', addressKey, 'hex'],
      [
        SOCIAL_PROFILE_CONTRACT_ADDRESS,
        'a:',
        addressKey.toUpperCase(),
        'string',
      ],
      [SOCIAL_PROFILE_CONTRACT_ADDRESS, 'a:', addressKey, 'string', 'extra'],
    ]) {
      expect(validateSocialProfileReadMap(invalid)).toBe('invalid_rpc_params')
    }
  })

  it('accepts only zero-value profile writes with bounded exact arguments', () => {
    for (const method of ['claimName', 'dropName', 'setProfile']) {
      const call = makeProfileCall(method)
      expect(validateSocialProfileCall(call)).toBeNull()
      expect(socialContractCallRequiresConfirmation(call)).toBe(true)
      expect(validateSocialProfileCall({...call, amount: '0.000001'})).toBe(
        'invalid_social_contract_call'
      )
      expect(
        validateSocialProfileCall({...call, maxFee: '10.000000000000000001'})
      ).toBe('invalid_social_contract_call')
      expect(validateSocialProfileCall({...call, method: 'terminate'})).toBe(
        'invalid_social_contract_call'
      )
      expect(
        validateSocialProfileCall({...call, contract: makeCall().contract})
      ).toBe('invalid_social_contract_call')
    }

    expect(
      validateSocialProfileCall(makeProfileCall('dropName', {args: [{}]}))
    ).toBe('invalid_social_contract_call')
    expect(
      validateSocialProfileCall(
        makeProfileCall('claimName', {
          args: [
            {
              format: 'string',
              index: 0,
              value: JSON.stringify({
                name: 'Alice',
                _gas: 3_000_000,
                _keepGas: 1_000_000,
              }),
            },
          ],
        })
      )
    ).toBe('invalid_social_contract_call')
    expect(
      validateSocialProfileCall(
        makeProfileCall('claimName', {
          args: [
            {
              format: 'string',
              index: 0,
              value: JSON.stringify({
                name: 123,
                _gas: 3_000_000,
                _keepGas: 1_000_000,
              }),
            },
          ],
        })
      )
    ).toBe('invalid_social_contract_call')
    expect(
      validateSocialProfileCall(
        makeProfileCall('setProfile', {
          args: [
            {
              format: 'string',
              index: 0,
              value: JSON.stringify({
                bio: 'x'.repeat(161),
                picture: '',
                _gas: 3_000_000,
                _keepGas: 1_000_000,
              }),
            },
          ],
        })
      )
    ).toBe('invalid_social_contract_call')
    expect(
      validateSocialProfileCall(
        makeProfileCall('setProfile', {
          args: [
            {
              format: 'string',
              index: 0,
              value: JSON.stringify({
                bio: '',
                picture: 'https://example.test/image',
                _gas: 3_000_000,
                _keepGas: 1_000_000,
              }),
            },
          ],
        })
      )
    ).toBe('invalid_social_contract_call')
  })

  it('bounds the dedicated profile picture request', () => {
    expect(SOCIAL_PROFILE_PICTURE_MAX_RESPONSE_BYTES).toBe(128 * 1024)
    expect(
      validateSocialProfilePictureCid([
        'bafybeigdyrzt5z4jj7f26dx3e6nqoeqcn2xyv4lrfjltx3dyx47n56lcfi',
      ])
    ).toBeNull()
    for (const params of [
      [],
      ['short'],
      ['cid/../other'],
      ['b'.repeat(121)],
      ['b'.repeat(59), 'extra'],
    ]) {
      expect(validateSocialProfilePictureCid(params)).toBe('invalid_rpc_params')
    }
  })
})
