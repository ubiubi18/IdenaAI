const {sha256Json, sha256Text, stableStringify} = require('./hash')

describe('local-rag hash helpers', () => {
  it('hashes text with stable sha256 output', () => {
    expect(sha256Text('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
  })

  it('stable stringifies objects independent of key order', () => {
    expect(stableStringify({b: 2, a: 1})).toBe('{"a":1,"b":2}')
    expect(sha256Json({b: 2, a: 1})).toBe(sha256Json({a: 1, b: 2}))
  })
})
