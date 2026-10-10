const MIN_DELAY_MS = 0
const MAX_DELAY_MS = 4 * 60 * 60 * 1000
const MAX_PAID_ATTEMPTS_PER_SESSION = 10
const QUALITY_FAILURES = ['story_rejected', 'render_rejected']
const AUDIT_REASON_CODES = new Set([
  'story_requires_four_complete_panels',
  'story_panels_are_not_distinct',
  'storyboard_starter',
  'weak_story_draft',
  'local_fallback_story',
  'story_compliance_failed',
  'story_risk_flags',
  'story_quality_score_missing',
  'story_quality_score_below_75',
  'story_quality_failures',
  'missing_exact_keyword',
  'story_requires_two_keywords',
  'no_compliant_story_candidate',
  'panel_generation_failed',
  'render_requires_four_panels',
  'post_audit_noise_not_allowed',
  'sequence_audit_not_invoked',
  'sequence_audit_incomplete',
  'sequence_audit_rejected',
  'audited_shuffle_missing',
  'render_feedback_rejected',
  'panel_audit_incomplete',
  'rendered_sequence_audit',
  'character_scene_continuity',
  'keyword_causal_role',
])
const MIN_PROVIDER_RETRY_MS = 15 * 60 * 1000
const MAX_PROVIDER_RETRY_MS = 60 * 60 * 1000
const PAID_ATTEMPT_SPACING_MS = 5 * 60 * 1000

function safeAuditReasons(reasons) {
  return [
    ...new Set(
      (Array.isArray(reasons) ? reasons : [])
        .map((reason) => String(reason || '').split(':')[0])
        .filter((reason) => AUDIT_REASON_CODES.has(reason))
    ),
  ].slice(0, 8)
}

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
          spendStartedAt: time,
          paidAttemptsInSpendWindow: 0,
          completedPairs: [],
          pairAttempts: {},
          rejectedPairs: [],
          activePair: null,
        }
        save(state)
      } else if (!Number.isFinite(state.spendStartedAt)) {
        // Preserve known attempts when migrating an existing in-flight session.
        // Resetting this counter can buy more requests than the session limit.
        state.spendStartedAt = current.sessionEndedAt
        const knownAttempts = Object.values(state.pairAttempts || {}).reduce(
          (sum, attempts) =>
            sum + (Number.isInteger(attempts) && attempts > 0 ? attempts : 0),
          (state.completedPairs || []).length
        )
        state.paidAttemptsInSpendWindow = Math.max(
          Number.isInteger(state.paidAttemptsInSpendWindow)
            ? state.paidAttemptsInSpendWindow
            : 0,
          knownAttempts
        )
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
      if (state.paidAttemptsInSpendWindow >= MAX_PAID_ATTEMPTS_PER_SESSION) {
        state.status = 'attempts_exhausted'
        save(state)
        return state.status
      }
      state.status = 'running'
      state.startedAt = state.startedAt || time
      state.activePair = pair.id
      state.paidAttemptsInSpendWindow += 1
      save(state)
      try {
        await generate(pair, current)
        state.completedPairs.push(pair.id)
        state.activePair = null
        state.status = 'scheduled'
        state.dueAt = now() + PAID_ATTEMPT_SPACING_MS
      } catch (error) {
        if (QUALITY_FAILURES.includes(error.code)) {
          state.pairAttempts[pair.id] = (state.pairAttempts[pair.id] || 0) + 1
          state.lastFailure = error.code
          state.lastAuditReasons = safeAuditReasons(error.auditReasons)
          state.activePair = null
          // A failed quality gate needs review before buying another image.
          state.status = 'quality_blocked'
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
