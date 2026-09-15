const {randomInt} = require('crypto')

const MIN_DELAY_MS = 30 * 60 * 1000
const MAX_DELAY_MS = 4 * 60 * 60 * 1000

// All state belongs to the app profile. A durable claim precedes each paid run;
// an interrupted request requires review instead of silently buying it again.
function createFlipGenerationScheduler({
  snapshot,
  load,
  save,
  generate,
  now = Date.now,
  chooseDelay = () => randomInt(MIN_DELAY_MS, MAX_DELAY_MS + 1),
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
      if (state.status !== 'scheduled') return state.status
      if (!state.startedAt && time > state.expiresAt) {
        state.status = 'missed_window'
        save(state)
        return state.status
      }
      if (time < state.dueAt) return 'waiting'

      // Generate one missing pair per tick. Fetch fresh requirements before the
      // next one so a manual draft or publication reduces the remaining work.
      const pair = current.missingPairs.find(
        (item) => !state.completedPairs.includes(item.id)
      )
      if (!pair) {
        state.status = 'completed'
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
        state.status = 'failed'
        // Provider error text can contain credentials, prompts, or account IDs.
        // Only a fixed status is persisted; private observers may classify it.
        onFailure('generation_failed', error)
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
