const {EventEmitter} = require('events')

const {
  createPersistentCredentialClient,
  normalizeApiKey,
  normalizeSocketPath,
} = require('./persistent-credentials')

const sessionCredential = ['fixture', 'session', 'credential', 'value'].join(
  '-'
)
const persistedCredential = [
  'fixture',
  'persisted',
  'credential',
  'value',
].join('-')

class FakeSocket extends EventEmitter {
  constructor(response) {
    super()
    this.response = response
    this.request = ''
    this.destroyed = false
  }

  setTimeout(timeoutMs) {
    this.timeoutMs = timeoutMs
  }

  destroy() {
    this.destroyed = true
  }

  end(data) {
    this.request += data
    queueMicrotask(() => {
      this.emit('data', Buffer.from(JSON.stringify(this.response)))
      this.emit('end')
    })
  }
}

describe('persistent AI provider credentials', () => {
  it('rejects whitespace and control characters in API keys', () => {
    expect(() =>
      normalizeApiKey('fixture-provider-credential-value')
    ).not.toThrow()
    expect(() => normalizeApiKey('fixture provider credential value')).toThrow(
      'invalid format'
    )
    expect(() => normalizeApiKey('short')).toThrow('invalid format')
  })

  it('requires an absolute broker socket path', () => {
    expect(normalizeSocketPath('')).toBe('')
    expect(normalizeSocketPath('/run/idena-ai/credentials.sock')).toBe(
      '/run/idena-ai/credentials.sock'
    )
    expect(() => normalizeSocketPath('credentials.sock')).toThrow(
      'socket path is invalid'
    )
  })

  it('stores a session key without returning it in the result', async () => {
    let socket
    const client = createPersistentCredentialClient({
      socketPath: '/run/idena-ai/credentials.sock',
      connect: () => {
        socket = new FakeSocket({ok: true, hasKey: true})
        queueMicrotask(() => socket.emit('connect'))
        return socket
      },
    })

    const result = await client.persistProviderKey({
      provider: 'openai',
      apiKey: sessionCredential,
    })

    expect(result).toEqual({
      ok: true,
      provider: 'openai',
      supported: true,
      hasKey: true,
    })
    expect(result).not.toHaveProperty('apiKey')
    expect(JSON.parse(socket.request)).toEqual({
      version: 1,
      operation: 'store',
      provider: 'openai',
      credential: sessionCredential,
    })
  })

  it('loads an encrypted host credential only into the main-process caller', async () => {
    let socket
    const client = createPersistentCredentialClient({
      socketPath: '/run/idena-ai/credentials.sock',
      connect: () => {
        socket = new FakeSocket({
          ok: true,
          hasKey: true,
          credential: persistedCredential,
        })
        queueMicrotask(() => socket.emit('connect'))
        return socket
      },
    })

    await expect(client.loadProviderKey({provider: 'openai'})).resolves.toEqual(
      {
        ok: true,
        provider: 'openai',
        supported: true,
        hasKey: true,
        apiKey: persistedCredential,
      }
    )
  })

  it('reports persistence as unsupported when no broker is configured', async () => {
    const client = createPersistentCredentialClient({socketPath: ''})

    await expect(
      client.hasPersistentProviderKey({provider: 'openai'})
    ).resolves.toEqual({
      ok: true,
      provider: 'openai',
      supported: false,
      hasKey: false,
    })
  })
})
