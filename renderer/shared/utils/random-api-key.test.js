import {randomApiKey} from './random-api-key'

describe('randomApiKey', () => {
  it('uses 256 bits from a cryptographically secure source', () => {
    const getRandomValues = jest.fn((bytes) => {
      bytes.forEach((_, index) => {
        bytes[index] = index
      })
      return bytes
    })

    const key = randomApiKey({getRandomValues})

    expect(getRandomValues).toHaveBeenCalledTimes(1)
    expect(getRandomValues.mock.calls[0][0]).toHaveLength(32)
    expect(key).toBe(
      '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'
    )
  })

  it('fails closed when secure random generation is unavailable', () => {
    expect(() => randomApiKey({})).toThrow('Secure random generation')
  })
})
