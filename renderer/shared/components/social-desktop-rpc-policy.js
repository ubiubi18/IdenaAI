/* global BigInt */

const SOCIAL_RPC_MAX_REQUEST_ID_LENGTH = 128
const SOCIAL_RPC_MAX_PAYLOAD_BYTES = 8 * 1024 * 1024
const SOCIAL_CRYPTO_MAX_PLAINTEXT_BYTES = 256 * 1024
const SOCIAL_CRYPTO_MAX_CIPHERTEXT_BYTES =
  SOCIAL_CRYPTO_MAX_PLAINTEXT_BYTES + 256
const SOCIAL_CONTRACT_METHODS = new Set(['makePost', 'sendMessage', 'sendTip'])
const SOCIAL_IDNA_SCALE = 10n ** 18n
const SOCIAL_BASE_CALL_AMOUNT = 10n ** 13n
const SOCIAL_MAX_TIP_AMOUNT = 1000n * SOCIAL_IDNA_SCALE
const SOCIAL_MAX_FEE = 10n * SOCIAL_IDNA_SCALE

export const SOCIAL_CONTRACT_ADDRESS =
  '0x840e092e31e9656fF15E541505039ed77585338E'
export const SOCIAL_OFFICIAL_INDEXER_URL = 'https://api.idena.io'
export const SOCIAL_EMBED_DOCUMENT_PATH = 'idena-social://app/index.html#/'
export const SOCIAL_EMBED_ORIGIN = 'idena-social://app'
export const SOCIAL_MESSAGE_CRYPTO_VERSION = 'host-v1'
export const SOCIAL_MAX_IMAGE_BYTES = 1024 * 1024
export const SOCIAL_IMAGE_FORMATS = [
  'PNG',
  'JPEG',
  'GIF',
  'WebP',
  'AVIF',
  'APNG',
  'SVG',
]

const SOCIAL_ALLOWED_RPC_METHODS = new Set([
  'bcn_block',
  'bcn_blockAt',
  'bcn_getRawTx',
  'bcn_lastBlock',
  'bcn_syncing',
  'bcn_transaction',
  'bcn_transactions',
  'bcn_txReceipt',
  'contract_call',
  'dna_epoch',
  'dna_getBalance',
  'dna_getCoinbaseAddr',
  'dna_identity',
  'dna_storeToIpfs',
  'ipfs_add',
  'ipfs_get',
])

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isFiniteNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0
}

function isShortString(value, maxLength = 512) {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= maxLength
  )
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

function isPublicKey(value) {
  const hex = String(value || '').replace(/^0x/i, '')
  return hex.length === 130 && /^04[0-9a-fA-F]{128}$/.test(hex)
}

function isBoundedBase64(value) {
  if (
    typeof value !== 'string' ||
    value.length < 4 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) {
    return false
  }

  return (
    Math.floor((value.length * 3) / 4) <= SOCIAL_CRYPTO_MAX_CIPHERTEXT_BYTES
  )
}

function estimatePayloadBytes(value) {
  try {
    const serialized = JSON.stringify(value)

    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(serialized).length
    }

    return serialized.length
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function decimalToAtoms(value) {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,18}))?$/u.exec(
    String(value ?? '').trim()
  )
  if (!match) return null
  return (
    BigInt(match[1]) * SOCIAL_IDNA_SCALE +
    BigInt((match[2] || '').padEnd(18, '0') || '0')
  )
}

function validateSocialContractCall(call) {
  if (
    !isPlainObject(call) ||
    !isIdenaAddress(call.from) ||
    String(call.contract || '').toLowerCase() !==
      SOCIAL_CONTRACT_ADDRESS.toLowerCase() ||
    !SOCIAL_CONTRACT_METHODS.has(call.method) ||
    !Array.isArray(call.args) ||
    call.args.length !== 1 ||
    !isPlainObject(call.args[0]) ||
    call.args[0].format !== 'string' ||
    call.args[0].index !== 0 ||
    !isShortString(call.args[0].value, 1024 * 1024)
  ) {
    return 'invalid_social_contract_call'
  }

  const amount = decimalToAtoms(call.amount)
  const maxFee = decimalToAtoms(call.maxFee)
  if (amount === null || maxFee === null || maxFee > SOCIAL_MAX_FEE) {
    return 'invalid_social_contract_call'
  }

  if (call.method === 'sendTip') {
    return amount > 0n && amount <= SOCIAL_MAX_TIP_AMOUNT
      ? null
      : 'invalid_social_contract_call'
  }

  return amount === SOCIAL_BASE_CALL_AMOUNT
    ? null
    : 'invalid_social_contract_call'
}

export function isTrustedSocialFrameMessage(event, frameWindow) {
  return Boolean(
    event &&
      frameWindow &&
      event.source === frameWindow &&
      event.origin === SOCIAL_EMBED_ORIGIN
  )
}

export function validateSocialRpcRequest(requestId, method, params) {
  if (
    typeof requestId !== 'string' ||
    requestId.length < 1 ||
    requestId.length > SOCIAL_RPC_MAX_REQUEST_ID_LENGTH
  ) {
    return 'invalid_rpc_request_id'
  }

  if (!SOCIAL_ALLOWED_RPC_METHODS.has(method)) {
    return 'unsupported_rpc_method'
  }

  if (!Array.isArray(params)) {
    return 'invalid_rpc_params'
  }

  if (estimatePayloadBytes(params) > SOCIAL_RPC_MAX_PAYLOAD_BYTES) {
    return 'rpc_payload_too_large'
  }

  switch (method) {
    case 'bcn_syncing':
    case 'bcn_lastBlock':
    case 'dna_epoch':
    case 'dna_getCoinbaseAddr':
      return params.length === 0 ? null : 'invalid_rpc_params'

    case 'bcn_blockAt':
      return params.length === 1 && isFiniteNonNegativeInteger(params[0])
        ? null
        : 'invalid_rpc_params'

    case 'bcn_block':
    case 'bcn_transaction':
    case 'bcn_txReceipt':
    case 'dna_getBalance':
    case 'dna_identity':
    case 'ipfs_get':
      return params.length === 1 && isShortString(params[0], 256)
        ? null
        : 'invalid_rpc_params'

    case 'bcn_transactions': {
      if (params.length !== 1 || !isPlainObject(params[0])) {
        return 'invalid_rpc_params'
      }

      const {address, count, token} = params[0]
      return isIdenaAddress(address) &&
        Number.isInteger(count) &&
        count >= 1 &&
        count <= 100 &&
        (token === undefined || isShortString(token, 1024))
        ? null
        : 'invalid_rpc_params'
    }

    case 'ipfs_add':
      return params.length === 2 &&
        isShortString(params[0], SOCIAL_RPC_MAX_PAYLOAD_BYTES) &&
        typeof params[1] === 'boolean'
        ? null
        : 'invalid_rpc_params'

    case 'dna_storeToIpfs':
      return params.length === 1 &&
        isPlainObject(params[0]) &&
        isShortString(params[0].cid, 256) &&
        isFiniteNonNegativeInteger(params[0].nonce) &&
        isFiniteNonNegativeInteger(params[0].epoch)
        ? null
        : 'invalid_rpc_params'

    case 'bcn_getRawTx':
      return params.length === 1 && isPlainObject(params[0])
        ? null
        : 'invalid_rpc_params'

    case 'contract_call':
      return params.length === 1
        ? validateSocialContractCall(params[0])
        : 'invalid_rpc_params'

    default:
      return 'unsupported_rpc_method'
  }
}

export function validateSocialCryptoRequest(requestId, payload) {
  if (
    typeof requestId !== 'string' ||
    requestId.length < 1 ||
    requestId.length > SOCIAL_RPC_MAX_REQUEST_ID_LENGTH ||
    !isPlainObject(payload) ||
    !isIdenaAddress(payload.address)
  ) {
    return 'invalid_crypto_request'
  }

  if (payload.operation === 'status') {
    return null
  }

  if (payload.operation === 'encrypt-message') {
    return isPublicKey(payload.recipientPublicKey) &&
      typeof payload.plaintext === 'string' &&
      payload.plaintext.length > 0 &&
      estimatePayloadBytes(payload.plaintext) <=
        SOCIAL_CRYPTO_MAX_PLAINTEXT_BYTES
      ? null
      : 'invalid_crypto_request'
  }

  if (payload.operation === 'decrypt-message') {
    return isTxHash(payload.txHash) &&
      isMessageHash(payload.messageHash) &&
      isBoundedBase64(payload.senderCiphertext) &&
      isBoundedBase64(payload.recipientCiphertext)
      ? null
      : 'invalid_crypto_request'
  }

  return 'unsupported_crypto_operation'
}
