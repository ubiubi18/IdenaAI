const MIN_DELAY_MS = 0
const MAX_DELAY_MS = 4 * 60 * 60 * 1000
const MAX_PAIR_ATTEMPTS = 2
const QUALITY_FAILURES = ['story_rejected', 'render_rejected']
const MIN_PROVIDER_RETRY_MS = 15 * 60 * 1000
const MAX_PROVIDER_RETRY_MS = 60 * 60 * 1000

// All state belongs to the app profile. A durable claim precedes each paid run;
// an interrupted request requires review instead of silently buying it again.
function createFlipGenerationScheduler({
  snapshot,
  load,
  save,
  generate,
  now = Date.now,
  chooseDelay = () => MIN_DELAY_MS,
  onFailure = () => {},
}) {
  let busy = false

  async function tick() {
    if (busy) return 'busy'
    busy = true
    try {
      const current = await snapshot()
      if (!current.enabled || !current.ready) return 'disabled_or_unready'
      if (current.period !== 'None') return 'session_active'
      const time = now()
      if (
        !Number.isFinite(current.sessionEndedAt) ||
        current.sessionEndedAt <= 0 ||
        current.sessionEndedAt > time ||
        !current.sessionId
      ) {
        return 'invalid_session'
      }

      let state = load() || {}
      if (state.sessionId !== current.sessionId) {
        const delay = chooseDelay()
        if (
          !Number.isInteger(delay) ||
          delay < MIN_DELAY_MS ||
          delay > MAX_DELAY_MS
        ) {
          throw new Error('Invalid post-session generation delay')
        }
        state = {
          version: 1,
          sessionId: current.sessionId,
          epoch: current.epoch,
          dueAt: current.sessionEndedAt + delay,
          expiresAt: current.sessionEndedAt + MAX_DELAY_MS,
          status: 'scheduled',
          completedPairs: [],
          pairAttempts: {},
          rejectedPairs: [],
          activePair: null,
        }
        save(state)
      }
      if (state.status === 'running') {
        state.status = 'interrupted'
        save(state)
        onFailure('interrupted')
        return state.status
      }
      if (state.status === 'waiting_budget' && time >= state.dueAt) {
        state.status = 'scheduled'
      }
      if (state.status === 'waiting_provider' && time >= state.dueAt) {
        state.status = 'scheduled'
      }
      if (state.status !== 'scheduled') return state.status
      if (!state.startedAt && time > state.expiresAt) {
        state.status = 'missed_window'
        save(state)
        return state.status
      }
      if (time < state.dueAt) return 'waiting'

      // Generate one missing pair per tick. Fetch fresh requirements before the
      // next one so a manual draft or publication reduces the remaining work.
      state.pairAttempts = state.pairAttempts || {}
      state.rejectedPairs = state.rejectedPairs || []
      const pair = current.missingPairs
        .filter(
          (item) =>
            !state.completedPairs.includes(item.id) &&
            !state.rejectedPairs.includes(item.id)
        )
        .sort(
          (left, right) =>
            (state.pairAttempts[left.id] || 0) -
            (state.pairAttempts[right.id] || 0)
        )[0]
      if (!pair) {
        state.status =
          current.missingCount > 0 ? 'quality_blocked' : 'completed'
        save(state)
        return state.status
      }
      state.status = 'running'
      state.startedAt = state.startedAt || time
      state.activePair = pair.id
      save(state)
      try {
        await generate(pair, current)
        state.completedPairs.push(pair.id)
        state.activePair = null
        state.status = 'scheduled'
      } catch (error) {
        if (QUALITY_FAILURES.includes(error.code)) {
          state.pairAttempts[pair.id] = (state.pairAttempts[pair.id] || 0) + 1
          if (state.pairAttempts[pair.id] >= MAX_PAIR_ATTEMPTS) {
            state.rejectedPairs.push(pair.id)
          }
          state.lastFailure = error.code
          state.activePair = null
          state.status = 'scheduled'
          onFailure(error.code)
        } else if (error.code === 'budget_exhausted') {
          state.lastFailure = 'budget_exhausted'
          state.status = 'waiting_budget'
          state.activePair = null
          state.dueAt = time + 60 * 60 * 1000
          onFailure('budget_exhausted')
        } else if (error.code === 'rate_limited') {
          const retryAfterMs = Number(error.retryAfterMs)
          const delay = Number.isFinite(retryAfterMs)
            ? Math.min(
                MAX_PROVIDER_RETRY_MS,
                Math.max(MIN_PROVIDER_RETRY_MS, retryAfterMs)
              )
            : MIN_PROVIDER_RETRY_MS
          state.lastFailure = 'rate_limited'
          state.status = 'waiting_provider'
          state.activePair = null
          state.dueAt = time + delay
          onFailure('rate_limited')
        } else {
          state.status = 'failed'
          state.lastFailure = 'generation_failed'
          onFailure('generation_failed', error)
        }
        // Provider error text can contain credentials, prompts, or account IDs.
        // Only a fixed status is persisted; private observers may classify it.
      }
      save(state)
      return state.status
    } finally {
      busy = false
    }
  }

  return {tick}
}

module.exports = {MIN_DELAY_MS, MAX_DELAY_MS, createFlipGenerationScheduler}
