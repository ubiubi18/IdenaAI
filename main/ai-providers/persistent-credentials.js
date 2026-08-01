const net = require('net')
const path = require('path')

const DEFAULT_TIMEOUT_MS = 3000
const MAX_RESPONSE_BYTES = 16 * 1024
const SUPPORTED_PROVIDERS = new Set(['openai'])

function normalizeProvider(provider) {
  const normalized = String(provider || '')
    .trim()
    .toLowerCase()

  if (!SUPPORTED_PROVIDERS.has(normalized)) {
    throw new Error(
      `Persistent credentials are not supported for provider: ${normalized}`
    )
  }

  return normalized
}

function normalizeSocketPath(socketPath) {
  const normalized = String(socketPath || '').trim()

  if (!normalized) {
    return ''
  }

  if (
    !path.isAbsolute(normalized) ||
    normalized.includes('\u0000') ||
    normalized.length > 4096
  ) {
    throw new Error('Persistent credential socket path is invalid')
  }

  return normalized
}

function normalizeApiKey(apiKey) {
  const normalized = String(apiKey || '').trim()
  const hasWhitespaceOrControl = Array.from(normalized).some((character) => {
    const codePoint = character.codePointAt(0)
    return codePoint <= 0x20 || codePoint === 0x7f
  })

  if (
    normalized.length < 16 ||
    normalized.length > 4096 ||
    hasWhitespaceOrControl
  ) {
    throw new Error('Provider API key has an invalid format')
  }

  return normalized
}

function createPersistentCredentialClient(options = {}) {
  const socketPath = normalizeSocketPath(
    options.socketPath || process.env.IDENA_AI_PROVIDER_CREDENTIAL_SOCKET
  )
  const connect =
    typeof options.connect === 'function'
      ? options.connect
      : net.createConnection
  const timeoutMs = Math.max(
    250,
    Math.min(10000, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS)
  )

  function isSupported({provider} = {}) {
    const normalized = normalizeProvider(provider)
    return {
      ok: true,
      provider: normalized,
      supported: Boolean(socketPath),
    }
  }

  async function request(operation, {provider, apiKey} = {}) {
    const normalizedProvider = normalizeProvider(provider)

    if (!socketPath) {
      throw new Error('Persistent credential storage is not configured')
    }

    const payload = {
      version: 1,
      operation,
      provider: normalizedProvider,
    }

    if (operation === 'store') {
      payload.credential = normalizeApiKey(apiKey)
    }

    return new Promise((resolve, reject) => {
      let settled = false
      let responseBytes = 0
      const chunks = []
      const socket = connect({path: socketPath})

      function finish(error, result) {
        if (settled) {
          return
        }
        settled = true
        socket.destroy()
        if (error) {
          reject(error)
        } else {
          resolve(result)
        }
      }

      socket.setTimeout(timeoutMs)
      socket.once('timeout', () => {
        finish(new Error('Persistent credential broker timed out'))
      })
      socket.once('error', (error) => {
        finish(
          new Error(
            `Persistent credential broker is unavailable: ${String(
              error && error.code ? error.code : 'connection_failed'
            )}`
          )
        )
      })
      socket.on('data', (chunk) => {
        responseBytes += chunk.length
        if (responseBytes > MAX_RESPONSE_BYTES) {
          finish(
            new Error('Persistent credential broker response is too large')
          )
          return
        }
        chunks.push(chunk)
      })
      socket.once('end', () => {
        if (settled) {
          return
        }

        let response
        try {
          response = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        } catch {
          finish(
            new Error('Persistent credential broker returned invalid data')
          )
          return
        }

        if (!response || response.ok !== true) {
          finish(
            new Error(
              String(response && response.error ? response.error : '').trim() ||
                'Persistent credential broker rejected the request'
            )
          )
          return
        }

        finish(null, response)
      })
      socket.once('connect', () => {
        socket.end(`${JSON.stringify(payload)}\n`, 'utf8')
      })
    })
  }

  async function loadProviderKey({provider} = {}) {
    const normalized = normalizeProvider(provider)

    if (!socketPath) {
      return {
        ok: true,
        provider: normalized,
        supported: false,
        hasKey: false,
        apiKey: null,
      }
    }

    const response = await request('load', {provider: normalized})
    const hasKey = response.hasKey === true

    return {
      ok: true,
      provider: normalized,
      supported: true,
      hasKey,
      apiKey: hasKey ? normalizeApiKey(response.credential) : null,
    }
  }

  async function persistProviderKey({provider, apiKey} = {}) {
    const normalized = normalizeProvider(provider)
    const response = await request('store', {
      provider: normalized,
      apiKey,
    })

    return {
      ok: true,
      provider: normalized,
      supported: true,
      hasKey: response.hasKey === true,
    }
  }

  async function hasPersistentProviderKey({provider} = {}) {
    const normalized = normalizeProvider(provider)

    if (!socketPath) {
      return {
        ok: true,
        provider: normalized,
        supported: false,
        hasKey: false,
      }
    }

    const response = await request('status', {provider: normalized})
    return {
      ok: true,
      provider: normalized,
      supported: true,
      hasKey: response.hasKey === true,
    }
  }

  async function clearPersistentProviderKey({provider} = {}) {
    const normalized = normalizeProvider(provider)

    if (!socketPath) {
      return {
        ok: true,
        provider: normalized,
        supported: false,
        hasKey: false,
      }
    }

    await request('clear', {provider: normalized})
    return {
      ok: true,
      provider: normalized,
      supported: true,
      hasKey: false,
    }
  }

  return {
    isSupported,
    loadProviderKey,
    persistProviderKey,
    hasPersistentProviderKey,
    clearPersistentProviderKey,
  }
}

module.exports = {
  createPersistentCredentialClient,
  normalizeApiKey,
  normalizeSocketPath,
}
