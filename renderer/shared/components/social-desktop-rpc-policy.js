/* global BigInt */

const SOCIAL_RPC_MAX_REQUEST_ID_LENGTH = 128
const SOCIAL_RPC_MAX_PAYLOAD_BYTES = 8 * 1024 * 1024
const SOCIAL_CRYPTO_MAX_PLAINTEXT_BYTES = 256 * 1024
const SOCIAL_CRYPTO_MAX_CIPHERTEXT_BYTES =
  SOCIAL_CRYPTO_MAX_PLAINTEXT_BYTES + 256
const SOCIAL_CRYPTO_MAX_CIPHERTEXTS = 16
const SOCIAL_CONTRACT_METHODS = new Set(['makePost', 'sendMessage', 'sendTip'])
const SOCIAL_PROFILE_METHODS = new Set(['claimName', 'dropName', 'setProfile'])
const SOCIAL_PROFILE_ADDRESS_MAPS = new Set([
  'a:',
  'b:',
  'p:',
  'i:',
  'v:',
  'r:',
])
const SOCIAL_PROFILE_NAME_MAPS = new Set(['n:', 'x:'])
const SOCIAL_IDNA_SCALE = 10n ** 18n
const SOCIAL_BASE_CALL_AMOUNT = 10n ** 13n
const SOCIAL_MESSAGE_CALL_AMOUNT = 2n * SOCIAL_BASE_CALL_AMOUNT
const SOCIAL_MAX_TIP_AMOUNT = 1000n * SOCIAL_IDNA_SCALE
const SOCIAL_MAX_FEE = 10n * SOCIAL_IDNA_SCALE
const SOCIAL_MESSAGE_MAX_FEE = 20n * SOCIAL_IDNA_SCALE

export const SOCIAL_CONTRACT_ADDRESS =
  '0x840e092e31e9656fF15E541505039ed77585338E'
export const SOCIAL_PROFILE_CONTRACT_ADDRESS =
  '0xd558483330925f169bbe692d8ea15b2faa83c17f'
export const SOCIAL_OFFICIAL_INDEXER_URL = 'https://api.idena.io'
export const SOCIAL_EMBED_DOCUMENT_PATH = 'idena-social://app/index.html#/'
export const SOCIAL_EMBED_ORIGIN = 'idena-social://app'
export const SOCIAL_MESSAGE_CRYPTO_VERSION = 'host-v1'
export const SOCIAL_DIRECT_V4_CONTRACT =
  '3730be2217b0de1fdfe73098d37f3174dd9748cb'
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
  'bcn_feePerGas',
  'bcn_getRawTx',
  'bcn_lastBlock',
  'bcn_syncing',
  'bcn_transaction',
  'bcn_transactions',
  'bcn_txReceipt',
  'contract_call',
  'contract_estimateCall',
  'contract_readMap',
  'dna_epoch',
  'dna_getBalance',
  'dna_getCoinbaseAddr',
  'dna_identity',
  'dna_storeToIpfs',
  'ipfs_add',
  'ipfs_get',
  'ipfs_getProfilePicture',
])

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasOnlyKeys(value, allowedKeys) {
  return Object.keys(value).every((key) => allowedKeys.has(key))
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

function getValidatedCiphertexts(payload) {
  const ciphertexts = Array.isArray(payload.ciphertexts)
    ? payload.ciphertexts
    : [payload.senderCiphertext, payload.recipientCiphertext]

  if (
    ciphertexts.length < 2 ||
    ciphertexts.length > SOCIAL_CRYPTO_MAX_CIPHERTEXTS ||
    !ciphertexts.every(isBoundedBase64) ||
    (Array.isArray(payload.ciphertexts) &&
      ((payload.senderCiphertext !== undefined &&
        payload.senderCiphertext !== ciphertexts[0]) ||
        (payload.recipientCiphertext !== undefined &&
          payload.recipientCiphertext !== ciphertexts[1]))) ||
    estimatePayloadBytes(ciphertexts) > SOCIAL_RPC_MAX_PAYLOAD_BYTES
  ) {
    return null
  }

  return ciphertexts
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

function utf8ByteLength(value) {
  return typeof TextEncoder !== 'undefined'
    ? new TextEncoder().encode(value).length
    : value.length * 3
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

function validateSocialProfileReadMap(params) {
  if (
    params.length !== 4 ||
    params[0] !== SOCIAL_PROFILE_CONTRACT_ADDRESS ||
    params[3] !== 'string' ||
    typeof params[2] !== 'string' ||
    params[2].length > 86 ||
    !/^0x(?:[0-9a-f]{2})+$/u.test(params[2])
  ) {
    return 'invalid_rpc_params'
  }

  const bytes = params[2]
    .slice(2)
    .match(/.{2}/gu)
    .map((byte) => Number.parseInt(byte, 16))
  const key = String.fromCharCode(...bytes)
  return (SOCIAL_PROFILE_ADDRESS_MAPS.has(params[1]) &&
    /^0x[0-9a-f]{40}$/u.test(key)) ||
    (SOCIAL_PROFILE_NAME_MAPS.has(params[1]) && /^[a-z0-9_]{3,20}$/u.test(key))
    ? null
    : 'invalid_rpc_params'
}

function validateSocialProfileCall(call) {
  if (
    !isPlainObject(call) ||
    !hasOnlyKeys(
      call,
      new Set(['from', 'contract', 'method', 'amount', 'args', 'maxFee'])
    ) ||
    !isIdenaAddress(call.from) ||
    call.contract !== SOCIAL_PROFILE_CONTRACT_ADDRESS ||
    !SOCIAL_PROFILE_METHODS.has(call.method) ||
    decimalToAtoms(call.amount) !== 0n
  ) {
    return 'invalid_social_contract_call'
  }

  const maxFee = decimalToAtoms(call.maxFee)
  if (maxFee === null || maxFee <= 0n || maxFee > SOCIAL_MAX_FEE) {
    return 'invalid_social_contract_call'
  }

  if (call.method === 'dropName') {
    return Array.isArray(call.args) && call.args.length === 0
      ? null
      : 'invalid_social_contract_call'
  }

  if (
    !Array.isArray(call.args) ||
    call.args.length !== 1 ||
    !isPlainObject(call.args[0]) ||
    !hasOnlyKeys(call.args[0], new Set(['format', 'index', 'value'])) ||
    call.args[0].format !== 'string' ||
    call.args[0].index !== 0 ||
    !isShortString(call.args[0].value, 1024) ||
    utf8ByteLength(call.args[0].value) > 1024
  ) {
    return 'invalid_social_contract_call'
  }

  let argument
  try {
    argument = JSON.parse(call.args[0].value)
  } catch {
    return 'invalid_social_contract_call'
  }
  if (
    !isPlainObject(argument) ||
    argument._gas !== 3_000_000 ||
    argument._keepGas !== 1_000_000
  ) {
    return 'invalid_social_contract_call'
  }

  if (call.method === 'claimName') {
    return hasOnlyKeys(argument, new Set(['name', '_gas', '_keepGas'])) &&
      typeof argument.name === 'string' &&
      /^[a-z0-9_]{3,20}$/u.test(argument.name)
      ? null
      : 'invalid_social_contract_call'
  }

  return hasOnlyKeys(
    argument,
    new Set(['bio', 'picture', '_gas', '_keepGas'])
  ) &&
    typeof argument.bio === 'string' &&
    argument.bio.length <= 160 &&
    utf8ByteLength(argument.bio) <= 640 &&
    typeof argument.picture === 'string' &&
    (argument.picture === '' ||
      (argument.picture.length <= 120 &&
        /^ipfs:\/\/[a-zA-Z0-9]{10,}$/u.test(argument.picture)))
    ? null
    : 'invalid_social_contract_call'
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
  if (amount === null || maxFee === null) {
    return 'invalid_social_contract_call'
  }

  let maxFeeLimit = SOCIAL_MAX_FEE
  if (call.method === 'sendMessage') {
    let argument
    try {
      argument = JSON.parse(call.args[0].value)
    } catch {
      return 'invalid_social_contract_call'
    }
    const ciphertextCount = Array.isArray(argument?.message)
      ? argument.message.length
      : 0
    if (ciphertextCount < 2 || ciphertextCount > 16) {
      return 'invalid_social_contract_call'
    }
    maxFeeLimit = SOCIAL_MESSAGE_MAX_FEE
  }
  if (maxFee > maxFeeLimit) return 'invalid_social_contract_call'

  if (call.method === 'sendTip') {
    return amount > 0n && amount <= SOCIAL_MAX_TIP_AMOUNT
      ? null
      : 'invalid_social_contract_call'
  }

  return amount ===
    (call.method === 'sendMessage'
      ? SOCIAL_MESSAGE_CALL_AMOUNT
      : SOCIAL_BASE_CALL_AMOUNT)
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
    case 'bcn_feePerGas':
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

    case 'ipfs_getProfilePicture':
      return params.length === 1 &&
        typeof params[0] === 'string' &&
        /^[a-zA-Z0-9]{10,120}$/u.test(params[0])
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

    case 'contract_readMap':
      return validateSocialProfileReadMap(params)

    case 'contract_call':
      if (params.length !== 1) return 'invalid_rpc_params'
      return params[0]?.contract === SOCIAL_PROFILE_CONTRACT_ADDRESS
        ? validateSocialProfileCall(params[0])
        : validateSocialContractCall(params[0])

    case 'contract_estimateCall':
      if (params.length !== 1) return 'invalid_rpc_params'
      return params[0]?.method === 'sendMessage'
        ? validateSocialContractCall(params[0])
        : 'invalid_social_contract_call'

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
      getValidatedCiphertexts(payload)
      ? null
      : 'invalid_crypto_request'
  }

  return 'unsupported_crypto_operation'
}

export function validateSocialDirectCheckRequest(payload) {
  if (
    !isPlainObject(payload) ||
    Object.keys(payload).sort().join(',') !== 'message,requestId' ||
    typeof payload.requestId !== 'string' ||
    payload.requestId.length < 1 ||
    payload.requestId.length > SOCIAL_RPC_MAX_REQUEST_ID_LENGTH ||
    typeof payload.message !== 'string' ||
    payload.message.length < 1 ||
    payload.message.length > 2048 ||
    !payload.message.startsWith('{"format":"fod.direct-delivery"')
  ) {
    return 'invalid_direct_check_request'
  }
  return null
}

const SOCIAL_DIRECT_V4_DELIVERY_PATTERN = new RegExp(
  [
    '^\\{"format":"fod\\.direct-delivery","version":2,"network":"idena",',
    `"contract":"${SOCIAL_DIRECT_V4_CONTRACT}",`,
    '"author":"[0-9a-f]{40}","offerId":"[0-9a-f]{64}",',
    '"orderId":([1-9][0-9]{0,19}),"orderNonce":([1-9][0-9]{0,19}),',
    '"buyer":"[0-9a-f]{40}","deliveryKey":"04[0-9a-f]{128}",',
    '"ciphertext":"[0-9a-f]{438}"\\}$',
  ].join('')
)

export function parseSocialV4DeliveryOrder(message) {
  if (typeof message !== 'string' || message.length > 2048) return null
  const match = SOCIAL_DIRECT_V4_DELIVERY_PATTERN.exec(message)
  if (
    !match ||
    BigInt(match[1]) > 18446744073709551615n ||
    BigInt(match[2]) > 18446744073709551615n
  ) {
    return null
  }
  return {orderId: match[1], contract: `0x${SOCIAL_DIRECT_V4_CONTRACT}`}
}
