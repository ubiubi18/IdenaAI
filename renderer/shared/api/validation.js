/* eslint-disable import/prefer-default-export */
import api from './api-client'

const VALIDATION_SUBMIT_RPC_TIMEOUT_MS = 4000
const VALIDATION_SUBMIT_ATTEMPTS = 3
const VALIDATION_SUBMIT_RETRY_DELAYS_MS = [700, 1500]

function normalizeRpcError(error) {
  if (!error) {
    return new Error('Unknown node RPC error')
  }

  if (error instanceof Error) {
    return error
  }

  return new Error(String(error))
}

function createRpcError(error = {}) {
  const nextError = new Error(error.message || 'Node RPC returned an error')

  if (error.code !== undefined) {
    nextError.code = error.code
  }

  if (error.data !== undefined) {
    nextError.data = error.data
  }

  return nextError
}

function getErrorMessage(error) {
  return String(
    (error && (error.message || error.code || error.statusText)) || error || ''
  )
}

function isSameHashSubmitError(error) {
  return getErrorMessage(error)
    .toLowerCase()
    .includes('tx with same hash already exists')
}

function isTransientSubmitError(error) {
  const message = getErrorMessage(error).toLowerCase()

  return [
    'aborted',
    'connection',
    'econnaborted',
    'econnrefused',
    'econnreset',
    'enetunreach',
    'etimedout',
    'failed to fetch',
    'network',
    'socket',
    'timeout',
    'rpc_proxy_failed',
    'request failed with status code 500',
    'request failed with status code 502',
    'request failed with status code 503',
    'request failed with status code 504',
  ].some((needle) => message.includes(needle))
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function postValidationRpc(method, params) {
  let lastError = null

  for (let attempt = 0; attempt < VALIDATION_SUBMIT_ATTEMPTS; attempt += 1) {
    try {
      const {data} = await api().post(
        '/',
        {
          method,
          params,
          id: 1,
        },
        {
          timeout: VALIDATION_SUBMIT_RPC_TIMEOUT_MS,
        }
      )
      const {result, error} = data || {}

      if (error) {
        throw createRpcError(error)
      }

      return result
    } catch (error) {
      const normalizedError = normalizeRpcError(error)
      lastError = normalizedError

      if (
        isSameHashSubmitError(normalizedError) ||
        !isTransientSubmitError(normalizedError) ||
        attempt >= VALIDATION_SUBMIT_ATTEMPTS - 1
      ) {
        throw normalizedError
      }

      await wait(VALIDATION_SUBMIT_RETRY_DELAYS_MS[attempt] || 1000)
    }
  }

  throw lastError || new Error('Validation submit failed')
}

function normalizeFlipHashesResult(result) {
  if (!Array.isArray(result)) {
    return []
  }

  return result
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null
      }

      const hash = String(item.hash || '').trim()

      if (!hash) {
        return null
      }

      return {
        ...item,
        hash,
      }
    })
    .filter(Boolean)
}

/**
 * Flip hash
 * @typedef {Object} FlipHash
 * @property {string} hash Flip hash, repesenting it's address in the network
 * @property {boolean} ready Whether flip is ready to be showned or not
 * @property {boolean} extra Whether flip is extra or not
 */

/**
 * Returns list of flip hashes participating in validation session
 *
 * @param {string} type Type of the hash
 *
 * @returns {FlipHash[]} List of flip hashes
 *
 * @example [{hash: "0x123", ready: true, extra: false}, {hash: "0x99999", ready: false, extra: true}]
 */
export async function fetchFlipHashes(type) {
  const {data} = await api().post('/', {
    method: `flip_${type}Hashes`,
    params: [],
    id: 1,
  })
  const {result, error} = data
  if (error) throw new Error(error.message)
  return normalizeFlipHashesResult(result)
}

/**
 * Format used for submitting validation session answers
 * @typedef {Object} Answer
 * @property {import('../types').AnswerType} answer Answer type enumeration: 0 - none, 1 - left, 2 - right, 3 - inappropriate
 * @property {string} hash Flip hash, repesenting it's address in the network
 *
 * @example {hash: "0x123", answer: 1}
 */

/**
 * Submit answers for short session
 *
 * @property {Answer[]} answers List of answers
 * @property {number} nonce Nonce
 * @property {number} epoch Epoch
 *
 * @returns {string} Tx hash
 * @example
 *  submitShortAnswers({answers: [{hash: 0xa1, answer: 1}, {hash: 0xb2, answer: 2}], nonce: 0, epoch: 0})
 */
export async function submitShortAnswers(answers, nonce, epoch, sessionId) {
  return postValidationRpc('flip_submitShortAnswers', [
    {answers, nonce, epoch, sessionId},
  ])
}

/**
 * Submit answers for long session
 *
 * @property {Answer[]} answers List of answers
 * @property {number} nonce Nonce
 * @property {number} epoch Epoch
 *
 * @returns {string} Tx hash
 * @example
 *  submitLongAnswers({answers: [{hash: 0xa1, answer: 1}, {hash: 0x2b, answer: 2}], nonce: 0, epoch: 0})
 */
export async function submitLongAnswers(answers, nonce, epoch) {
  return postValidationRpc('flip_submitLongAnswers', [{answers, nonce, epoch}])
}

export async function prepareValidationSession(epoch, sessionId) {
  const {data} = await api().post('/', {
    method: 'flip_prepareValidationSession',
    params: [{epoch, sessionId}],
    id: 1,
  })
  const {result, error} = data
  if (error) throw new Error(error.message)
  return {
    cleared: Boolean(result && result.cleared),
    sessionId: String(
      (result && (result.sessionId || result.sessionID || result.SessionId)) ||
        sessionId ||
        ''
    ).trim(),
  }
}
