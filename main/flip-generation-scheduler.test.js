const {
  MIN_DELAY_MS,
  MAX_DELAY_MS,
  createFlipGenerationScheduler,
} = require('./flip-generation-scheduler')

describe('post-session flip generation', () => {
  let state
  let current
  let time
  let generate
  let chooseDelay
  let failure
  const end = 1800000000000
  beforeEach(() => {
    state = {}
    time = end
    current = {
      enabled: true,
      ready: true,
      period: 'None',
      epoch: 42,
      sessionId: 'synthetic-session',
      sessionEndedAt: end,
      missingPairs: [{id: 0}, {id: 1}],
    }
    generate = jest.fn().mockResolvedValue(undefined)
    chooseDelay = jest.fn(() => MIN_DELAY_MS)
    failure = jest.fn()
  })
  function runner() {
    return createFlipGenerationScheduler({
      snapshot: async () => current,
      load: () => state,
      save: (value) => {
        state = JSON.parse(JSON.stringify(value))
      },
      generate,
      now: () => time,
      chooseDelay,
      onFailure: failure,
    })
  }
  it('starts on the first eligible tick by default', async () => {
    const service = createFlipGenerationScheduler({
      snapshot: async () => current,
      load: () => state,
      save: (value) => {
        state = JSON.parse(JSON.stringify(value))
      },
      generate,
      now: () => time,
    })
    expect(await service.tick()).toBe('scheduled')
    expect(generate).toHaveBeenCalledTimes(1)
    expect(state.dueAt).toBe(end + 5 * 60 * 1000)
    expect(state.expiresAt).toBe(end + MAX_DELAY_MS)
  })
  it('honors an already scheduled deadline at the four-hour boundary', async () => {
    chooseDelay.mockReturnValue(MAX_DELAY_MS)
    await runner().tick()
    time = end + MAX_DELAY_MS - 1
    expect(await runner().tick()).toBe('waiting')
    expect(generate).not.toHaveBeenCalled()
    time += 1
    await runner().tick()
    expect(generate).toHaveBeenCalledTimes(1)
    expect(chooseDelay).toHaveBeenCalledTimes(1)
  })
  it.each(['ShortSession', 'LongSession', 'AfterLongSession', 'FlipLottery'])(
    'does not start during %s',
    async (period) => {
      current.period = period
      time += MAX_DELAY_MS
      expect(await runner().tick()).toBe('session_active')
      expect(generate).not.toHaveBeenCalled()
      expect(state).toEqual({})
    }
  )
  it('does not replay an old session on first enablement', async () => {
    time += MAX_DELAY_MS + 1
    expect(await runner().tick()).toBe('missed_window')
    expect(generate).not.toHaveBeenCalled()
  })
  it('finishes a started batch after four hours without generating a pair twice', async () => {
    time += MAX_DELAY_MS
    await runner().tick()
    time += 5 * 60 * 1000
    await runner().tick()
    time += 5 * 60 * 1000
    expect(await runner().tick()).toBe('completed')
    await runner().tick()
    expect(generate.mock.calls.map(([pair]) => pair.id)).toEqual([0, 1])
  })
  it('honors a manual draft created while waiting', async () => {
    chooseDelay.mockReturnValue(MAX_DELAY_MS)
    await runner().tick()
    current.missingPairs = []
    time += MAX_DELAY_MS
    expect(await runner().tick()).toBe('completed')
    expect(generate).not.toHaveBeenCalled()
  })
  it('stops an interrupted paid request instead of automatically repeating it', async () => {
    chooseDelay.mockReturnValue(MAX_DELAY_MS)
    await runner().tick()
    state.status = 'running'
    state.activePair = 0
    time += MAX_DELAY_MS
    expect(await runner().tick()).toBe('interrupted')
    await runner().tick()
    expect(generate).not.toHaveBeenCalled()
  })
  it('keeps failures terminal and provider error details out of the journal', async () => {
    generate.mockRejectedValue(
      new Error('synthetic confidential provider details')
    )
    time += MIN_DELAY_MS
    expect(await runner().tick()).toBe('failed')
    await runner().tick()
    expect(generate).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(state)).not.toContain('confidential')
  })
  it('stops after one quality rejection and persists only fixed audit codes', async () => {
    current.missingCount = 2
    generate.mockRejectedValue(
      Object.assign(new Error('private story'), {
        code: 'story_rejected',
        auditReasons: [
          'missing_exact_keyword:private keyword',
          'story_quality_score_below_75',
          'private story',
        ],
      })
    )
    const service = runner()
    expect(await service.tick()).toBe('quality_blocked')
    time += 5 * 60 * 1000
    expect(await service.tick()).toBe('quality_blocked')
    expect(generate.mock.calls.map(([pair]) => pair.id)).toEqual([0])
    expect(state.pairAttempts).toEqual({0: 1})
    expect(state.lastAuditReasons).toEqual([
      'missing_exact_keyword',
      'story_quality_score_below_75',
    ])
    expect(JSON.stringify(state)).not.toContain('private story')
    expect(JSON.stringify(state)).not.toContain('private keyword')
  })
  it('does not reset known attempts when migrating an older session', async () => {
    current.missingPairs = [{id: 2}]
    current.missingCount = 1
    state = {
      sessionId: current.sessionId,
      epoch: current.epoch,
      dueAt: end,
      expiresAt: end + MAX_DELAY_MS,
      status: 'scheduled',
      completedPairs: [0],
      pairAttempts: {1: 9},
      rejectedPairs: [1],
      activePair: null,
    }
    expect(await runner().tick()).toBe('attempts_exhausted')
    expect(state.spendStartedAt).toBe(end)
    expect(state.paidAttemptsInSpendWindow).toBe(10)
    expect(generate).not.toHaveBeenCalled()
  })
  it('waits before checking an exhausted budget and resumes the started batch', async () => {
    generate.mockRejectedValueOnce(
      Object.assign(new Error('budget'), {code: 'budget_exhausted'})
    )
    const service = runner()
    expect(await service.tick()).toBe('waiting_budget')
    expect(await service.tick()).toBe('waiting_budget')
    expect(generate).toHaveBeenCalledTimes(1)
    time += 86400000
    expect(await service.tick()).toBe('scheduled')
    expect(generate).toHaveBeenCalledTimes(2)
    expect(state.completedPairs).toEqual([0])
  })
  it('paces paid attempts after a successful generation', async () => {
    const service = runner()
    expect(await service.tick()).toBe('scheduled')
    expect(state.dueAt).toBe(end + 5 * 60 * 1000)
    expect(await service.tick()).toBe('waiting')
    expect(generate).toHaveBeenCalledTimes(1)
    time = state.dueAt
    expect(await service.tick()).toBe('scheduled')
    expect(generate).toHaveBeenCalledTimes(2)
  })
  it('stops after ten new paid attempts across the session', async () => {
    current.missingPairs = Array.from({length: 11}, (_, id) => ({id}))
    current.missingCount = 11
    const service = runner()
    for (let index = 0; index < 10; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      expect(await service.tick()).toBe('scheduled')
      time += 5 * 60 * 1000
    }
    expect(await service.tick()).toBe('attempts_exhausted')
    expect(generate).toHaveBeenCalledTimes(10)
    expect(state.paidAttemptsInSpendWindow).toBe(10)
  })
  it('waits after a provider rate limit without consuming a quality attempt', async () => {
    generate.mockRejectedValueOnce(
      Object.assign(new Error('private rate-limit detail'), {
        code: 'rate_limited',
        retryAfterMs: 30000,
      })
    )
    const service = runner()
    expect(await service.tick()).toBe('waiting_provider')
    expect(state.dueAt).toBe(end + 15 * 60 * 1000)
    expect(state.pairAttempts).toEqual({})
    expect(state.rejectedPairs).toEqual([])
    expect(state.activePair).toBeNull()
    expect(JSON.stringify(state)).not.toContain('private')
    expect(await service.tick()).toBe('waiting_provider')
    expect(generate).toHaveBeenCalledTimes(1)

    time = state.dueAt
    expect(await service.tick()).toBe('scheduled')
    expect(generate.mock.calls.map(([pair]) => pair.id)).toEqual([0, 0])
    expect(state.completedPairs).toEqual([0])
  })
  it('prevents overlapping timer callbacks from launching another request', async () => {
    let finish
    generate.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    time += MIN_DELAY_MS
    const service = runner()
    const first = service.tick()
    await Promise.resolve()
    await Promise.resolve()
    expect(await service.tick()).toBe('busy')
    finish()
    await first
    expect(generate).toHaveBeenCalledTimes(1)
  })
  it('starts a new epoch after the prior one completed and honors disablement', async () => {
    current.missingPairs = []
    expect(await runner().tick()).toBe('completed')
    current = {
      ...current,
      sessionId: 'next-synthetic-session',
      epoch: 43,
      missingPairs: [{id: 0}],
      enabled: false,
    }
    await runner().tick()
    expect(state.epoch).toBe(42)
    current.enabled = true
    await runner().tick()
    expect(state.epoch).toBe(43)
    expect(generate).toHaveBeenCalledTimes(1)
    expect(chooseDelay).toHaveBeenCalledTimes(2)
  })
})
