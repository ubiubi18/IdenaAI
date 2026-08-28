const crypto = require('crypto')
const {decrypt, encrypt} = require('eciesjs')
const {keccak_256: keccak256, sha3_256: sha3256} = require('js-sha3')
const {
  privateKeyToAddress,
  privateKeyToPublicKey,
} = require('./utils/idena-crypto')

const SOCIAL_CRYPTO_VERSION = 'host-v1'
const SOCIAL_CONTRACT_ADDRESS = '0x840e092e31e9656ff15e541505039ed77585338e'
const SOCIAL_CRYPTO_MAX_PLAINTEXT_BYTES = 256 * 1024
const SOCIAL_CRYPTO_MAX_CIPHERTEXT_BYTES =
  SOCIAL_CRYPTO_MAX_PLAINTEXT_BYTES + 256
const SOCIAL_CRYPTO_MAX_CIPHERTEXTS = 16

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isIdenaAddress(value) {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)
}

function isTxHash(value) {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value)
}

function isMessageHash(value) {
  return typeof value === 'string' && /^[0-9a-fA-F]{64}$/.test(value)
}

function normalizeHex(value) {
  return String(value || '')
    .replace(/^0x/i, '')
    .toLowerCase()
}

function isPublicKey(value) {
  const hex = normalizeHex(value)
  return hex.length === 130 && hex.startsWith('04') && /^[0-9a-f]+$/.test(hex)
}

function getMessageCiphertexts(payload) {
  if (Array.isArray(payload.ciphertexts)) return payload.ciphertexts
  return [payload.senderCiphertext, payload.recipientCiphertext]
}

function decodeBase64(value, maxBytes) {
  if (
    typeof value !== 'string' ||
    value.length < 4 ||
    value.length > Math.ceil(maxBytes / 3) * 4 + 4 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) {
    throw new Error('invalid_base64_payload')
  }

  const decoded = Buffer.from(value, 'base64')
  if (
    decoded.length < 1 ||
    decoded.length > maxBytes ||
    decoded.toString('base64') !== value
  ) {
    decoded.fill(0)
    throw new Error('invalid_base64_payload')
  }
  return decoded
}

function decodeEventArg(value) {
  const hex = normalizeHex(value)
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-f]+$/.test(hex)) {
    return null
  }
  return Buffer.from(hex, 'hex')
}

function eventArgText(value) {
  const bytes = decodeEventArg(value)
  return bytes ? bytes.toString('utf8') : ''
}

function eventArgAddress(value) {
  const bytes = decodeEventArg(value)
  return bytes && bytes.length === 20 ? `0x${bytes.toString('hex')}` : ''
}

function validateSocialCryptoRequest(payload = {}) {
  if (!isPlainObject(payload)) return 'invalid_crypto_request'

  const {operation, address} = payload
  if (!['status', 'encrypt-message', 'decrypt-message'].includes(operation)) {
    return 'unsupported_crypto_operation'
  }
  if (!isIdenaAddress(address)) return 'invalid_crypto_address'

  if (operation === 'status') {
    return Object.keys(payload).every((key) =>
      ['operation', 'address'].includes(key)
    )
      ? null
      : 'invalid_crypto_request'
  }

  if (operation === 'encrypt-message') {
    if (!isPublicKey(payload.recipientPublicKey)) {
      return 'invalid_recipient_public_key'
    }
    if (
      typeof payload.plaintext !== 'string' ||
      Buffer.byteLength(payload.plaintext, 'utf8') < 1 ||
      Buffer.byteLength(payload.plaintext, 'utf8') >
        SOCIAL_CRYPTO_MAX_PLAINTEXT_BYTES
    ) {
      return 'invalid_message_plaintext'
    }
    return null
  }

  const ciphertexts = getMessageCiphertexts(payload)
  if (
    !isTxHash(payload.txHash) ||
    !isMessageHash(payload.messageHash) ||
    ciphertexts.length < 2 ||
    ciphertexts.length > SOCIAL_CRYPTO_MAX_CIPHERTEXTS ||
    (Array.isArray(payload.ciphertexts) &&
      ((payload.senderCiphertext !== undefined &&
        payload.senderCiphertext !== ciphertexts[0]) ||
        (payload.recipientCiphertext !== undefined &&
          payload.recipientCiphertext !== ciphertexts[1])))
  ) {
    return 'invalid_decrypt_request'
  }

  const decodedCiphertexts = []
  try {
    for (const ciphertext of ciphertexts) {
      decodedCiphertexts.push(
        decodeBase64(ciphertext, SOCIAL_CRYPTO_MAX_CIPHERTEXT_BYTES)
      )
    }
  } catch {
    return 'invalid_decrypt_request'
  } finally {
    decodedCiphertexts.forEach((ciphertext) => ciphertext.fill(0))
  }

  return null
}

function decryptExportedPrivateKey(encryptedKey, password) {
  if (
    typeof encryptedKey !== 'string' ||
    !/^[0-9a-fA-F]{120}$/.test(encryptedKey)
  ) {
    throw new Error('invalid_exported_identity_key')
  }

  const payload = Buffer.from(encryptedKey, 'hex')
  const nonce = payload.subarray(0, 12)
  const ciphertext = payload.subarray(12, payload.length - 16)
  const authTag = payload.subarray(payload.length - 16)
  const key = Buffer.from(sha3256.arrayBuffer(password))

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce)
    decipher.setAuthTag(authTag)
    const privateKey = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ])

    if (privateKey.length !== 32) {
      privateKey.fill(0)
      throw new Error('invalid_exported_identity_key')
    }
    return privateKey
  } catch (error) {
    if (error && error.message === 'invalid_exported_identity_key') {
      throw error
    }
    throw new Error('identity_key_decryption_failed')
  } finally {
    key.fill(0)
    payload.fill(0)
  }
}

function normalizeRpcResult(response, errorCode) {
  if (!response || response.error || response.result === undefined) {
    throw new Error(
      (response && response.error && response.error.message) || errorCode
    )
  }
  return response.result
}

async function withNodePrivateKey(rpcCall, expectedAddress, operation) {
  const currentAddress = normalizeRpcResult(
    await rpcCall({method: 'dna_getCoinbaseAddr', params: []}),
    'identity_address_unavailable'
  )

  if (
    !isIdenaAddress(currentAddress) ||
    currentAddress.toLowerCase() !== expectedAddress.toLowerCase()
  ) {
    throw new Error('identity_address_mismatch')
  }

  const password = crypto.randomBytes(32).toString('base64url')
  let privateKey

  try {
    const exportedKey = normalizeRpcResult(
      await rpcCall({method: 'dna_exportKey', params: [password]}),
      'identity_key_export_failed'
    )
    privateKey = decryptExportedPrivateKey(exportedKey, password)

    if (
      privateKeyToAddress(privateKey).toLowerCase() !==
      currentAddress.toLowerCase()
    ) {
      throw new Error('exported_identity_key_mismatch')
    }

    return await operation(privateKey, currentAddress.toLowerCase())
  } finally {
    if (privateKey) privateKey.fill(0)
  }
}

function findVerifiedMessageEvent(receipt, payload, ciphertexts) {
  if (
    !receipt ||
    receipt.success !== true ||
    String(receipt.contract || '').toLowerCase() !== SOCIAL_CONTRACT_ADDRESS ||
    receipt.method !== 'sendMessage' ||
    String(receipt.txHash || '').toLowerCase() !== payload.txHash.toLowerCase()
  ) {
    throw new Error('unverified_message_transaction')
  }

  const serializedCiphertexts = ciphertexts.join(',')
  const messageHash = payload.messageHash.toLowerCase()
  const event = Array.isArray(receipt.events)
    ? receipt.events.find(
        (candidate) =>
          candidate &&
          candidate.event === 'sendMessage' &&
          String(candidate.contract || '').toLowerCase() ===
            SOCIAL_CONTRACT_ADDRESS &&
          Array.isArray(candidate.args) &&
          candidate.args.some(
            (arg) => eventArgText(arg) === serializedCiphertexts
          ) &&
          candidate.args.some(
            (arg) => eventArgText(arg).toLowerCase() === messageHash
          ) &&
          candidate.args.some((arg) => eventArgText(arg) === 'true')
      )
    : null

  if (!event) throw new Error('unverified_message_event')
  return event
}

function parseVerifiedPlaintext(
  plaintext,
  event,
  address,
  messageHash,
  ciphertextCount,
  ciphertextIndexes
) {
  if (keccak256(plaintext).toLowerCase() !== messageHash.toLowerCase()) {
    throw new Error('message_hash_mismatch')
  }

  let parsed
  try {
    parsed = JSON.parse(plaintext)
  } catch {
    throw new Error('invalid_message_plaintext')
  }

  const participants = Array.isArray(parsed) ? parsed[0] : null
  if (
    !Array.isArray(participants) ||
    participants.length !== ciphertextCount ||
    participants.length < 2 ||
    participants.length > SOCIAL_CRYPTO_MAX_CIPHERTEXTS ||
    (participants.length > 2 &&
      new Set(participants.map((item) => String(item).toLowerCase())).size !==
        participants.length) ||
    !participants.every(isIdenaAddress)
  ) {
    throw new Error('invalid_message_participants')
  }

  const normalizedParticipants = participants.map((item) => item.toLowerCase())
  const normalizedAddress = address.toLowerCase()
  const eventSender = event.args.map(eventArgAddress).find(Boolean)

  if (
    !eventSender ||
    normalizedParticipants[0] !== eventSender.toLowerCase() ||
    !normalizedParticipants.includes(normalizedAddress)
  ) {
    throw new Error('message_participant_mismatch')
  }

  const participantIndexes = normalizedParticipants.reduce(
    (indexes, participant, index) => {
      if (participant === normalizedAddress) indexes.push(index)
      return indexes
    },
    []
  )
  const normalizedCiphertextIndexes = [...ciphertextIndexes].sort(
    (left, right) => left - right
  )

  if (
    participantIndexes.length !== normalizedCiphertextIndexes.length ||
    participantIndexes.some(
      (participantIndex, index) =>
        participantIndex !== normalizedCiphertextIndexes[index]
    )
  ) {
    throw new Error('message_ciphertext_participant_mismatch')
  }

  const isSender = participantIndexes.includes(0)
  const isRecipient = participantIndexes.some((index) => index > 0)
  let role = 'recipient'
  if (isSender) role = isRecipient ? 'both' : 'sender'

  return {role}
}

function createIdenaSocialCryptoService({rpcCall}) {
  if (typeof rpcCall !== 'function') {
    throw new TypeError('rpcCall is required')
  }

  return async function handleSocialCrypto(payload = {}) {
    const validationError = validateSocialCryptoRequest(payload)
    if (validationError) return {error: {message: validationError}}

    try {
      if (payload.operation === 'status') {
        return await withNodePrivateKey(rpcCall, payload.address, async () => ({
          result: {available: true, version: SOCIAL_CRYPTO_VERSION},
        }))
      }

      if (payload.operation === 'encrypt-message') {
        return await withNodePrivateKey(
          rpcCall,
          payload.address,
          async (privateKey) => {
            const plaintext = Buffer.from(payload.plaintext, 'utf8')
            try {
              const ownPublicKey = Uint8Array.from(
                privateKeyToPublicKey(privateKey)
              )
              const recipientPublicKey = Uint8Array.from(
                Buffer.from(normalizeHex(payload.recipientPublicKey), 'hex')
              )
              const senderCiphertext = Buffer.from(
                encrypt(ownPublicKey, plaintext)
              )
              const recipientCiphertext = Buffer.from(
                encrypt(recipientPublicKey, plaintext)
              )

              return {
                result: {
                  senderCiphertext: senderCiphertext.toString('base64'),
                  recipientCiphertext: recipientCiphertext.toString('base64'),
                  version: SOCIAL_CRYPTO_VERSION,
                },
              }
            } finally {
              plaintext.fill(0)
            }
          }
        )
      }

      const receipt = normalizeRpcResult(
        await rpcCall({method: 'bcn_txReceipt', params: [payload.txHash]}),
        'message_receipt_unavailable'
      )
      const ciphertexts = getMessageCiphertexts(payload)
      const event = findVerifiedMessageEvent(receipt, payload, ciphertexts)

      return await withNodePrivateKey(
        rpcCall,
        payload.address,
        async (privateKey) => {
          const encryptedMessages = ciphertexts.map((ciphertext) =>
            decodeBase64(ciphertext, SOCIAL_CRYPTO_MAX_CIPHERTEXT_BYTES)
          )
          let plaintextBytes
          const ciphertextIndexes = []

          try {
            for (let index = 0; index < encryptedMessages.length; index += 1) {
              let candidatePlaintext
              try {
                candidatePlaintext = Buffer.from(
                  decrypt(
                    Uint8Array.from(privateKey),
                    Uint8Array.from(encryptedMessages[index])
                  )
                )
              } catch {
                candidatePlaintext = null
              }

              if (candidatePlaintext) {
                try {
                  if (
                    candidatePlaintext.length >
                    SOCIAL_CRYPTO_MAX_PLAINTEXT_BYTES
                  ) {
                    throw new Error('message_plaintext_too_large')
                  }
                  if (
                    plaintextBytes &&
                    !plaintextBytes.equals(candidatePlaintext)
                  ) {
                    throw new Error('message_ciphertext_plaintext_mismatch')
                  }

                  if (!plaintextBytes) {
                    plaintextBytes = candidatePlaintext
                    candidatePlaintext = null
                  }
                  ciphertextIndexes.push(index)
                } finally {
                  if (candidatePlaintext) candidatePlaintext.fill(0)
                }
              }
            }

            if (!plaintextBytes) throw new Error('message_not_for_identity')

            const plaintext = plaintextBytes.toString('utf8')
            const {role} = parseVerifiedPlaintext(
              plaintext,
              event,
              payload.address,
              payload.messageHash,
              ciphertexts.length,
              ciphertextIndexes
            )
            return {
              result: {
                plaintext,
                role,
                ciphertextIndexes,
                version: SOCIAL_CRYPTO_VERSION,
              },
            }
          } finally {
            encryptedMessages.forEach((item) => item.fill(0))
            if (plaintextBytes) plaintextBytes.fill(0)
          }
        }
      )
    } catch (error) {
      return {
        error: {
          message:
            error && error.message ? error.message : 'social_crypto_failed',
        },
      }
    }
  }
}

module.exports = {
  SOCIAL_CONTRACT_ADDRESS,
  SOCIAL_CRYPTO_MAX_CIPHERTEXT_BYTES,
  SOCIAL_CRYPTO_MAX_CIPHERTEXTS,
  SOCIAL_CRYPTO_MAX_PLAINTEXT_BYTES,
  SOCIAL_CRYPTO_VERSION,
  createIdenaSocialCryptoService,
  decryptExportedPrivateKey,
  validateSocialCryptoRequest,
}
