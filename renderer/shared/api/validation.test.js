jest.mock('./api-client', () => ({
  __esModule: true,
  default: jest.fn(),
  getRpcParams: jest.fn(),
}))

const {default: api, getRpcParams} = require('./api-client')
const {
  fetchFlipHashes,
  isDuplicateSubmitTxError,
  submitShortAnswers,
  submitLongAnswers,
  prepareValidationSession,
} = require('./validation')

let connection = 0

describe('validation api', () => {
  beforeEach(() => {
    api.mockReset()
    connection += 1
    getRpcParams.mockReturnValue({url: `http://node-${connection}.test`})
  })

  it('normalizes null flip-hash payloads to an empty list', async () => {
    const post = jest.fn(async () => ({
      data: {
        result: null,
      },
    }))

    api.mockReturnValue({post})

    await expect(fetchFlipHashes('short')).resolves.toEqual([])
    expect(post).toHaveBeenCalledWith(
      '/',
      expect.objectContaining({
        method: 'flip_shortHashes',
      })
    )
  })

  it('keeps only valid hash entries from mixed payloads', async () => {
    api.mockReturnValue({
      post: jest.fn(async () => ({
        data: {
          result: [
            null,
            {hash: '  0xabc  ', ready: true, extra: false},
            {hash: '', ready: true},
            {foo: 'bar'},
          ],
        },
      })),
    })

    await expect(fetchFlipHashes('long')).resolves.toEqual([
      {hash: '0xabc', ready: true, extra: false},
    ])
  })

  it('uses a Windows-tolerant timeout for validation answer submits', async () => {
    const post = jest.fn(async () => ({
      data: {
        result: '0xtx',
      },
    }))

    api.mockReturnValue({post})

    await expect(
      submitShortAnswers([{hash: '0xabc', answer: 1}], 0, 1, 'session-1')
    ).resolves.toBe('0xtx')

    expect(post).toHaveBeenCalledWith(
      '/',
      {
        method: 'flip_submitShortAnswers',
        params: [
          {
            answers: [{hash: '0xabc', answer: 1}],
            nonce: 0,
            epoch: 1,
            sessionId: 'session-1',
          },
        ],
        id: 1,
      },
      {
        timeout: 8000,
      }
    )
  })

  it('caps validation submit timeout overrides', async () => {
    const originalEnv = global.env
    global.env = {
      ...(originalEnv || {}),
      VALIDATION_SUBMIT_RPC_TIMEOUT_MS: 120000,
    }
    const post = jest.fn(async () => ({
      data: {
        result: '0xtx',
      },
    }))

    api.mockReturnValue({post})

    try {
      await expect(
        submitShortAnswers([{hash: '0xabc', answer: 1}], 0, 1, 'session-1')
      ).resolves.toBe('0xtx')
    } finally {
      global.env = originalEnv
    }

    expect(post).toHaveBeenCalledWith(
      '/',
      expect.any(Object),
      expect.objectContaining({
        timeout: 30000,
      })
    )
  })

  it('only treats transaction duplicate messages as already submitted', () => {
    expect(
      isDuplicateSubmitTxError(new Error('already known transaction'))
    ).toBe(true)
    expect(isDuplicateSubmitTxError(new Error('duplicate tx'))).toBe(true)
    expect(
      isDuplicateSubmitTxError(new Error('tx with same hash already exists'))
    ).toBe(true)
    expect(isDuplicateSubmitTxError(new Error('account already exists'))).toBe(
      false
    )
    expect(isDuplicateSubmitTxError(new Error('already exists'))).toBe(false)
  })
})

describe('optional validation preparation', () => {
  beforeEach(() => {
    connection += 1
    getRpcParams.mockReturnValue({url: `http://node-${connection}.test`})
    api.mockReset()
  })

  it.each([
    {code: -32601, message: 'Method not found'},
    {
      message:
        'The method flip_prepareValidationSession does not exist/is not available',
    },
  ])(
    'stops unsupported calls without blocking validation (%j)',
    async (error) => {
      const post = jest.fn().mockResolvedValue({data: {error}})
      api.mockReturnValue({post})
      const expected = {cleared: false, sessionId: '', supported: false}
      await expect(
        Promise.all([prepareValidationSession(1), prepareValidationSession(1)])
      ).resolves.toEqual([expected, expected])
      await expect(prepareValidationSession(1)).resolves.toEqual(expected)
      expect(post).toHaveBeenCalledTimes(1)
    }
  )

  it('rechecks support on a different node or epoch', async () => {
    const post = jest.fn().mockResolvedValue({
      data: {
        error: {code: -32601, message: 'Method not found'},
      },
    })
    api.mockReturnValue({post})
    await prepareValidationSession(1)
    await prepareValidationSession(2)
    getRpcParams.mockReturnValue({url: 'http://another-node.test'})
    post.mockResolvedValue({
      data: {result: {cleared: true, sessionID: 'new-session'}},
    })
    await expect(prepareValidationSession(2)).resolves.toEqual({
      cleared: true,
      sessionId: 'new-session',
      supported: true,
    })
    expect(post).toHaveBeenCalledTimes(3)
  })

  it('preserves requested session IDs when preparation is unavailable', async () => {
    const post = jest.fn().mockResolvedValue({
      data: {
        error: {code: -32601, message: 'Method not found'},
      },
    })
    api.mockReturnValue({post})
    await prepareValidationSession(1, 'first')
    await expect(prepareValidationSession(1, 'second')).resolves.toEqual({
      cleared: false,
      sessionId: 'second',
      supported: false,
    })
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('propagates other RPC errors and allows a later retry', async () => {
    const post = jest
      .fn()
      .mockResolvedValueOnce({
        data: {error: {code: -32001, message: 'Unauthorized'}},
      })
      .mockResolvedValue({data: {result: {sessionId: 'ok'}}})
    api.mockReturnValue({post})
    await expect(prepareValidationSession(1)).rejects.toMatchObject({
      code: -32001,
      message: 'Unauthorized',
    })
    await expect(prepareValidationSession(1)).resolves.toMatchObject({
      sessionId: 'ok',
      supported: true,
    })
    expect(post).toHaveBeenCalledTimes(2)
  })

  it('does not cache transport failures as an unsupported method', async () => {
    const post = jest
      .fn()
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValue({data: {result: {cleared: false}}})
    api.mockReturnValue({post})
    await expect(prepareValidationSession(1)).rejects.toThrow(
      'connection reset'
    )
    await expect(prepareValidationSession(1, 'session')).resolves.toEqual({
      cleared: false,
      sessionId: 'session',
      supported: true,
    })
  })
})

describe('validation submission response shapes', () => {
  it.each([submitShortAnswers, submitLongAnswers])(
    'returns a transaction hash string from a node submission object',
    async (submit) => {
      const txHash = `0x${'ab'.repeat(32)}`
      const post = jest.fn().mockResolvedValue({data: {result: {txHash}}})
      api.mockReturnValue({post})
      await expect(submit([], 0, 1)).resolves.toBe(txHash)
      expect(post).toHaveBeenCalledTimes(1)
    }
  )

  it('keeps successful submissions without a hash successful, without retrying', async () => {
    const result = {accepted: true}
    const post = jest.fn().mockResolvedValue({data: {result}})
    api.mockReturnValue({post})
    await expect(submitLongAnswers([], 0, 1)).resolves.toEqual(result)
    expect(post).toHaveBeenCalledTimes(1)
  })
})
