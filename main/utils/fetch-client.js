const {Readable} = require('stream')

const DEFAULT_MAX_RESPONSE_BYTES = 32 * 1024 * 1024

function appendParams(url, params) {
  const nextUrl = new URL(url)
  if (params && typeof params === 'object') {
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null) return
      nextUrl.searchParams.set(key, String(value))
    })
  }
  return nextUrl.toString()
}

function normalizeHeaders(headers = {}) {
  return Object.entries(headers || {}).reduce((acc, [key, value]) => {
    if (value !== undefined && value !== null) {
      acc[key] = String(value)
    }
    return acc
  }, {})
}

function normalizeResponseHeaders(headers) {
  const result = {}
  headers.forEach((value, key) => {
    result[key.toLowerCase()] = value
  })
  return result
}

function applyTransforms(value, transforms = []) {
  return transforms.reduce((nextValue, transform) => {
    if (typeof transform !== 'function') return nextValue
    return transform(nextValue)
  }, value)
}

function responseTooLargeError(limit) {
  const error = new Error(`response exceeds ${limit} byte limit`)
  error.code = 'ERR_RESPONSE_TOO_LARGE'
  return error
}

function normalizeResponseByteLimit(value) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MAX_RESPONSE_BYTES
}

async function readBufferedResponse(response, maxResponseBytes) {
  const limit = normalizeResponseByteLimit(maxResponseBytes)
  const declaredLength = Number.parseInt(
    response.headers.get('content-length') || '',
    10
  )

  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    throw responseTooLargeError(limit)
  }

  if (!response.body || typeof response.body.getReader !== 'function') {
    const fallback = Buffer.from(await response.arrayBuffer())
    if (fallback.length > limit) {
      throw responseTooLargeError(limit)
    }
    return fallback
  }

  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  let finished = false

  try {
    while (!finished) {
      // eslint-disable-next-line no-await-in-loop
      const {done, value} = await reader.read()
      finished = done
      if (finished) break

      const chunk = Buffer.from(value)
      total += chunk.length
      if (total > limit) {
        if (typeof reader.cancel === 'function') {
          await reader.cancel('response limit exceeded')
        }
        throw responseTooLargeError(limit)
      }
      chunks.push(chunk)
    }
  } finally {
    if (typeof reader.releaseLock === 'function') {
      reader.releaseLock()
    }
  }

  return Buffer.concat(chunks, total)
}

async function parseResponseBody(
  response,
  responseType,
  maxResponseBytes,
  transforms = []
) {
  if (responseType === 'stream') {
    return Readable.fromWeb(response.body)
  }
  const buffer = await readBufferedResponse(response, maxResponseBytes)
  if (responseType === 'arraybuffer') {
    return buffer
  }

  const text = buffer.toString('utf8')
  if (!text) return applyTransforms(null, transforms)

  if (transforms.length > 0) {
    return applyTransforms(text, transforms)
  }

  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    return JSON.parse(text)
  }

  try {
    return JSON.parse(text)
  } catch (_) {
    return text
  }
}

function createTimeoutController(timeout) {
  const timeoutMs = Number(timeout)
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return {signal: undefined, clear: () => {}}
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  }
}

async function request(defaults = {}, config = {}) {
  const {
    baseURL,
    method = 'get',
    url = '',
    params,
    data,
    headers,
    timeout,
    responseType,
    validateStatus = (status) => status >= 200 && status < 300,
    transformRequest = [],
    transformResponse = [],
    maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
    redirect = 'follow',
    dispatcher,
  } = {...defaults, ...config}

  const requestUrl = appendParams(new URL(url, baseURL).toString(), params)
  const nextHeaders = normalizeHeaders(headers)
  let body = data

  if (body !== undefined) {
    body = applyTransforms(body, transformRequest)
    if (
      body &&
      typeof body === 'object' &&
      !(body instanceof Buffer) &&
      typeof body.pipe !== 'function'
    ) {
      if (
        !Object.keys(nextHeaders).some(
          (key) => key.toLowerCase() === 'content-type'
        )
      ) {
        nextHeaders['Content-Type'] = 'application/json'
      }
      body = JSON.stringify(body)
    }
  }

  const timeoutController = createTimeoutController(timeout)

  try {
    const response = await fetch(requestUrl, {
      method: String(method || 'get').toUpperCase(),
      headers: nextHeaders,
      body,
      signal: timeoutController.signal,
      redirect,
      dispatcher,
    })
    const responseData = await parseResponseBody(
      response,
      responseType,
      maxResponseBytes,
      transformResponse
    )
    const result = {
      data: responseData,
      status: response.status,
      statusText: response.statusText,
      headers: normalizeResponseHeaders(response.headers),
      config,
    }

    if (!validateStatus(response.status)) {
      const error = new Error(
        `Request failed with status code ${response.status}`
      )
      error.response = result
      throw error
    }

    return result
  } catch (error) {
    if (error && error.name === 'AbortError') {
      const timeoutError = new Error(`timeout of ${timeout}ms exceeded`)
      timeoutError.code = 'ECONNABORTED'
      throw timeoutError
    }
    throw error
  } finally {
    timeoutController.clear()
  }
}

function createFetchClient(defaults = {}) {
  const client = {
    request: (config = {}) => request(defaults, config),
    get: (url, config = {}) =>
      request(defaults, {...config, method: 'get', url}),
    post: (url, data, config = {}) =>
      request(defaults, {...config, method: 'post', url, data}),
    create: (nextDefaults = {}) =>
      createFetchClient({...defaults, ...nextDefaults}),
  }

  return client
}

module.exports = createFetchClient()
module.exports.createFetchClient = createFetchClient
module.exports.DEFAULT_MAX_RESPONSE_BYTES = DEFAULT_MAX_RESPONSE_BYTES
module.exports.readBufferedResponse = readBufferedResponse
