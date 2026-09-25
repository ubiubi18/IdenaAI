const {
  decimalToAtoms,
  socialContractCallRequiresConfirmation,
  validateSocialContractCall,
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

  it('limits DM fees to 5 IDNA per ciphertext while posts and tips stay at 10', () => {
    for (const [count, limit] of [
      [2, 10],
      [6, 30],
      [16, 80],
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
