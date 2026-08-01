const SOCIAL_RPC_MAX_REQUEST_ID_LENGTH = 128
const SOCIAL_RPC_MAX_PAYLOAD_BYTES = 8 * 1024 * 1024

export const SOCIAL_CONTRACT_ADDRESS =
  '0x840e092e31e9656fF15E541505039ed77585338E'
export const SOCIAL_OFFICIAL_INDEXER_URL = 'https://api.idena.io'
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
      return params.length === 1 &&
        isPlainObject(params[0]) &&
        isShortString(params[0].from, 128) &&
        isShortString(params[0].contract, 128) &&
        isShortString(params[0].method, 128) &&
        Array.isArray(params[0].args)
        ? null
        : 'invalid_rpc_params'

    default:
      return 'unsupported_rpc_method'
  }
}
