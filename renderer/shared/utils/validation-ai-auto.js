import {AnswerType, EpochPeriod} from '../types'

export const REPORT_SIDE_SWITCH_MIN_PROBABILITY = 0.82
export const REPORT_SIDE_SWITCH_MIN_DELTA = 0.08
export const REPORT_SIDE_SWITCH_STRONG_ORIGINAL_MIN_PROBABILITY = 0.95
export const REPORT_SIDE_SWITCH_STRONG_ORIGINAL_MIN_DELTA = 0.16

function isAnsweredValidationFlip(flip) {
  return Number(flip?.option) > 0
}

function isRenderableAiCandidateFlip(flip) {
  return Boolean(
    flip && flip.decoded && !flip.failed && flip.images && flip.orders
  )
}

function normalizeProbability(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return null
  }
  return Math.max(0, Math.min(1, parsed))
}

function normalizeSideProbabilities(source) {
  let probabilities = source
  if (source && typeof source.probabilities === 'object') {
    probabilities = source.probabilities
  } else if (source && typeof source.sideProbabilities === 'object') {
    probabilities = source.sideProbabilities
  }
  const left = normalizeProbability(probabilities?.left)
  const right = normalizeProbability(probabilities?.right)

  if (left === null || right === null) {
    return null
  }

  return {left, right}
}

function getAnswerSide(option) {
  if (option === AnswerType.Left || option === 'left') {
    return 'left'
  }
  if (option === AnswerType.Right || option === 'right') {
    return 'right'
  }
  return null
}

function getAnswerOption(side) {
  if (side === 'left') {
    return AnswerType.Left
  }
  if (side === 'right') {
    return AnswerType.Right
  }
  return AnswerType.None
}

function getOriginalSideProbabilities(originalDecision = {}) {
  return (
    normalizeSideProbabilities(originalDecision?.probabilities) ||
    normalizeSideProbabilities(originalDecision?.probabilityEnsemble) ||
    normalizeSideProbabilities(originalDecision?.ensembleProbabilities)
  )
}

function getProbabilityRunCount(originalDecision = {}) {
  const runCount = Number(originalDecision?.probabilityEnsemble?.runCount)
  if (Number.isFinite(runCount) && runCount > 0) {
    return runCount
  }

  const runs = originalDecision?.probabilityEnsemble?.runs
  return Array.isArray(runs) && runs.length > 0 ? runs.length : 1
}

function isFallbackDecision(originalDecision = {}) {
  return Boolean(
    !originalDecision ||
      originalDecision.forcedDecision ||
      originalDecision.forcedDecisionPolicy === 'random' ||
      originalDecision.forcedDecisionReason ||
      originalDecision.rawAnswerBeforeRemap === 'skip'
  )
}

export function shouldApplyAutoReportSideCorrection({
  currentOption = AnswerType.None,
  originalDecision = null,
  reviewResult = null,
} = {}) {
  const currentSide = getAnswerSide(currentOption)
  const reviewSide = getAnswerSide(reviewResult?.answer)

  if (!currentSide || !reviewSide || reviewSide === currentSide) {
    return {
      apply: false,
      option: currentOption,
      reason: 'no-op',
    }
  }

  const reportProbabilities = normalizeSideProbabilities(reviewResult)
  if (!reportProbabilities) {
    return {
      apply: false,
      option: currentOption,
      reason: 'missing probabilities',
    }
  }

  const currentReportProbability = reportProbabilities[currentSide]
  const reviewReportProbability = reportProbabilities[reviewSide]
  const reportDelta = reviewReportProbability - currentReportProbability
  const originalProbabilities = getOriginalSideProbabilities(originalDecision)
  const originalSideProbability = originalProbabilities?.[currentSide]
  const originalIsStrong =
    Number.isFinite(originalSideProbability) &&
    originalSideProbability >=
      REPORT_SIDE_SWITCH_STRONG_ORIGINAL_MIN_PROBABILITY
  const minProbability = originalIsStrong
    ? REPORT_SIDE_SWITCH_STRONG_ORIGINAL_MIN_PROBABILITY
    : REPORT_SIDE_SWITCH_MIN_PROBABILITY
  const minDelta = originalIsStrong
    ? REPORT_SIDE_SWITCH_STRONG_ORIGINAL_MIN_DELTA
    : REPORT_SIDE_SWITCH_MIN_DELTA

  if (reviewReportProbability < minProbability) {
    return {
      apply: false,
      option: currentOption,
      reason: 'below probability threshold',
      reportProbabilities,
    }
  }

  if (reportDelta < minDelta) {
    return {
      apply: false,
      option: currentOption,
      reason: originalIsStrong
        ? 'below strong original delta'
        : 'below delta threshold',
      reportProbabilities,
    }
  }

  if (!originalProbabilities || isFallbackDecision(originalDecision)) {
    return {
      apply: true,
      option: getAnswerOption(reviewSide),
      reason: originalProbabilities
        ? 'fallback corrected by report probabilities'
        : 'no original probabilities',
      reportProbabilities,
    }
  }

  const runCount = getProbabilityRunCount(originalDecision)
  const mergedCurrent =
    (originalProbabilities[currentSide] * runCount + currentReportProbability) /
    (runCount + 1)
  const mergedReview =
    (originalProbabilities[reviewSide] * runCount + reviewReportProbability) /
    (runCount + 1)
  const mergedDelta = mergedReview - mergedCurrent

  if (mergedDelta < REPORT_SIDE_SWITCH_MIN_DELTA) {
    return {
      apply: false,
      option: currentOption,
      reason: 'merged probability check failed',
      reportProbabilities,
      mergedProbabilities: {
        [currentSide]: mergedCurrent,
        [reviewSide]: mergedReview,
      },
    }
  }

  return {
    apply: true,
    option: getAnswerOption(reviewSide),
    reason: 'merged probability check passed',
    reportProbabilities,
    mergedProbabilities: {
      [currentSide]: mergedCurrent,
      [reviewSide]: mergedReview,
    },
  }
}

export function getValidationAiSessionType({
  state = null,
  submitting = false,
  hasRenderableShortFlips = false,
  hasRenderableLongFlips = false,
} = {}) {
  if (!state || typeof state.matches !== 'function' || submitting) {
    return null
  }

  if (
    state.matches('shortSession.solve.answer.normal') &&
    (state.matches('shortSession.fetch.done') || hasRenderableShortFlips)
  ) {
    return 'short'
  }

  if (
    state.matches('longSession.solve.answer.flips') &&
    (state.matches('longSession.fetch.flips.done') || hasRenderableLongFlips)
  ) {
    return 'long'
  }

  return null
}

export function shouldBlockSessionAutoInDev({
  isDev = false,
  forceAiPreview = false,
  isRehearsalNodeSession = false,
  allowDevSessionAuto = false,
} = {}) {
  return Boolean(
    isDev && !allowDevSessionAuto && !forceAiPreview && !isRehearsalNodeSession
  )
}

export function hasOnchainAutoSubmitConsent(aiSolver = {}) {
  return Boolean(String(aiSolver?.onchainAutoSubmitConsentAt || '').trim())
}

export function shouldAllowSessionAutoMode({
  aiSolver = {},
  forceAiPreview = false,
  isRehearsalNodeSession = false,
} = {}) {
  return Boolean(
    forceAiPreview ||
      isRehearsalNodeSession ||
      hasOnchainAutoSubmitConsent(aiSolver)
  )
}

export function shouldAutoRunSessionForPeriod({
  aiSessionType = null,
  currentPeriod = EpochPeriod.None,
  forceAiPreview = false,
} = {}) {
  if (forceAiPreview) {
    return true
  }

  if (aiSessionType === 'short') {
    return currentPeriod === EpochPeriod.ShortSession
  }

  if (aiSessionType === 'long') {
    return currentPeriod === EpochPeriod.LongSession
  }

  return false
}

export function shouldShowValidationAiUi({
  enabled = false,
  providerReady = false,
} = {}) {
  return Boolean(enabled && providerReady)
}

export function shouldShowValidationLocalAiUi({
  runtimeReady = false,
  checkerAvailable = false,
} = {}) {
  return Boolean(runtimeReady && checkerAvailable)
}

export function getValidationLongAiSolveStatus({
  longFlips = [],
  solvedHashes = [],
} = {}) {
  const solvedHashSet = new Set(
    Array.isArray(solvedHashes) ? solvedHashes.filter(Boolean) : []
  )
  const allFlips = Array.isArray(longFlips) ? longFlips : []
  const renderableDecodedFlips = allFlips.filter(isRenderableAiCandidateFlip)
  const decodedUnansweredFlips = renderableDecodedFlips.filter(
    (flip) => !isAnsweredValidationFlip(flip) && !solvedHashSet.has(flip.hash)
  )
  const loadingFlips = allFlips.filter(
    (flip) => flip && !flip.failed && (!flip.ready || !flip.decoded)
  )

  return {
    renderableDecodedFlips,
    decodedUnansweredFlips,
    loadingFlips,
    decodedUnansweredHashes: decodedUnansweredFlips
      .map(({hash}) => hash)
      .filter(Boolean),
    renderableDecodedFlipCount: renderableDecodedFlips.length,
    decodedUnansweredFlipCount: decodedUnansweredFlips.length,
    loadingFlipCount: loadingFlips.length,
    hasDecodedUnansweredFlips: decodedUnansweredFlips.length > 0,
    hasLoadingFlips: loadingFlips.length > 0,
  }
}

export function getValidationShortAiSolveStatus({
  shortFlips = [],
  solvedHashes = [],
} = {}) {
  const solvedHashSet = new Set(
    Array.isArray(solvedHashes) ? solvedHashes.filter(Boolean) : []
  )
  const regularFlips = (Array.isArray(shortFlips) ? shortFlips : []).filter(
    (flip) => flip && !flip.extra
  )
  const renderableDecodedFlips = regularFlips.filter(
    isRenderableAiCandidateFlip
  )
  const decodedUnansweredFlips = renderableDecodedFlips.filter(
    (flip) => !isAnsweredValidationFlip(flip) && !solvedHashSet.has(flip.hash)
  )
  const loadingFlips = regularFlips.filter(
    (flip) =>
      flip &&
      !flip.failed &&
      (!flip.ready ||
        !flip.decoded ||
        !Array.isArray(flip.images) ||
        !Array.isArray(flip.orders))
  )

  return {
    renderableDecodedFlips,
    decodedUnansweredFlips,
    loadingFlips,
    decodedUnansweredHashes: decodedUnansweredFlips
      .map(({hash}) => hash)
      .filter(Boolean),
    renderableDecodedFlipCount: renderableDecodedFlips.length,
    decodedUnansweredFlipCount: decodedUnansweredFlips.length,
    loadingFlipCount: loadingFlips.length,
    hasDecodedUnansweredFlips: decodedUnansweredFlips.length > 0,
    hasLoadingFlips: loadingFlips.length > 0,
  }
}

export function shouldFinishLongSessionAiSolve({
  longFlips = [],
  solvedHashes = [],
  longSessionElapsedMs = 0,
  loadingGraceMs = 15 * 60 * 1000,
} = {}) {
  const status = getValidationLongAiSolveStatus({
    longFlips,
    solvedHashes,
  })

  return (
    status.decodedUnansweredFlipCount === 0 &&
    (!status.hasLoadingFlips || longSessionElapsedMs >= loadingGraceMs)
  )
}

function hasLoadedValidationKeywordWords(words = []) {
  return Array.isArray(words) && words.length > 0
}

export function getValidationReportKeywordStatus({
  state = null,
  longFlips = [],
} = {}) {
  const decodedFlips = Array.isArray(longFlips)
    ? longFlips.filter((flip) => flip && flip.decoded)
    : []
  const keywordReadyFlips = decodedFlips.filter((flip) =>
    hasLoadedValidationKeywordWords(flip.words)
  )
  const missingKeywordFlips = decodedFlips.filter(
    (flip) => !hasLoadedValidationKeywordWords(flip.words)
  )
  const keywordsFetching = Boolean(
    state &&
      typeof state.matches === 'function' &&
      (state.matches('longSession.fetch.keywords.fetching') ||
        state.matches('longSession.fetch.keywords.success'))
  )

  return {
    decodedFlips,
    keywordReadyFlips,
    missingKeywordFlips,
    decodedFlipCount: decodedFlips.length,
    keywordReadyFlipCount: keywordReadyFlips.length,
    missingKeywordFlipCount: missingKeywordFlips.length,
    keywordsFetching,
    keywordsPending:
      keywordsFetching &&
      missingKeywordFlips.length > 0 &&
      !keywordReadyFlips.length,
    hasAnyKeywordReadyFlips: keywordReadyFlips.length > 0,
  }
}

export function shouldWaitForValidationReportKeywords({
  keywordStatus = null,
  waitedMs = 0,
  maxWaitMs = 0,
} = {}) {
  const status =
    keywordStatus && typeof keywordStatus === 'object' ? keywordStatus : {}

  return Boolean(
    status.keywordsFetching &&
      Number(status.missingKeywordFlipCount) > 0 &&
      Number(waitedMs) < Math.max(0, Number(maxWaitMs) || 0)
  )
}

function normalizeReportReviewConfidence(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return 0
  }
  return Math.max(0, Math.min(1, parsed))
}

export function selectAutoReportBestFlipHash({
  reviewResults = [],
  reportHashes = [],
} = {}) {
  const reportedHashSet = new Set(
    (Array.isArray(reportHashes) ? reportHashes : [])
      .map((hash) => String(hash || '').trim())
      .filter(Boolean)
  )

  return (
    (Array.isArray(reviewResults) ? reviewResults : []).reduce(
      (best, item, index) => {
        const hash = String(item?.hash || '').trim()
        const decision = String(item?.decision || '')
          .trim()
          .toLowerCase()
        const confidence = normalizeReportReviewConfidence(item?.confidence)

        if (
          !hash ||
          reportedHashSet.has(hash) ||
          decision !== 'approve' ||
          confidence <= 0
        ) {
          return best
        }

        const triggeredRulePenalty = Array.isArray(item?.triggeredRules)
          ? Math.min(0.2, item.triggeredRules.length * 0.05)
          : 0
        const errorPenalty = item?.error ? 0.2 : 0
        const score = Math.max(
          0,
          confidence - triggeredRulePenalty - errorPenalty
        )
        if (score <= 0) {
          return best
        }

        if (
          !best ||
          score > best.score ||
          (score === best.score && index < best.index)
        ) {
          return {
            hash,
            score,
            index,
          }
        }

        return best
      },
      null
    )?.hash || ''
  )
}
