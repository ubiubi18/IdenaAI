const {
  decryptSecureState,
  encryptSecureState,
  isSecureStorageAvailable,
} = require('./secure-persistence')

function createSecureStorage(backend = 'keychain') {
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => backend,
    encryptString: (value) => Buffer.from(`encrypted:${value}`, 'utf8'),
    decryptString: (value) => value.toString('utf8').replace(/^encrypted:/, ''),
  }
}

describe('secure persistence', () => {
  it('round-trips state without placing plaintext in the envelope', () => {
    const secureStorage = createSecureStorage()
    const state = {scopeKey: 'epoch:node', sessionId: 'session-secret'}

    const envelope = encryptSecureState(state, secureStorage)

    expect(JSON.stringify(envelope)).not.toContain(state.sessionId)
    expect(decryptSecureState(envelope, secureStorage)).toEqual(state)
  })

  it('rejects the weak Linux basic_text fallback', () => {
    const secureStorage = createSecureStorage('basic_text')

    expect(isSecureStorageAvailable(secureStorage)).toBe(false)
    expect(() =>
      encryptSecureState({sessionId: 'secret'}, secureStorage)
    ).toThrow('OS-backed secure storage is unavailable')
  })

  it('rejects malformed envelopes', () => {
    expect(() =>
      decryptSecureState({version: 1, ciphertext: ''}, createSecureStorage())
    ).toThrow('Secure persistence state is invalid')
  })

  it('rejects plaintext values that cannot round-trip as state objects', () => {
    const secureStorage = createSecureStorage()

    expect(() => encryptSecureState([], secureStorage)).toThrow(
      'must be an object'
    )
    expect(() => encryptSecureState('secret', secureStorage)).toThrow(
      'must be an object'
    )
  })
})
