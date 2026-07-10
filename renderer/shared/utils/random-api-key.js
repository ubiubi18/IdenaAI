/* global globalThis */

export function randomApiKey(cryptoSource = globalThis.crypto) {
  if (!cryptoSource || typeof cryptoSource.getRandomValues !== 'function') {
    throw new Error('Secure random generation is unavailable')
  }

  const bytes = new Uint8Array(32)
  cryptoSource.getRandomValues(bytes)
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join(
    ''
  )
}
