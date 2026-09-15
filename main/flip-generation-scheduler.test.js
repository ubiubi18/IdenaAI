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
  it.each([MIN_DELAY_MS, MAX_DELAY_MS])(
    'starts at the saved deadline, including boundary %s',
    async (delay) => {
      chooseDelay.mockReturnValue(delay)
      await runner().tick()
      time = end + delay - 1
      expect(await runner().tick()).toBe('waiting')
      expect(generate).not.toHaveBeenCalled()
      time += 1
      await runner().tick()
      expect(generate).toHaveBeenCalledTimes(1)
      expect(chooseDelay).toHaveBeenCalledTimes(1)
    }
  )
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
    time += 60000
    await runner().tick()
    expect(await runner().tick()).toBe('completed')
    await runner().tick()
    expect(generate.mock.calls.map(([pair]) => pair.id)).toEqual([0, 1])
  })
  it('honors a manual draft created while waiting', async () => {
    await runner().tick()
    current.missingPairs = []
    time += MIN_DELAY_MS
    expect(await runner().tick()).toBe('completed')
    expect(generate).not.toHaveBeenCalled()
  })
  it('stops an interrupted paid request instead of automatically repeating it', async () => {
    await runner().tick()
    state.status = 'running'
    state.activePair = 0
    time += MIN_DELAY_MS
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
  it('schedules a new epoch independently and honors disablement', async () => {
    await runner().tick()
    current = {
      ...current,
      sessionId: 'next-synthetic-session',
      epoch: 43,
      enabled: false,
    }
    await runner().tick()
    expect(state.epoch).toBe(42)
    current.enabled = true
    await runner().tick()
    expect(state.epoch).toBe(43)
    expect(chooseDelay).toHaveBeenCalledTimes(2)
  })
})
