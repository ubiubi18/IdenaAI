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
  const amount = overrides.amount || (method === 'sendTip' ? '2.5' : '0.00001')

  return {
    from: '0x0000000000000000000000000000000000000001',
    contract: '0x840e092e31e9656fF15E541505039ed77585338E',
    method,
    amount,
    args: [{format: 'string', index: 0, value: JSON.stringify(argument)}],
    maxFee: '0.1',
  }
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
