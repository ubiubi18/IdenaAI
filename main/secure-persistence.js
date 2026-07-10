const MAX_SECURE_STATE_BYTES = 64 * 1024
const SECURE_STATE_VERSION = 1

function isSecureStorageAvailable(secureStorage) {
  if (
    !secureStorage ||
    typeof secureStorage.isEncryptionAvailable !== 'function' ||
    typeof secureStorage.encryptString !== 'function' ||
    typeof secureStorage.decryptString !== 'function' ||
    !secureStorage.isEncryptionAvailable()
  ) {
    return false
  }

  return !(
    typeof secureStorage.getSelectedStorageBackend === 'function' &&
    secureStorage.getSelectedStorageBackend() === 'basic_text'
  )
}

function requireSecureStorage(secureStorage) {
  if (!isSecureStorageAvailable(secureStorage)) {
    throw new Error('OS-backed secure storage is unavailable')
  }
}

function encryptSecureState(state, secureStorage) {
  if (state == null) return {}
  requireSecureStorage(secureStorage)

  if (typeof state !== 'object' || Array.isArray(state)) {
    throw new Error('Secure persistence state must be an object')
  }

  const serialized = JSON.stringify(state)
  if (Buffer.byteLength(serialized, 'utf8') > MAX_SECURE_STATE_BYTES) {
    throw new Error('Secure persistence state is too large')
  }

  const ciphertext = secureStorage.encryptString(serialized)
  return {
    version: SECURE_STATE_VERSION,
    ciphertext: Buffer.from(ciphertext).toString('base64'),
  }
}

function decryptSecureState(envelope, secureStorage) {
  if (!envelope || Object.keys(envelope).length === 0) return {}
  requireSecureStorage(secureStorage)

  if (
    envelope.version !== SECURE_STATE_VERSION ||
    typeof envelope.ciphertext !== 'string' ||
    !envelope.ciphertext
  ) {
    throw new Error('Secure persistence state is invalid')
  }

  const ciphertext = Buffer.from(envelope.ciphertext, 'base64')
  if (
    ciphertext.length === 0 ||
    ciphertext.length > MAX_SECURE_STATE_BYTES * 2
  ) {
    throw new Error('Secure persistence ciphertext is invalid')
  }

  const state = JSON.parse(secureStorage.decryptString(ciphertext))
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error('Secure persistence plaintext is invalid')
  }
  return state
}

module.exports = {
  MAX_SECURE_STATE_BYTES,
  SECURE_STATE_VERSION,
  decryptSecureState,
  encryptSecureState,
  isSecureStorageAvailable,
}
