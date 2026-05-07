jest.mock('./api-client', () => ({
  __esModule: true,
  default: jest.fn(),
}))

const api = require('./api-client').default
const {
  fetchFlipHashes,
  isDuplicateSubmitTxError,
  submitShortAnswers,
} = require('./validation')

describe('validation api', () => {
  beforeEach(() => {
    api.mockReset()
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
