import {AnswerType} from '../../../shared/types'
import {filterRegularFlips, rearrangeFlips} from '../utils'

const DEFAULT_PROFILE = {
  benchmarkProfile: 'strict',
  deadlineMs: 60 * 1000,
  requestTimeoutMs: 9 * 1000,
  maxConcurrency: 1,
  maxRetries: 1,
  maxOutputTokens: 0,
  interFlipDelayMs: 650,
  temperature: 0,
  forceDecision: true,
  uncertaintyRepromptEnabled: true,
  uncertaintyConfidenceThreshold: 0.95,
  uncertaintyRepromptMinRemainingMs: 3500,
  uncertaintyRepromptInstruction: '',
  promptTemplateOverride: '',
  flipVisionMode: 'composite',
  probabilityEnsembleEnabled: true,
  probabilityRuns: 3,
  probabilityPasses: [
    'visual_observation',
    'independent_scores',
    'adversarial_recheck',
  ],
  probabilityDecisionDelta: 0.08,
  probabilityUseSwappedOrder: true,
  probabilityReasoningEffort: 'xhigh',
}

const LOCAL_AI_STRICT_PROFILE_OVERRIDES = {
  deadlineMs: 80 * 1000,
  requestTimeoutMs: 15 * 1000,
  interFlipDelayMs: 0,
  flipVisionMode: 'frames_single_pass',
}
const LONG_SESSION_STRICT_PROFILE_OVERRIDES = {
  deadlineMs: 90 * 1000,
  requestTimeoutMs: 180 * 1000,
  interFlipDelayMs: 300,
  flipVisionMode: 'composite',
}
const VALIDATION_UNCERTAINTY_FIRST_RECHECK_THRESHOLD = 0.95
const MIN_SOLVE_GUARD_MS = 1500
const SHORT_SESSION_SAFE_SUBMIT_GUARD_MS = 5 * 1000
const SHORT_SESSION_MIN_SOLVE_GUARD_MS = SHORT_SESSION_SAFE_SUBMIT_GUARD_MS
const MIN_PROVIDER_REQUEST_TIMEOUT_MS = 750
const IMAGE_PREP_BASE_MS = 2000
const IMAGE_PREP_PER_FLIP_MS = {
  default: 600,
  'local-ai': 1000,
}
const FRAME_REVIEW_PREP_MIN_MS = 900
const MIN_PER_FLIP_SOLVE_BUDGET_MS = 2500
const SHORT_SESSION_OPENAI_FAST_MODELS = [
  'gpt-5.5-mini',
  'gpt-5.5',
  'gpt-5.4-mini',
  'gpt-5.4',
]
const SHORT_SESSION_OPENAI_PARALLEL_CONCURRENCY = 6
const SHORT_SESSION_OPENAI_MAX_PARALLEL_CONCURRENCY = 6
const SHORT_SESSION_OPENAI_PARALLEL_LAUNCH_DELAY_MS = 500
const SHORT_SESSION_OPENAI_PARALLEL_REQUEST_TIMEOUT_MS = 45 * 1000
const SHORT_SESSION_OPENAI_PARALLEL_DEADLINE_MS = 95 * 1000
const SHORT_SESSION_OPENAI_PARALLEL_DEADLINE_PADDING_MS = 5 * 1000
const SHORT_SESSION_OPENAI_PARALLEL_UNCERTAINTY_THRESHOLD = 0.95
const SHORT_SESSION_OPENAI_PARALLEL_REPROMPT_MIN_REMAINING_MS = 35 * 1000
const SHORT_SESSION_OPENAI_PARALLEL_PROBABILITY_RUNS = 2
const SHORT_SESSION_OPENAI_PARALLEL_PROBABILITY_REASONING_EFFORT = 'high'
const LONG_SESSION_OPENAI_STAGGER_REQUEST_TIMEOUT_MS = 180 * 1000
const LONG_SESSION_OPENAI_STAGGER_INTERVAL_MS = 45 * 1000
const LONG_SESSION_OPENAI_STAGGER_MAX_IN_FLIGHT = 4
const LONG_SESSION_OPENAI_STAGGER_DEADLINE_PADDING_MS = 5 * 1000
const OPENAI_FRAME_PROVIDER_ERROR_FALLBACK_REASON = 'provider_error_frame_mode'
const IMAGE_PAYLOAD_PREP_RETRY_WAIT_MS = 2500
const IMAGE_PAYLOAD_PREP_MAX_ATTEMPTS = 3
const RETRY_BACKOFF_BASE_MS = 700
const EXPECTED_PASS_RUNTIME_MS = {
  default: 4500,
  openai: 3500,
  'local-ai': 7000,
}
const EXPECTED_OPENAI_SHORT_FAST_PASS_MS = 2500

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function toNumberOrFallback(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toFloatOrFallback(value, fallback) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function normalizeWeight(value, fallback = 1) {
  const parsed = toFloatOrFallback(value, fallback)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }
  return Math.min(10, Math.max(0.05, parsed))
}

function normalizeConfidence(value) {
  const parsed = toFloatOrFallback(value, 0)
  if (!Number.isFinite(parsed)) {
    return 0
  }
  return Math.max(0, Math.min(1, parsed))
}

function normalizeVisionMode(value, fallback = 'composite') {
  const mode = String(value || '')
    .trim()
    .toLowerCase()
  if (['composite', 'frames_single_pass', 'frames_two_pass'].includes(mode)) {
    return mode
  }
  return fallback
}

function resolveSessionProfileInput(aiSolver = {}, sessionType = 'short') {
  if (sessionType !== 'short') {
    return aiSolver
  }

  return {
    ...aiSolver,
    flipVisionMode: normalizeVisionMode(
      aiSolver.shortSessionFlipVisionMode,
      DEFAULT_PROFILE.flipVisionMode
    ),
  }
}

function getBaseSolvePassCount({flipVisionMode = 'composite'} = {}) {
  const normalizedVisionMode = normalizeVisionMode(flipVisionMode)
  return normalizedVisionMode === 'frames_two_pass' ? 2 : 1
}

function normalizeProbabilityRuns(
  value,
  fallback = DEFAULT_PROFILE.probabilityRuns
) {
  const parsed = toNumberOrFallback(value, fallback)
  return Math.max(1, Math.min(5, parsed))
}

function normalizeProbabilityPasses(
  value,
  fallback = DEFAULT_PROFILE.probabilityPasses
) {
  const allowed = DEFAULT_PROFILE.probabilityPasses
  const source = Array.isArray(value) ? value : fallback
  const normalized = Array.from(
    new Set(
      source
        .map((item) =>
          String(item || '')
            .trim()
            .toLowerCase()
        )
        .filter((item) => allowed.includes(item))
    )
  )

  return normalized.length ? normalized : fallback
}

function normalizeProbabilityReasoningEffort(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
  if (['minimal', 'low', 'medium', 'high', 'xhigh'].includes(normalized)) {
    return normalized
  }
  return DEFAULT_PROFILE.probabilityReasoningEffort
}

function normalizeProbabilityProfile(input = {}) {
  return {
    // Missing flags come from older settings and rehearsal payloads. Treat
    // absence as the current default, not as an opt-out.
    probabilityEnsembleEnabled:
      input.probabilityEnsembleEnabled == null
        ? DEFAULT_PROFILE.probabilityEnsembleEnabled
        : Boolean(input.probabilityEnsembleEnabled),
    probabilityRuns: normalizeProbabilityRuns(input.probabilityRuns),
    probabilityPasses: normalizeProbabilityPasses(input.probabilityPasses),
    probabilityDecisionDelta: Math.max(
      0,
      Math.min(
        0.5,
        toFloatOrFallback(
          input.probabilityDecisionDelta,
          DEFAULT_PROFILE.probabilityDecisionDelta
        )
      )
    ),
    probabilityUseSwappedOrder:
      input.probabilityUseSwappedOrder == null
        ? DEFAULT_PROFILE.probabilityUseSwappedOrder
        : Boolean(input.probabilityUseSwappedOrder),
    probabilityReasoningEffort: normalizeProbabilityReasoningEffort(
      input.probabilityReasoningEffort
    ),
  }
}

function getRetryBackoffBudgetMs(maxRetries = 0) {
  const retries = Math.max(0, toNumberOrFallback(maxRetries, 0))
  let totalMs = 0

  for (let retryIndex = 0; retryIndex < retries; retryIndex += 1) {
    totalMs += Math.max(500, RETRY_BACKOFF_BASE_MS * (retryIndex + 1))
  }

  return totalMs
}

function estimateExpectedPassRuntimeMs({
  sessionType = 'short',
  provider = 'openai',
  requestTimeoutMs = DEFAULT_PROFILE.requestTimeoutMs,
  promptOptions = null,
} = {}) {
  const normalizedProvider = String(provider || '')
    .trim()
    .toLowerCase()
  const expectedBaselineMs =
    normalizedProvider === 'openai' &&
    sessionType === 'short' &&
    promptOptions &&
    promptOptions.openAiServiceTier === 'priority' &&
    promptOptions.openAiReasoningEffort === 'none'
      ? EXPECTED_OPENAI_SHORT_FAST_PASS_MS
      : EXPECTED_PASS_RUNTIME_MS[normalizedProvider] ||
        EXPECTED_PASS_RUNTIME_MS.default
  const timeoutMs = toNumberOrFallback(
    requestTimeoutMs,
    DEFAULT_PROFILE.requestTimeoutMs
  )

  return Math.max(
    MIN_PER_FLIP_SOLVE_BUDGET_MS,
    Math.min(timeoutMs, expectedBaselineMs)
  )
}

function estimateRetryReserveMs({
  flipCount = 0,
  maxRetries = 0,
  expectedPassRuntimeMs = MIN_PER_FLIP_SOLVE_BUDGET_MS,
} = {}) {
  const retries = Math.max(0, toNumberOrFallback(maxRetries, 0))
  if (retries < 1 || flipCount < 1) {
    return 0
  }

  return (
    Math.min(flipCount, retries) * Math.max(1000, expectedPassRuntimeMs * 0.5) +
    getRetryBackoffBudgetMs(retries)
  )
}

function estimateUncertaintyReviewFlipCount({
  sessionType = 'short',
  flipCount = 0,
  uncertaintyRepromptEnabled = false,
} = {}) {
  if (!uncertaintyRepromptEnabled || flipCount < 1) {
    return 0
  }

  if (sessionType === 'short') {
    return Math.min(flipCount, Math.max(1, Math.ceil(flipCount / 4)))
  }

  return Math.min(flipCount, Math.max(1, Math.ceil(flipCount / 3)))
}

function estimatePerFlipSolveRuntimeMs({
  sessionType = 'short',
  provider = 'openai',
  profile = {},
  promptOptions = null,
} = {}) {
  const probabilityEnsembleActive =
    profile.probabilityEnsembleEnabled && provider !== 'local-ai'
  const solvePassCount = probabilityEnsembleActive
    ? normalizeProbabilityRuns(profile.probabilityRuns)
    : getBaseSolvePassCount({
        flipVisionMode: profile.flipVisionMode,
      })
  const expectedPassRuntimeMs = estimateExpectedPassRuntimeMs({
    sessionType,
    provider,
    requestTimeoutMs: profile.requestTimeoutMs,
    promptOptions: probabilityEnsembleActive ? null : promptOptions,
  })

  return Math.max(
    MIN_PER_FLIP_SOLVE_BUDGET_MS,
    expectedPassRuntimeMs * solvePassCount +
      Math.max(0, toNumberOrFallback(profile.interFlipDelayMs, 0))
  )
}

function normalizeProfile(input = {}) {
  if (input.benchmarkProfile !== 'custom') {
    return {
      ...DEFAULT_PROFILE,
      ...normalizeProbabilityProfile(input),
    }
  }

  return {
    benchmarkProfile: 'custom',
    deadlineMs: toNumberOrFallback(
      input.deadlineMs,
      DEFAULT_PROFILE.deadlineMs
    ),
    requestTimeoutMs: toNumberOrFallback(
      input.requestTimeoutMs,
      DEFAULT_PROFILE.requestTimeoutMs
    ),
    maxConcurrency: toNumberOrFallback(
      input.maxConcurrency,
      DEFAULT_PROFILE.maxConcurrency
    ),
    maxRetries: toNumberOrFallback(
      input.maxRetries,
      DEFAULT_PROFILE.maxRetries
    ),
    maxOutputTokens: toNumberOrFallback(
      input.maxOutputTokens,
      DEFAULT_PROFILE.maxOutputTokens
    ),
    interFlipDelayMs: toNumberOrFallback(
      input.interFlipDelayMs,
      DEFAULT_PROFILE.interFlipDelayMs
    ),
    temperature: toFloatOrFallback(
      input.temperature,
      DEFAULT_PROFILE.temperature
    ),
    forceDecision:
      input.forceDecision == null
        ? DEFAULT_PROFILE.forceDecision
        : Boolean(input.forceDecision),
    uncertaintyRepromptEnabled:
      input.uncertaintyRepromptEnabled == null
        ? DEFAULT_PROFILE.uncertaintyRepromptEnabled
        : Boolean(input.uncertaintyRepromptEnabled),
    uncertaintyConfidenceThreshold: toFloatOrFallback(
      input.uncertaintyConfidenceThreshold,
      DEFAULT_PROFILE.uncertaintyConfidenceThreshold
    ),
    uncertaintyRepromptMinRemainingMs: toNumberOrFallback(
      input.uncertaintyRepromptMinRemainingMs,
      DEFAULT_PROFILE.uncertaintyRepromptMinRemainingMs
    ),
    uncertaintyRepromptInstruction:
      typeof input.uncertaintyRepromptInstruction === 'string'
        ? input.uncertaintyRepromptInstruction
        : '',
    promptTemplateOverride:
      typeof input.promptTemplateOverride === 'string'
        ? input.promptTemplateOverride
        : '',
    flipVisionMode: normalizeVisionMode(
      input.flipVisionMode,
      DEFAULT_PROFILE.flipVisionMode
    ),
    ...normalizeProbabilityProfile(input),
  }
}

function buildEffectiveProfile(profile, provider, sessionType = 'short') {
  let nextProfile = profile

  if (profile.benchmarkProfile !== 'custom' && sessionType === 'long') {
    nextProfile = {
      ...nextProfile,
      deadlineMs: LONG_SESSION_STRICT_PROFILE_OVERRIDES.deadlineMs,
      requestTimeoutMs: LONG_SESSION_STRICT_PROFILE_OVERRIDES.requestTimeoutMs,
      interFlipDelayMs: LONG_SESSION_STRICT_PROFILE_OVERRIDES.interFlipDelayMs,
      flipVisionMode:
        nextProfile.flipVisionMode === 'composite'
          ? LONG_SESSION_STRICT_PROFILE_OVERRIDES.flipVisionMode
          : nextProfile.flipVisionMode,
    }
  }

  if (
    String(provider || '')
      .trim()
      .toLowerCase() !== 'local-ai' ||
    nextProfile.benchmarkProfile === 'custom'
  ) {
    return {
      ...nextProfile,
      uncertaintyConfidenceThreshold: Math.max(
        toFloatOrFallback(
          nextProfile.uncertaintyConfidenceThreshold,
          DEFAULT_PROFILE.uncertaintyConfidenceThreshold
        ),
        VALIDATION_UNCERTAINTY_FIRST_RECHECK_THRESHOLD
      ),
    }
  }

  return {
    ...nextProfile,
    deadlineMs: LOCAL_AI_STRICT_PROFILE_OVERRIDES.deadlineMs,
    requestTimeoutMs: LOCAL_AI_STRICT_PROFILE_OVERRIDES.requestTimeoutMs,
    interFlipDelayMs: LOCAL_AI_STRICT_PROFILE_OVERRIDES.interFlipDelayMs,
    flipVisionMode:
      nextProfile.flipVisionMode === 'composite'
        ? LOCAL_AI_STRICT_PROFILE_OVERRIDES.flipVisionMode
        : nextProfile.flipVisionMode,
    uncertaintyConfidenceThreshold: Math.max(
      toFloatOrFallback(
        nextProfile.uncertaintyConfidenceThreshold,
        DEFAULT_PROFILE.uncertaintyConfidenceThreshold
      ),
      VALIDATION_UNCERTAINTY_FIRST_RECHECK_THRESHOLD
    ),
  }
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => {
      reject(
        new Error(
          `Unable to load validation flip image${source ? ` (${source})` : ''}`
        )
      )
    }
    image.src = source
  })
}

function drawContain(context, image, target) {
  const sourceWidth = image.naturalWidth || image.width || target.width
  const sourceHeight = image.naturalHeight || image.height || target.height
  const ratio = Math.min(
    target.width / sourceWidth,
    target.height / sourceHeight
  )
  const drawWidth = sourceWidth * ratio
  const drawHeight = sourceHeight * ratio
  const offsetX = target.x + (target.width - drawWidth) / 2
  const offsetY = target.y + (target.height - drawHeight) / 2

  context.fillStyle = '#000000'
  context.fillRect(target.x, target.y, target.width, target.height)
  context.drawImage(image, offsetX, offsetY, drawWidth, drawHeight)
}

async function composeFlipVariant({
  flip,
  variant,
  frameWidth = 512,
  frameHeight = 384,
}) {
  const imageOrder = Array.isArray(flip.orders?.[variant - 1])
    ? flip.orders[variant - 1]
    : []

  const orderedSources = (
    imageOrder.length
      ? imageOrder.map((index) => flip.images?.[index])
      : flip.images || []
  ).filter(Boolean)

  if (!orderedSources.length) {
    throw new Error(`Flip ${flip.hash} has no decoded images`)
  }

  const loadedImages = await Promise.all(
    orderedSources.map((source) => loadImage(source))
  )

  const canvas = document.createElement('canvas')
  canvas.width = frameWidth
  canvas.height = frameHeight * loadedImages.length

  const context = canvas.getContext('2d')
  context.fillStyle = '#000000'
  context.fillRect(0, 0, canvas.width, canvas.height)

  loadedImages.forEach((image, index) => {
    drawContain(context, image, {
      x: 0,
      y: frameHeight * index,
      width: frameWidth,
      height: frameHeight,
    })
  })

  return canvas.toDataURL('image/png')
}

async function composeFlipFrames({
  flip,
  variant,
  frameWidth = 512,
  frameHeight = 384,
}) {
  const imageOrder = Array.isArray(flip.orders?.[variant - 1])
    ? flip.orders[variant - 1]
    : []

  const orderedSources = (
    imageOrder.length
      ? imageOrder.map((index) => flip.images?.[index])
      : flip.images || []
  ).filter(Boolean)

  if (!orderedSources.length) {
    throw new Error(`Flip ${flip.hash} has no decoded images`)
  }

  const loadedImages = await Promise.all(
    orderedSources.map((source) => loadImage(source))
  )

  return loadedImages.map((image) => {
    const canvas = document.createElement('canvas')
    canvas.width = frameWidth
    canvas.height = frameHeight

    const context = canvas.getContext('2d')
    context.fillStyle = '#000000'
    context.fillRect(0, 0, canvas.width, canvas.height)

    drawContain(context, image, {
      x: 0,
      y: 0,
      width: frameWidth,
      height: frameHeight,
    })

    return canvas.toDataURL('image/png')
  })
}

function toAnswerOption(answer) {
  const value = String(answer || '')
    .trim()
    .toLowerCase()
  if (value === 'left') return AnswerType.Left
  if (value === 'right') return AnswerType.Right
  return AnswerType.None
}

function normalizeAnswerPhaseKeywords(wordsOrKeywords = []) {
  if (!Array.isArray(wordsOrKeywords)) {
    return []
  }

  return wordsOrKeywords
    .map((item, index) => {
      if (item && typeof item === 'object') {
        const name = String(item.name || item.keyword || '').trim()
        const desc = String(item.desc || item.description || '').trim()
        if (!name && !desc) {
          return null
        }
        return {
          name: name || `keyword-${index + 1}`,
          desc,
        }
      }

      const keywordName = String(item || '').trim()
      return keywordName ? {name: keywordName, desc: ''} : null
    })
    .filter(Boolean)
    .slice(0, 2)
}

function chooseDeterministicRandomAnswer(seed = '', fallbackIndex = null) {
  const normalizedIndex = Number(fallbackIndex)
  if (Number.isFinite(normalizedIndex) && normalizedIndex >= 0) {
    return Math.trunc(normalizedIndex) % 2 === 0 ? 'left' : 'right'
  }

  const value = String(seed || '')
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 2147483647
  }

  return hash % 2 === 0 ? 'left' : 'right'
}

function normalizeTokenUsage(usage = {}) {
  const promptTokens = Number(usage.promptTokens)
  const completionTokens = Number(usage.completionTokens)
  const totalTokens = Number(usage.totalTokens)

  const normalizedPrompt =
    Number.isFinite(promptTokens) && promptTokens >= 0 ? promptTokens : 0
  const normalizedCompletion =
    Number.isFinite(completionTokens) && completionTokens >= 0
      ? completionTokens
      : 0

  return {
    promptTokens: normalizedPrompt,
    completionTokens: normalizedCompletion,
    totalTokens:
      Number.isFinite(totalTokens) && totalTokens >= 0
        ? totalTokens
        : normalizedPrompt + normalizedCompletion,
  }
}

function normalizeCostSummary(costs = {}) {
  const estimatedUsd = Number(costs.estimatedUsd)
  const actualUsd = Number(costs.actualUsd)

  return {
    estimatedUsd:
      Number.isFinite(estimatedUsd) && estimatedUsd >= 0 ? estimatedUsd : null,
    actualUsd: Number.isFinite(actualUsd) && actualUsd >= 0 ? actualUsd : null,
  }
}

function normalizeProviderDailyBudgetRemainingUsd(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function getCostSummaryUsd(costs = {}) {
  const normalizedCosts = normalizeCostSummary(costs)
  if (Number.isFinite(normalizedCosts.actualUsd)) {
    return normalizedCosts.actualUsd
  }
  return Number.isFinite(normalizedCosts.estimatedUsd)
    ? normalizedCosts.estimatedUsd
    : 0
}

function getResultsCostUsd(results = []) {
  return (Array.isArray(results) ? results : []).reduce(
    (total, item) => total + getCostSummaryUsd(item && item.costs),
    0
  )
}

function formatSolveError(error) {
  return String((error && error.message) || error || 'unknown_error').trim()
}

function summarizeFastMode(results = []) {
  const entries = results
    .map((item) => (item && item.fastMode ? item.fastMode : null))
    .filter((item) => item && item.requested)

  if (!entries.length) {
    return null
  }

  return {
    requested: true,
    requestedServiceTier:
      entries.find((item) => item.requestedServiceTier)?.requestedServiceTier ||
      null,
    requestedReasoningEffort:
      entries.find((item) => item.requestedReasoningEffort)
        ?.requestedReasoningEffort || null,
    appliedServiceTiers: Array.from(
      new Set(entries.map((item) => item.appliedServiceTier).filter(Boolean))
    ),
    compatibilityFallbackUsed: entries.some(
      (item) => item.compatibilityFallbackUsed
    ),
    missingRequestedParameters: Array.from(
      new Set(
        entries.flatMap((item) =>
          Array.isArray(item.missingRequestedParameters)
            ? item.missingRequestedParameters
            : []
        )
      )
    ),
    priorityDowngraded: entries.some((item) => item.priorityDowngraded),
    affectedFlips: entries.filter(
      (item) => item.compatibilityFallbackUsed || item.priorityDowngraded
    ).length,
  }
}

function summarizeModelFallbacks(results = []) {
  const entries = results
    .flatMap((item) => {
      if (!item) {
        return []
      }
      if (Array.isArray(item.modelFallbacks)) {
        return item.modelFallbacks
      }
      return item.modelFallback ? [item.modelFallback] : []
    })
    .filter((item) => item && item.requestedModel && item.usedModel)

  if (!entries.length) {
    return null
  }

  const pairs = Array.from(
    new Map(
      entries.map((item) => [
        `${item.requestedModel}->${item.usedModel}`,
        {
          requestedModel: item.requestedModel,
          usedModel: item.usedModel,
          reason: item.reason || 'model_unavailable',
        },
      ])
    ).values()
  )

  return {
    used: true,
    affectedFlips: entries.length,
    pairs,
  }
}

function ensureBridge() {
  if (
    !global.aiSolver ||
    typeof global.aiSolver.solveFlipBatch !== 'function'
  ) {
    throw new Error('AI solver bridge is not available in this build')
  }
  return global.aiSolver
}

function buildProviderConfig(aiSolver = {}) {
  const provider = String(aiSolver.provider || '')
    .trim()
    .toLowerCase()
  if (provider !== 'openai-compatible') {
    return null
  }

  return {
    name: aiSolver.customProviderName,
    baseUrl: aiSolver.customProviderBaseUrl,
    chatPath: aiSolver.customProviderChatPath,
  }
}

function normalizeConsultProvider(value) {
  const provider = String(value || '')
    .trim()
    .toLowerCase()
  if (
    [
      'openai',
      'openai-compatible',
      'gemini',
      'anthropic',
      'xai',
      'mistral',
      'groq',
      'deepseek',
      'openrouter',
    ].includes(provider)
  ) {
    return provider
  }
  return null
}

function buildConsultProviders(aiSolver = {}, providerConfig = null) {
  if (!aiSolver.ensembleEnabled) {
    return []
  }

  const consultSlots = [
    {
      enabled: aiSolver.ensembleProvider2Enabled,
      provider: aiSolver.ensembleProvider2,
      model: aiSolver.ensembleModel2,
      weight: aiSolver.ensembleProvider2Weight,
      source: 'ensemble-slot-2',
    },
    {
      enabled: aiSolver.ensembleProvider3Enabled,
      provider: aiSolver.ensembleProvider3,
      model: aiSolver.ensembleModel3,
      weight: aiSolver.ensembleProvider3Weight,
      source: 'ensemble-slot-3',
    },
  ]

  return consultSlots
    .filter((slot) => slot.enabled)
    .map((slot) => {
      const provider = normalizeConsultProvider(slot.provider)
      const model = String(slot.model || '').trim()
      if (!provider || !model) {
        return null
      }

      return {
        provider,
        model,
        weight: normalizeWeight(slot.weight, 1),
        source: slot.source,
        providerConfig:
          provider === 'openai-compatible' ? {...(providerConfig || {})} : null,
      }
    })
    .filter(Boolean)
    .slice(0, 2)
}

function isSolvableFlip(flip) {
  return Boolean(
    flip &&
      flip.decoded &&
      !flip.failed &&
      !(Number(flip.option) > 0) &&
      flip.images &&
      flip.orders
  )
}

function pickCandidateFlips({
  sessionType,
  shortFlips = [],
  longFlips = [],
  maxFlips,
}) {
  if (sessionType === 'long') {
    const list = rearrangeFlips(
      Array.isArray(longFlips) ? longFlips : []
    ).filter(isSolvableFlip)
    const safeMaxLong = Number.isFinite(maxFlips) ? maxFlips : list.length
    return list.slice(0, Math.max(1, safeMaxLong))
  }

  const shortList = rearrangeFlips(filterRegularFlips(shortFlips)).filter(
    isSolvableFlip
  )
  const safeMax = Number.isFinite(maxFlips) ? maxFlips : shortList.length
  return shortList.slice(0, Math.max(1, safeMax))
}

function summarizeResults(results, startedAt) {
  const tokens = results.reduce(
    (acc, item) => {
      const usage = normalizeTokenUsage(item && item.tokenUsage)
      const hasUsage =
        usage.promptTokens > 0 ||
        usage.completionTokens > 0 ||
        usage.totalTokens > 0
      return {
        promptTokens: acc.promptTokens + usage.promptTokens,
        completionTokens: acc.completionTokens + usage.completionTokens,
        totalTokens: acc.totalTokens + usage.totalTokens,
        flipsWithUsage: acc.flipsWithUsage + (hasUsage ? 1 : 0),
      }
    },
    {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      flipsWithUsage: 0,
    }
  )

  const costs = results.reduce(
    (acc, item) => {
      const nextCosts = normalizeCostSummary(item && item.costs)

      return {
        estimatedUsd:
          acc.estimatedUsd +
          (Number.isFinite(nextCosts.estimatedUsd)
            ? nextCosts.estimatedUsd
            : 0),
        actualUsd:
          acc.actualUsd +
          (Number.isFinite(nextCosts.actualUsd) ? nextCosts.actualUsd : 0),
        pricedResults:
          acc.pricedResults +
          (Number.isFinite(nextCosts.estimatedUsd) ||
          Number.isFinite(nextCosts.actualUsd)
            ? 1
            : 0),
      }
    },
    {
      estimatedUsd: 0,
      actualUsd: 0,
      pricedResults: 0,
    }
  )

  return {
    totalFlips: results.length,
    elapsedMs: Date.now() - startedAt,
    skipped: results.filter(({answer}) => answer === 'skip').length,
    left: results.filter(({answer}) => answer === 'left').length,
    right: results.filter(({answer}) => answer === 'right').length,
    tokens,
    costs: {
      estimatedUsd: costs.pricedResults > 0 ? costs.estimatedUsd : null,
      actualUsd: costs.pricedResults > 0 ? costs.actualUsd : null,
      pricedResults: costs.pricedResults,
    },
    diagnostics: {
      swapped: results.filter(({sideSwapped}) => sideSwapped === true).length,
      notSwapped: results.filter(({sideSwapped}) => sideSwapped !== true)
        .length,
      rawLeft: results.filter(
        ({rawAnswerBeforeRemap}) => rawAnswerBeforeRemap === 'left'
      ).length,
      rawRight: results.filter(
        ({rawAnswerBeforeRemap}) => rawAnswerBeforeRemap === 'right'
      ).length,
      rawSkip: results.filter(
        ({rawAnswerBeforeRemap}) => rawAnswerBeforeRemap === 'skip'
      ).length,
      finalLeft: results.filter(
        ({finalAnswerAfterRemap}) => finalAnswerAfterRemap === 'left'
      ).length,
      finalRight: results.filter(
        ({finalAnswerAfterRemap}) => finalAnswerAfterRemap === 'right'
      ).length,
      finalSkip: results.filter(
        ({finalAnswerAfterRemap}) => finalAnswerAfterRemap === 'skip'
      ).length,
      remappedDecisions: results.filter((item) => {
        if (
          item.rawAnswerBeforeRemap !== 'left' &&
          item.rawAnswerBeforeRemap !== 'right'
        ) {
          return false
        }
        return item.rawAnswerBeforeRemap !== item.finalAnswerAfterRemap
      }).length,
      providerErrors: results.filter((item) => Boolean(item.error)).length,
      uncertaintyReprompts: results.filter(
        (item) => item && item.uncertaintyRepromptUsed
      ).length,
      forcedDecisions: results.filter((item) => item && item.forcedDecision)
        .length,
      randomForcedDecisions: results.filter(
        (item) =>
          item && item.forcedDecision && item.forcedDecisionPolicy === 'random'
      ).length,
      ensembleTieBreaks: results.filter(
        (item) => item && item.ensembleTieBreakApplied
      ).length,
      annotatedFrameReviews: results.filter(
        (item) => item && item.secondPassStrategy === 'annotated_frame_review'
      ).length,
    },
  }
}

function normalizeDeadlineAt(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function getTimeRemainingMs(deadlineAt) {
  if (!Number.isFinite(deadlineAt)) {
    return Infinity
  }

  return deadlineAt - Date.now()
}

function shouldPrepareOpenAiCompositeFallback({
  sessionType = 'short',
  provider = 'openai',
  flipVisionMode = 'composite',
} = {}) {
  return (
    sessionType === 'long' &&
    String(provider || '')
      .trim()
      .toLowerCase() === 'openai' &&
    normalizeVisionMode(flipVisionMode) !== 'composite'
  )
}

function isRetryableProviderErrorText(error = '') {
  const text = String(error || '')
    .trim()
    .toLowerCase()

  if (!text) {
    return false
  }

  if (
    text.includes('invalid_api_key') ||
    text.includes('model_not_found') ||
    text.includes('does not exist') ||
    text.includes('do not have access') ||
    /\b(401|403)\b/.test(text)
  ) {
    return false
  }

  return (
    text.includes('timeout') ||
    text.includes('timed out') ||
    text.includes('econnaborted') ||
    text.includes('deadline_exceeded') ||
    text.includes('fetch failed') ||
    text.includes('rate_limit') ||
    text.includes('rate limit') ||
    text.includes('too large') ||
    text.includes('context length') ||
    /\b(429|500|502|503|504)\b/.test(text)
  )
}

function createSessionWindowError() {
  const error = new Error('Not enough time left in session for AI solve')
  error.code = 'session_window_too_small'
  return error
}

function resolveShortSessionOpenAiFastMode({
  sessionType,
  aiSolver = {},
  provider,
  model,
}) {
  if (sessionType !== 'short' || provider !== 'openai') {
    return {
      model,
      promptOptions: null,
    }
  }

  const promptOptions = {
    openAiServiceTier: 'priority',
    openAiReasoningEffort: 'xhigh',
  }

  if (aiSolver.shortSessionOpenAiFastEnabled !== true) {
    return {
      model,
      promptOptions,
    }
  }

  const requestedModel = String(aiSolver.shortSessionOpenAiFastModel || '')
    .trim()
    .toLowerCase()
  const fastModel = SHORT_SESSION_OPENAI_FAST_MODELS.includes(requestedModel)
    ? requestedModel
    : 'gpt-5.5'

  return {
    model: fastModel,
    promptOptions,
  }
}

function getSolveConcurrency({
  sessionType = 'short',
  provider = 'openai',
  aiSolver = {},
} = {}) {
  if (sessionType !== 'short' || provider !== 'openai') {
    return 1
  }

  const explicitShortConcurrency =
    aiSolver.shortSessionOpenAiParallelConcurrency != null
      ? aiSolver.shortSessionOpenAiParallelConcurrency
      : aiSolver.shortSessionOpenAiConcurrency
  const requested = toNumberOrFallback(
    explicitShortConcurrency,
    SHORT_SESSION_OPENAI_PARALLEL_CONCURRENCY
  )

  return Math.min(
    SHORT_SESSION_OPENAI_MAX_PARALLEL_CONCURRENCY,
    Math.max(1, requested)
  )
}

function getShortSessionOpenAiParallelLaunchDelayMs({
  sessionType = 'short',
  provider = 'openai',
  aiSolver = {},
} = {}) {
  if (sessionType !== 'short' || provider !== 'openai') {
    return 0
  }

  const configuredDelay =
    aiSolver.shortSessionOpenAiParallelLaunchDelayMs != null
      ? aiSolver.shortSessionOpenAiParallelLaunchDelayMs
      : aiSolver.shortSessionOpenAiLaunchDelayMs
  const requested = toNumberOrFallback(
    configuredDelay,
    SHORT_SESSION_OPENAI_PARALLEL_LAUNCH_DELAY_MS
  )

  return Math.min(2000, Math.max(0, requested))
}

function shouldUseLongSessionOpenAiStaggeredSolving({
  sessionType = 'long',
  provider = 'openai',
} = {}) {
  return (
    sessionType === 'long' &&
    String(provider || '')
      .trim()
      .toLowerCase() === 'openai'
  )
}

function getLongSessionOpenAiStaggerIntervalMs(aiSolver = {}) {
  return Math.max(
    0,
    toNumberOrFallback(
      aiSolver.longSessionOpenAiStaggerIntervalMs,
      LONG_SESSION_OPENAI_STAGGER_INTERVAL_MS
    )
  )
}

function getLongSessionOpenAiStaggerMaxInFlight(aiSolver = {}) {
  return Math.min(
    6,
    Math.max(
      1,
      toNumberOrFallback(
        aiSolver.longSessionOpenAiStaggerMaxInFlight,
        LONG_SESSION_OPENAI_STAGGER_MAX_IN_FLIGHT
      )
    )
  )
}

function estimateParallelLaunchDelayBudgetMs({
  flipCount = 0,
  concurrency = 1,
  launchDelayMs = 0,
} = {}) {
  const normalizedFlipCount = Math.max(0, toNumberOrFallback(flipCount, 0))
  const normalizedConcurrency = Math.max(1, toNumberOrFallback(concurrency, 1))
  const normalizedLaunchDelayMs = Math.max(
    0,
    toNumberOrFallback(launchDelayMs, 0)
  )
  let remaining = normalizedFlipCount
  let totalMs = 0

  while (remaining > 0) {
    const batchSize = Math.min(normalizedConcurrency, remaining)
    totalMs += Math.max(0, batchSize - 1) * normalizedLaunchDelayMs
    remaining -= batchSize
  }

  return totalMs
}

function applyShortSessionOpenAiParallelTimeout(
  profile,
  {
    sessionType = 'short',
    provider = 'openai',
    aiSolver = {},
    flipCount = 0,
  } = {}
) {
  const normalizedProvider = String(provider || '')
    .trim()
    .toLowerCase()

  if (sessionType !== 'short' || normalizedProvider !== 'openai') {
    return profile
  }

  const normalizedFlipCount = Math.max(0, toNumberOrFallback(flipCount, 0))
  const solveConcurrency = getSolveConcurrency({
    sessionType,
    provider: normalizedProvider,
    aiSolver,
  })

  if (normalizedFlipCount < 2 || solveConcurrency < normalizedFlipCount) {
    return profile
  }

  const requestTimeoutMs = SHORT_SESSION_OPENAI_PARALLEL_REQUEST_TIMEOUT_MS
  const uncertaintyConfidenceThreshold = Math.max(
    toFloatOrFallback(
      profile.uncertaintyConfidenceThreshold,
      DEFAULT_PROFILE.uncertaintyConfidenceThreshold
    ),
    SHORT_SESSION_OPENAI_PARALLEL_UNCERTAINTY_THRESHOLD
  )

  return {
    ...profile,
    uncertaintyRepromptEnabled: true,
    uncertaintyConfidenceThreshold,
    uncertaintyRepromptMinRemainingMs: Math.max(
      toNumberOrFallback(
        profile.uncertaintyRepromptMinRemainingMs,
        DEFAULT_PROFILE.uncertaintyRepromptMinRemainingMs
      ),
      SHORT_SESSION_OPENAI_PARALLEL_REPROMPT_MIN_REMAINING_MS
    ),
    probabilityEnsembleEnabled: true,
    probabilityRuns:
      normalizeProbabilityRuns(profile.probabilityRuns) ===
      DEFAULT_PROFILE.probabilityRuns
        ? SHORT_SESSION_OPENAI_PARALLEL_PROBABILITY_RUNS
        : normalizeProbabilityRuns(profile.probabilityRuns),
    probabilityReasoningEffort:
      SHORT_SESSION_OPENAI_PARALLEL_PROBABILITY_REASONING_EFFORT,
    requestTimeoutMs,
    maxRetries: 0,
    deadlineMs: Math.max(
      toNumberOrFallback(profile.deadlineMs, DEFAULT_PROFILE.deadlineMs),
      SHORT_SESSION_OPENAI_PARALLEL_DEADLINE_MS,
      requestTimeoutMs * 2 + SHORT_SESSION_OPENAI_PARALLEL_DEADLINE_PADDING_MS
    ),
  }
}

function getImagePayloadPrepRetryWaitMs() {
  const configuredWaitMs = Number(
    global.env?.VALIDATION_AI_IMAGE_PAYLOAD_PREP_RETRY_WAIT_MS
  )
  return Number.isFinite(configuredWaitMs) && configuredWaitMs >= 0
    ? configuredWaitMs
    : IMAGE_PAYLOAD_PREP_RETRY_WAIT_MS
}

function applyLongSessionOpenAiStaggeredTimeout(
  profile,
  {sessionType = 'long', provider = 'openai', aiSolver = {}, flipCount = 0} = {}
) {
  if (
    !shouldUseLongSessionOpenAiStaggeredSolving({
      sessionType,
      provider,
    })
  ) {
    return profile
  }

  const normalizedFlipCount = Math.max(1, toNumberOrFallback(flipCount, 1))
  const staggerIntervalMs = getLongSessionOpenAiStaggerIntervalMs(aiSolver)
  const requestTimeoutMs = Math.max(
    toNumberOrFallback(
      profile.requestTimeoutMs,
      DEFAULT_PROFILE.requestTimeoutMs
    ),
    LONG_SESSION_OPENAI_STAGGER_REQUEST_TIMEOUT_MS
  )
  const staggeredDeadlineMs =
    IMAGE_PREP_BASE_MS +
    normalizedFlipCount * FRAME_REVIEW_PREP_MIN_MS +
    Math.max(0, normalizedFlipCount - 1) * staggerIntervalMs +
    requestTimeoutMs +
    LONG_SESSION_OPENAI_STAGGER_DEADLINE_PADDING_MS

  return {
    ...profile,
    requestTimeoutMs,
    deadlineMs: Math.max(
      toNumberOrFallback(profile.deadlineMs, DEFAULT_PROFILE.deadlineMs),
      staggeredDeadlineMs
    ),
  }
}

function ensureRuntimeRemaining(deadlineAt, minimumMs = 0) {
  if (!Number.isFinite(deadlineAt)) {
    return
  }

  if (Date.now() + Math.max(0, minimumMs) > deadlineAt) {
    throw createSessionWindowError()
  }
}

function hasRuntimeRemaining(deadlineAt, minimumMs = 0) {
  if (!Number.isFinite(deadlineAt)) {
    return true
  }

  return Date.now() + Math.max(0, minimumMs) <= deadlineAt
}

function getSessionSolveGuardMs(sessionType = 'short') {
  return sessionType === 'short'
    ? SHORT_SESSION_MIN_SOLVE_GUARD_MS
    : MIN_SOLVE_GUARD_MS
}

function getClampedRequestTimeoutMs({
  deadlineAt,
  guardMs,
  requestTimeoutMs,
} = {}) {
  const normalizedRequestTimeoutMs = Math.max(
    MIN_PROVIDER_REQUEST_TIMEOUT_MS,
    toNumberOrFallback(requestTimeoutMs, DEFAULT_PROFILE.requestTimeoutMs)
  )
  const remainingMs = getTimeRemainingMs(deadlineAt)

  if (!Number.isFinite(remainingMs)) {
    return normalizedRequestTimeoutMs
  }

  return Math.max(
    MIN_PROVIDER_REQUEST_TIMEOUT_MS,
    Math.min(normalizedRequestTimeoutMs, remainingMs - Math.max(0, guardMs))
  )
}

export function planValidationAiSolve({
  sessionType = 'short',
  shortFlips = [],
  longFlips = [],
  aiSolver = {},
  maxFlips,
} = {}) {
  const profile = normalizeProfile(
    resolveSessionProfileInput(aiSolver, sessionType)
  )
  const provider = String(aiSolver.provider || 'openai')
    .trim()
    .toLowerCase()
  const defaultModel = String(aiSolver.model || 'gpt-5.5').trim() || 'gpt-5.5'
  const shortSessionOpenAiFastMode = resolveShortSessionOpenAiFastMode({
    sessionType,
    aiSolver,
    provider,
    model: defaultModel,
  })
  const {model, promptOptions} = shortSessionOpenAiFastMode
  const providerConfig = buildProviderConfig(aiSolver)
  const consultProviders = buildConsultProviders(aiSolver, providerConfig)
  const candidateFlips = pickCandidateFlips({
    sessionType,
    shortFlips,
    longFlips,
    maxFlips,
  })
  const baseEffectiveProfile = buildEffectiveProfile(
    profile,
    provider,
    sessionType
  )
  const effectiveProfile = applyLongSessionOpenAiStaggeredTimeout(
    applyShortSessionOpenAiParallelTimeout(baseEffectiveProfile, {
      sessionType,
      provider,
      aiSolver,
      flipCount: candidateFlips.length,
    }),
    {
      sessionType,
      provider,
      aiSolver,
      flipCount: candidateFlips.length,
    }
  )

  return {
    sessionType,
    profile,
    provider,
    effectiveProfile,
    model,
    providerConfig,
    consultProviders,
    promptOptions,
    candidateFlips,
  }
}

export function estimateValidationAiSolveBudget(options = {}) {
  const solvePlan = planValidationAiSolve(options)
  const {
    provider,
    effectiveProfile,
    candidateFlips,
    promptOptions,
    sessionType,
  } = solvePlan
  const shouldPrepareFramePayloads =
    effectiveProfile.flipVisionMode !== 'composite' ||
    provider === 'local-ai' ||
    (effectiveProfile.uncertaintyRepromptEnabled &&
      !(effectiveProfile.probabilityEnsembleEnabled && provider !== 'local-ai'))
  const prepPerFlipMs = shouldPrepareFramePayloads
    ? Math.max(
        FRAME_REVIEW_PREP_MIN_MS,
        IMAGE_PREP_PER_FLIP_MS[provider] || IMAGE_PREP_PER_FLIP_MS.default
      )
    : IMAGE_PREP_PER_FLIP_MS[provider] || IMAGE_PREP_PER_FLIP_MS.default
  const perFlipSolveMs = estimatePerFlipSolveRuntimeMs({
    sessionType,
    provider,
    profile: effectiveProfile,
    promptOptions,
  })
  const uncertaintyReviewFlipCount = estimateUncertaintyReviewFlipCount({
    sessionType,
    flipCount: candidateFlips.length,
    uncertaintyRepromptEnabled:
      effectiveProfile.uncertaintyRepromptEnabled &&
      !(effectiveProfile.probabilityEnsembleEnabled && provider !== 'local-ai'),
  })
  const expectedPassRuntimeMs = estimateExpectedPassRuntimeMs({
    sessionType,
    provider,
    requestTimeoutMs: effectiveProfile.requestTimeoutMs,
    promptOptions:
      effectiveProfile.probabilityEnsembleEnabled && provider !== 'local-ai'
        ? null
        : promptOptions,
  })
  const uncertaintyReviewReserveMs =
    uncertaintyReviewFlipCount > 0
      ? uncertaintyReviewFlipCount * (prepPerFlipMs + expectedPassRuntimeMs * 2)
      : 0
  const retryReserveMs = estimateRetryReserveMs({
    flipCount: candidateFlips.length,
    maxRetries: effectiveProfile.maxRetries,
    expectedPassRuntimeMs,
  })
  const solveConcurrency = getSolveConcurrency({
    sessionType,
    provider,
    aiSolver: options.aiSolver,
  })
  const parallelLaunchDelayMs = getShortSessionOpenAiParallelLaunchDelayMs({
    sessionType,
    provider,
    aiSolver: options.aiSolver,
  })
  const usesLongSessionOpenAiStaggeredSolving =
    shouldUseLongSessionOpenAiStaggeredSolving({
      sessionType,
      provider,
    })
  const solveWaveCount =
    !usesLongSessionOpenAiStaggeredSolving && candidateFlips.length > 0
      ? Math.ceil(candidateFlips.length / solveConcurrency)
      : 0
  const staggeredSolveMs =
    usesLongSessionOpenAiStaggeredSolving && candidateFlips.length > 0
      ? Math.max(0, candidateFlips.length - 1) *
          getLongSessionOpenAiStaggerIntervalMs(options.aiSolver) +
        Math.max(perFlipSolveMs, effectiveProfile.requestTimeoutMs)
      : 0
  const parallelLaunchDelayBudgetMs =
    !usesLongSessionOpenAiStaggeredSolving && solveConcurrency > 1
      ? estimateParallelLaunchDelayBudgetMs({
          flipCount: candidateFlips.length,
          concurrency: solveConcurrency,
          launchDelayMs: parallelLaunchDelayMs,
        })
      : 0

  return {
    ...solvePlan,
    flipCount: candidateFlips.length,
    solveConcurrency,
    prepPerFlipMs,
    perFlipSolveMs,
    parallelLaunchDelayMs,
    parallelLaunchDelayBudgetMs,
    uncertaintyReviewFlipCount,
    uncertaintyReviewReserveMs,
    retryReserveMs,
    estimatedMs:
      IMAGE_PREP_BASE_MS +
      candidateFlips.length * prepPerFlipMs +
      solveWaveCount * perFlipSolveMs +
      parallelLaunchDelayBudgetMs +
      staggeredSolveMs +
      uncertaintyReviewReserveMs +
      retryReserveMs,
  }
}

export async function solveValidationSessionWithAi({
  sessionType = 'short',
  shortFlips = [],
  longFlips = [],
  aiSolver = {},
  sessionMeta = null,
  onProgress,
  onDecision,
  maxFlips,
  hardDeadlineAt = null,
} = {}) {
  const bridge = ensureBridge()
  const {
    profile,
    provider,
    effectiveProfile,
    model,
    providerConfig,
    consultProviders,
    promptOptions,
    candidateFlips,
  } = planValidationAiSolve({
    sessionType,
    shortFlips,
    longFlips,
    aiSolver,
    maxFlips,
  })

  if (!candidateFlips.length) {
    throw new Error('No solvable flips available for AI helper')
  }

  const startedAt = Date.now()
  const sessionDeadlineAt = normalizeDeadlineAt(hardDeadlineAt)
  const sessionSolveGuardMs = getSessionSolveGuardMs(sessionType)
  ensureRuntimeRemaining(sessionDeadlineAt, sessionSolveGuardMs)
  const safeSessionDeadlineAt = Number.isFinite(sessionDeadlineAt)
    ? sessionDeadlineAt - sessionSolveGuardMs
    : null
  const buildDeadlineAt = Number.isFinite(sessionDeadlineAt)
    ? Math.min(
        safeSessionDeadlineAt,
        Date.now() + Math.max(effectiveProfile.deadlineMs, 15 * 1000)
      )
    : Date.now() + Math.max(effectiveProfile.deadlineMs, 15 * 1000)
  const useFrameVision =
    effectiveProfile.flipVisionMode !== 'composite' || provider === 'local-ai'
  const prepareFramePayloads =
    useFrameVision ||
    (effectiveProfile.uncertaintyRepromptEnabled &&
      !(effectiveProfile.probabilityEnsembleEnabled && provider !== 'local-ai'))
  const frameRenderSize =
    provider === 'local-ai'
      ? {frameWidth: 384, frameHeight: 288}
      : {frameWidth: 512, frameHeight: 384}

  const results = []
  const totalFlips = candidateFlips.length
  const solveConcurrency = getSolveConcurrency({
    sessionType,
    provider,
    aiSolver,
  })
  const shortSessionOpenAiParallelLaunchDelayMs =
    getShortSessionOpenAiParallelLaunchDelayMs({
      sessionType,
      provider,
      aiSolver,
    })
  const useLongSessionOpenAiStaggeredSolving =
    shouldUseLongSessionOpenAiStaggeredSolving({
      sessionType,
      provider,
    })
  const longSessionOpenAiStaggerIntervalMs =
    getLongSessionOpenAiStaggerIntervalMs(aiSolver)
  const longSessionOpenAiStaggerMaxInFlight =
    getLongSessionOpenAiStaggerMaxInFlight(aiSolver)
  const pendingPreparedFlips = []
  const activeStaggeredSolves = []
  let nextStaggeredSolveTaskId = 0
  let nextStaggeredSolveLaunchAt = 0
  const providerDailyBudgetRemainingUsd =
    normalizeProviderDailyBudgetRemainingUsd(
      aiSolver.providerDailyBudgetRemainingUsd
    )
  let providerBudgetExceeded = false

  function hasProviderDailyBudgetAvailable() {
    return (
      providerDailyBudgetRemainingUsd === null ||
      getResultsCostUsd(results) < providerDailyBudgetRemainingUsd
    )
  }

  async function emitWaitingDelay(index) {
    const delayMs = Math.max(
      0,
      toNumberOrFallback(effectiveProfile.interFlipDelayMs, 0)
    )
    if (delayMs <= 0 || index >= totalFlips - 1) {
      return
    }

    const remainingBeforeDelayMs = getTimeRemainingMs(sessionDeadlineAt)
    const waitMs = Number.isFinite(remainingBeforeDelayMs)
      ? Math.min(
          delayMs,
          Math.max(0, remainingBeforeDelayMs - sessionSolveGuardMs)
        )
      : delayMs
    if (onProgress) {
      onProgress({
        stage: 'waiting',
        sessionType,
        index: index + 1,
        total: totalFlips,
        waitMs,
      })
    }
    if (waitMs > 0) {
      await sleep(waitMs)
    }
  }

  function buildSolvedDecision({payloadFlip, index, solved}) {
    const option = toAnswerOption(solved.answer)
    let modelFallbacks = []
    if (Array.isArray(solved.modelFallbacks)) {
      modelFallbacks = solved.modelFallbacks
    } else if (solved.modelFallback) {
      modelFallbacks = [solved.modelFallback]
    }

    return {
      sessionType,
      index: index + 1,
      total: totalFlips,
      hash: solved.hash,
      answer: solved.answer,
      option,
      confidence: solved.confidence,
      latencyMs: solved.latencyMs,
      error: solved.error,
      fastMode: solved.fastMode || null,
      modelFallback: solved.modelFallback || null,
      modelFallbacks,
      leftImage: payloadFlip.leftImage,
      rightImage: payloadFlip.rightImage,
      leftFrames: payloadFlip.leftFrames,
      rightFrames: payloadFlip.rightFrames,
      words: payloadFlip.words,
      expectedAnswer: payloadFlip.expectedAnswer,
      expectedStrength: payloadFlip.expectedStrength,
      consensusAnswer: payloadFlip.consensusAnswer,
      consensusStrength: payloadFlip.consensusStrength,
      consensusVotes: payloadFlip.consensusVotes,
      sourceDataset: payloadFlip.sourceDataset,
      sourceSplit: payloadFlip.sourceSplit,
      sourceStats: payloadFlip.sourceStats,
      rawAnswerBeforeRemap: solved.rawAnswerBeforeRemap,
      finalAnswerAfterRemap: solved.finalAnswerAfterRemap,
      sideSwapped: solved.sideSwapped,
      tokenUsage: normalizeTokenUsage(solved.tokenUsage),
      costs: normalizeCostSummary(solved.costs),
      reasoning: solved.reasoning,
      uncertaintyRepromptUsed: Boolean(solved.uncertaintyRepromptUsed),
      finalAdjudicationUsed: Boolean(solved.finalAdjudicationUsed),
      forcedDecision: Boolean(solved.forcedDecision),
      forcedDecisionPolicy: solved.forcedDecisionPolicy || null,
      forcedDecisionReason: solved.forcedDecisionReason || null,
      ensembleTieBreakApplied: Boolean(solved.ensembleTieBreakApplied),
      ensembleTieBreakCandidates: Array.isArray(
        solved.ensembleTieBreakCandidates
      )
        ? solved.ensembleTieBreakCandidates
        : null,
      secondPassStrategy: solved.secondPassStrategy || null,
      frameReasoningUsed: Boolean(solved.frameReasoningUsed),
      flipVisionModeRequested: solved.flipVisionModeRequested || null,
      flipVisionModeApplied: solved.flipVisionModeApplied || null,
      flipVisionModeFallback: solved.flipVisionModeFallback || null,
      firstPass: solved.firstPass || null,
    }
  }

  function buildPayloadFlipFallback(flip) {
    return {
      hash: flip.hash,
      leftImage: null,
      rightImage: null,
      leftFrames: [],
      rightFrames: [],
      words: Array.isArray(flip.words) ? flip.words : [],
      keywords: normalizeAnswerPhaseKeywords(flip.keywords || flip.words),
      expectedAnswer: flip.expectedAnswer || null,
      expectedStrength: flip.expectedStrength || null,
      consensusAnswer: flip.consensusAnswer || null,
      consensusStrength: flip.consensusStrength || null,
      consensusVotes: flip.consensusVotes || null,
      sourceDataset: flip.sourceDataset || null,
      sourceSplit: flip.sourceSplit || null,
      sourceStats: flip.sourceStats || null,
    }
  }

  function buildProviderPayloadFlip(payloadFlip) {
    return {
      hash: payloadFlip.hash,
      leftImage: payloadFlip.leftImage || null,
      rightImage: payloadFlip.rightImage || null,
      leftFrames: Array.isArray(payloadFlip.leftFrames)
        ? payloadFlip.leftFrames
        : [],
      rightFrames: Array.isArray(payloadFlip.rightFrames)
        ? payloadFlip.rightFrames
        : [],
      keywords: normalizeAnswerPhaseKeywords(payloadFlip.keywords),
    }
  }

  function buildForcedRandomSolvedFlip({
    hash,
    index = null,
    error,
    reasoning,
    forcedDecisionReason = 'session_fallback',
  }) {
    const answer = chooseDeterministicRandomAnswer(hash, index)

    return {
      hash,
      answer,
      confidence: 0,
      latencyMs: 0,
      error,
      reasoning: `${reasoning}; deterministic random fallback ${answer}`,
      rawAnswerBeforeRemap: 'skip',
      finalAnswerAfterRemap: answer,
      sideSwapped: false,
      tokenUsage: normalizeTokenUsage(),
      costs: normalizeCostSummary(),
      uncertaintyRepromptUsed: false,
      forcedDecision: true,
      forcedDecisionPolicy: 'random',
      forcedDecisionReason,
      ensembleTieBreakApplied: false,
      ensembleTieBreakCandidates: null,
      secondPassStrategy: null,
      frameReasoningUsed: false,
      firstPass: null,
    }
  }

  function buildSkippedSolvedFlip({
    hash,
    error,
    reasoning,
    forcedDecisionReason = null,
    source = null,
  }) {
    const sourceReasoning = [source?.reasoning, reasoning]
      .filter(Boolean)
      .join('; ')

    return {
      ...(source || {}),
      hash,
      answer: 'skip',
      confidence: normalizeConfidence(source?.confidence),
      latencyMs: source?.latencyMs || 0,
      error: error || source?.error || null,
      reasoning: sourceReasoning || 'AI deferred this flip',
      rawAnswerBeforeRemap: source?.rawAnswerBeforeRemap || 'skip',
      finalAnswerAfterRemap: 'skip',
      sideSwapped: Boolean(source?.sideSwapped),
      tokenUsage: normalizeTokenUsage(source?.tokenUsage),
      costs: normalizeCostSummary(source?.costs),
      uncertaintyRepromptUsed: Boolean(source?.uncertaintyRepromptUsed),
      finalAdjudicationUsed: Boolean(source?.finalAdjudicationUsed),
      forcedDecision: false,
      forcedDecisionPolicy: null,
      forcedDecisionReason,
      ensembleTieBreakApplied: Boolean(source?.ensembleTieBreakApplied),
      ensembleTieBreakCandidates: Array.isArray(
        source?.ensembleTieBreakCandidates
      )
        ? source.ensembleTieBreakCandidates
        : null,
      secondPassStrategy: source?.secondPassStrategy || null,
      frameReasoningUsed: Boolean(source?.frameReasoningUsed),
      firstPass: source?.firstPass || null,
      modelFallback: source?.modelFallback || null,
      modelFallbacks: Array.isArray(source?.modelFallbacks)
        ? source.modelFallbacks
        : null,
    }
  }

  function buildSessionFallbackSolvedFlip({
    hash,
    index = null,
    error,
    reasoning,
    forcedDecisionReason,
    source = null,
  }) {
    if (sessionType === 'long') {
      return buildSkippedSolvedFlip({
        hash,
        error,
        reasoning,
        forcedDecisionReason,
        source,
      })
    }

    return buildForcedRandomSolvedFlip({
      hash,
      index,
      error,
      reasoning,
      forcedDecisionReason,
    })
  }

  async function applyForcedRandomFlipDecision({
    flip,
    index,
    error,
    reasoning,
    forcedDecisionReason,
  }) {
    await applySolvedPayloadFlip({
      payloadFlip: buildPayloadFlipFallback(flip),
      index,
      solved: buildSessionFallbackSolvedFlip({
        hash: flip.hash,
        index,
        error,
        reasoning,
        forcedDecisionReason,
      }),
    })
  }

  async function solvePreparedPayloadFlip({payloadFlip, sourceFlip, index}) {
    function resolveRequestTiming() {
      const requestTimeoutMs = getClampedRequestTimeoutMs({
        deadlineAt: sessionDeadlineAt,
        guardMs: sessionSolveGuardMs,
        requestTimeoutMs: effectiveProfile.requestTimeoutMs,
      })
      const remainingSessionMs = getTimeRemainingMs(sessionDeadlineAt)
      const safeRemainingSessionMs = Number.isFinite(remainingSessionMs)
        ? Math.max(0, remainingSessionMs - sessionSolveGuardMs)
        : remainingSessionMs
      let requestDeadlineMs = effectiveProfile.deadlineMs
      if (
        useLongSessionOpenAiStaggeredSolving &&
        Number.isFinite(safeRemainingSessionMs)
      ) {
        requestDeadlineMs = Math.max(
          1000,
          Math.min(
            requestTimeoutMs + LONG_SESSION_OPENAI_STAGGER_DEADLINE_PADDING_MS,
            safeRemainingSessionMs
          )
        )
      } else if (Number.isFinite(safeRemainingSessionMs)) {
        requestDeadlineMs = Math.max(
          1000,
          Math.min(effectiveProfile.deadlineMs, safeRemainingSessionMs)
        )
      }

      return {requestTimeoutMs, requestDeadlineMs}
    }

    if (
      !hasRuntimeRemaining(
        sessionDeadlineAt,
        sessionSolveGuardMs + MIN_PROVIDER_REQUEST_TIMEOUT_MS
      )
    ) {
      return {
        payloadFlip,
        index,
        solved: buildSessionFallbackSolvedFlip({
          hash: payloadFlip.hash,
          index,
          error: 'deadline_guard',
          reasoning: 'not enough session time remained for provider request',
          forcedDecisionReason: 'deadline_guard',
        }),
      }
    }

    if (onProgress) {
      onProgress({
        stage: 'solving',
        sessionType,
        index: index + 1,
        total: totalFlips,
        hash: payloadFlip.hash,
        leftImage: payloadFlip.leftImage,
        rightImage: payloadFlip.rightImage,
        leftFrames: payloadFlip.leftFrames,
        rightFrames: payloadFlip.rightFrames,
        words: payloadFlip.words,
        expectedAnswer: payloadFlip.expectedAnswer,
        expectedStrength: payloadFlip.expectedStrength,
        consensusAnswer: payloadFlip.consensusAnswer,
        consensusStrength: payloadFlip.consensusStrength,
        consensusVotes: payloadFlip.consensusVotes,
        sourceDataset: payloadFlip.sourceDataset,
        sourceSplit: payloadFlip.sourceSplit,
        sourceStats: payloadFlip.sourceStats,
      })
    }

    async function requestSolvedFlip({
      requestPayloadFlip = payloadFlip,
      flipVisionMode = effectiveProfile.flipVisionMode,
      uncertaintyRepromptEnabled = effectiveProfile.uncertaintyRepromptEnabled,
      sessionExtra = null,
    } = {}) {
      const {requestTimeoutMs, requestDeadlineMs} = resolveRequestTiming()

      return bridge.solveFlipBatch({
        provider,
        model,
        providerConfig,
        providerDailyBudgetEnabled:
          aiSolver.providerDailyBudgetEnabled !== false,
        providerDailyBudgetRemainingUsd:
          aiSolver.providerDailyBudgetRemainingUsd,
        ensembleEnabled: Boolean(aiSolver.ensembleEnabled),
        ensemblePrimaryWeight: normalizeWeight(
          aiSolver.ensemblePrimaryWeight,
          1
        ),
        legacyHeuristicEnabled: Boolean(aiSolver.legacyHeuristicEnabled),
        legacyHeuristicWeight: normalizeWeight(
          aiSolver.legacyHeuristicWeight,
          1
        ),
        legacyHeuristicOnly: Boolean(aiSolver.legacyHeuristicOnly),
        consultProviders,
        benchmarkProfile: profile.benchmarkProfile,
        deadlineMs: requestDeadlineMs,
        requestTimeoutMs,
        maxConcurrency: 1,
        maxRetries: effectiveProfile.maxRetries,
        maxOutputTokens: effectiveProfile.maxOutputTokens,
        temperature: effectiveProfile.temperature,
        forceDecision:
          sessionType === 'long' ? false : effectiveProfile.forceDecision,
        uncertaintyRepromptEnabled,
        uncertaintyConfidenceThreshold:
          effectiveProfile.uncertaintyConfidenceThreshold,
        uncertaintyRepromptMinRemainingMs:
          effectiveProfile.uncertaintyRepromptMinRemainingMs,
        uncertaintyRepromptInstruction:
          effectiveProfile.uncertaintyRepromptInstruction,
        promptTemplateOverride: effectiveProfile.promptTemplateOverride,
        flipVisionMode,
        probabilityEnsembleEnabled: effectiveProfile.probabilityEnsembleEnabled,
        probabilityRuns: effectiveProfile.probabilityRuns,
        probabilityPasses: effectiveProfile.probabilityPasses,
        probabilityDecisionDelta: effectiveProfile.probabilityDecisionDelta,
        probabilityUseSwappedOrder: effectiveProfile.probabilityUseSwappedOrder,
        probabilityReasoningEffort: effectiveProfile.probabilityReasoningEffort,
        promptOptions,
        flips: [buildProviderPayloadFlip(requestPayloadFlip)],
        session: {
          ...(sessionMeta || {}),
          ...(sessionExtra || {}),
          sessionType,
          flipIndex: index + 1,
          totalFlips,
        },
      })
    }

    const batchResult = await requestSolvedFlip()
    let solvedPayloadFlip = payloadFlip

    let providerSolved =
      (batchResult.results || [])[0] ||
      buildSessionFallbackSolvedFlip({
        hash: payloadFlip.hash,
        index,
        error: 'no_result',
        reasoning: 'provider returned no result',
        forcedDecisionReason: 'provider_no_result',
      })

    const providerErrorText = String(providerSolved.error || '').trim()
    const canRetryCompositeFallback =
      shouldPrepareOpenAiCompositeFallback({
        sessionType,
        provider,
        flipVisionMode: effectiveProfile.flipVisionMode,
      }) &&
      Boolean(sourceFlip) &&
      providerSolved.forcedDecisionReason === 'provider_error' &&
      isRetryableProviderErrorText(providerErrorText) &&
      hasRuntimeRemaining(
        sessionDeadlineAt,
        sessionSolveGuardMs + MIN_PROVIDER_REQUEST_TIMEOUT_MS
      )

    if (canRetryCompositeFallback) {
      let fallbackPayloadFlip = null
      try {
        fallbackPayloadFlip = await buildCompositePayloadFlipFallback({
          sourceFlip,
          payloadFlip,
        })
      } catch {
        fallbackPayloadFlip = null
      }

      const fallbackReady =
        Boolean(fallbackPayloadFlip) &&
        hasRuntimeRemaining(
          sessionDeadlineAt,
          sessionSolveGuardMs + MIN_PROVIDER_REQUEST_TIMEOUT_MS
        )
      const fallbackBatchResult = fallbackReady
        ? await requestSolvedFlip({
            requestPayloadFlip: fallbackPayloadFlip,
            flipVisionMode: 'composite',
            uncertaintyRepromptEnabled: false,
            sessionExtra: {
              fallbackFromFlipVisionMode: effectiveProfile.flipVisionMode,
              fallbackReason: OPENAI_FRAME_PROVIDER_ERROR_FALLBACK_REASON,
            },
          })
        : null
      const fallbackSolved = ((fallbackBatchResult || {}).results || [])[0]

      if (
        fallbackSolved &&
        toAnswerOption(fallbackSolved.answer) > 0 &&
        !fallbackSolved.error
      ) {
        providerSolved = {
          ...fallbackSolved,
          flipVisionModeRequested: effectiveProfile.flipVisionMode,
          flipVisionModeApplied: 'composite',
          flipVisionModeFallback: OPENAI_FRAME_PROVIDER_ERROR_FALLBACK_REASON,
          firstPass: {
            answer: providerSolved.answer,
            confidence: providerSolved.confidence,
            error: providerSolved.error,
            reasoning: providerSolved.reasoning,
            rawAnswerBeforeRemap: providerSolved.rawAnswerBeforeRemap,
            strategy: providerSolved.secondPassStrategy,
          },
        }
        solvedPayloadFlip = fallbackPayloadFlip
      }
    }

    const solved =
      toAnswerOption(providerSolved.answer) > 0
        ? providerSolved
        : buildSessionFallbackSolvedFlip({
            hash: payloadFlip.hash,
            index,
            error: providerSolved.error || 'skip_answer',
            reasoning:
              providerSolved.reasoning ||
              'provider returned skip during answer session',
            source: providerSolved,
            forcedDecisionReason: providerSolved.error
              ? 'provider_error'
              : 'provider_skip',
          })

    return {payloadFlip: solvedPayloadFlip, index, solved}
  }

  async function applySolvedPayloadFlip(solvedEntry) {
    if (!solvedEntry) {
      return
    }

    const {payloadFlip, index, solved} = solvedEntry
    results.push(solved)

    const decision = buildSolvedDecision({payloadFlip, index, solved})

    if (onProgress) {
      onProgress({
        stage: 'solved',
        ...decision,
      })
    }

    if (onDecision) {
      await onDecision(decision)
    }

    if (!hasProviderDailyBudgetAvailable()) {
      providerBudgetExceeded = true
    }

    if (solveConcurrency === 1 && !useLongSessionOpenAiStaggeredSolving) {
      await emitWaitingDelay(index)
    }
  }

  async function waitForParallelLaunchDelay(launchIndex) {
    const launchDelayMs = Math.max(
      0,
      shortSessionOpenAiParallelLaunchDelayMs * Math.max(0, launchIndex)
    )

    if (launchDelayMs <= 0) {
      return
    }

    const remainingBeforeDelayMs = getTimeRemainingMs(sessionDeadlineAt)
    const waitMs = Number.isFinite(remainingBeforeDelayMs)
      ? Math.min(
          launchDelayMs,
          Math.max(
            0,
            remainingBeforeDelayMs -
              sessionSolveGuardMs -
              MIN_PROVIDER_REQUEST_TIMEOUT_MS
          )
        )
      : launchDelayMs

    if (waitMs > 0) {
      await sleep(waitMs)
    }
  }

  async function solvePreparedPayloadFlipWithLaunchDelay(
    preparedFlip,
    launchIndex
  ) {
    if (solveConcurrency > 1 && !useLongSessionOpenAiStaggeredSolving) {
      await waitForParallelLaunchDelay(launchIndex)
    }

    if (sessionType !== 'short' || !Number.isFinite(safeSessionDeadlineAt)) {
      return solvePreparedPayloadFlip(preparedFlip)
    }

    const fallbackWaitMs = Math.max(0, safeSessionDeadlineAt - Date.now())
    if (fallbackWaitMs <= 0) {
      return {
        payloadFlip: preparedFlip.payloadFlip,
        index: preparedFlip.index,
        solved: buildForcedRandomSolvedFlip({
          hash: preparedFlip.payloadFlip.hash,
          index: preparedFlip.index,
          error: 'safe_submit_guard',
          reasoning:
            'short-session safe-submit guard reached before provider result',
          forcedDecisionReason: 'safe_submit_guard',
        }),
      }
    }

    const solvePromise = solvePreparedPayloadFlip(preparedFlip)
    let settled = false
    const guardedSolvePromise = solvePromise.then(
      (solvedEntry) => {
        settled = true
        return solvedEntry
      },
      (error) => {
        settled = true
        throw error
      }
    )
    const fallbackPromise = sleep(fallbackWaitMs).then(() =>
      settled
        ? null
        : {
            payloadFlip: preparedFlip.payloadFlip,
            index: preparedFlip.index,
            solved: buildForcedRandomSolvedFlip({
              hash: preparedFlip.payloadFlip.hash,
              index: preparedFlip.index,
              error: 'safe_submit_guard',
              reasoning:
                'short-session safe-submit guard reached before provider result',
              forcedDecisionReason: 'safe_submit_guard',
            }),
          }
    )
    const result = await Promise.race([guardedSolvePromise, fallbackPromise])

    if (result?.solved?.forcedDecisionReason === 'safe_submit_guard') {
      guardedSolvePromise.catch(() => {})
      return result
    }

    return result || guardedSolvePromise
  }

  function removeActiveStaggeredSolve(taskId) {
    const taskIndex = activeStaggeredSolves.findIndex(
      (item) => item.taskId === taskId
    )
    if (taskIndex >= 0) {
      activeStaggeredSolves.splice(taskIndex, 1)
    }
  }

  async function applyCompletedStaggeredSolve(completed) {
    if (!completed || completed.type === 'timer') {
      return false
    }

    removeActiveStaggeredSolve(completed.taskId)
    await applySolvedPayloadFlip(completed.solvedEntry)
    return true
  }

  async function waitForNextStaggeredSolve({untilMs = 0} = {}) {
    while (activeStaggeredSolves.length) {
      const waitMs = Math.max(0, untilMs - Date.now())
      const raceEntries = activeStaggeredSolves.map(({promise}) => promise)
      if (waitMs > 0) {
        raceEntries.push(sleep(waitMs).then(() => ({type: 'timer'})))
      }

      // eslint-disable-next-line no-await-in-loop
      const completed = await Promise.race(raceEntries)
      // eslint-disable-next-line no-await-in-loop
      const applied = await applyCompletedStaggeredSolve(completed)
      if (!applied || (untilMs > 0 && Date.now() >= untilMs)) {
        return
      }
    }

    const remainingWaitMs = Math.max(0, untilMs - Date.now())
    if (remainingWaitMs > 0) {
      await sleep(remainingWaitMs)
    }
  }

  async function waitForStaggeredLaunchSlot() {
    if (nextStaggeredSolveLaunchAt > Date.now()) {
      await waitForNextStaggeredSolve({untilMs: nextStaggeredSolveLaunchAt})
    }

    while (
      activeStaggeredSolves.length >= longSessionOpenAiStaggerMaxInFlight
    ) {
      // eslint-disable-next-line no-await-in-loop
      await waitForNextStaggeredSolve()
    }
  }

  async function launchStaggeredPreparedFlip(preparedFlip) {
    await waitForStaggeredLaunchSlot()

    if (providerBudgetExceeded || !hasProviderDailyBudgetAvailable()) {
      providerBudgetExceeded = true
      return
    }

    if (
      !hasRuntimeRemaining(
        sessionDeadlineAt,
        sessionSolveGuardMs + MIN_PROVIDER_REQUEST_TIMEOUT_MS
      )
    ) {
      await applySolvedPayloadFlip({
        payloadFlip: preparedFlip.payloadFlip,
        index: preparedFlip.index,
        solved: buildSessionFallbackSolvedFlip({
          hash: preparedFlip.payloadFlip.hash,
          index: preparedFlip.index,
          error: 'deadline_guard',
          reasoning:
            'not enough session time remained to launch provider request',
          forcedDecisionReason: 'deadline_guard',
        }),
      })
      return
    }

    const taskId = nextStaggeredSolveTaskId
    nextStaggeredSolveTaskId += 1
    const promise = solvePreparedPayloadFlip(preparedFlip).then(
      (solvedEntry) => ({
        taskId,
        solvedEntry,
      })
    )
    activeStaggeredSolves.push({taskId, promise})
    nextStaggeredSolveLaunchAt = Date.now() + longSessionOpenAiStaggerIntervalMs
  }

  async function flushStaggeredSolves() {
    while (activeStaggeredSolves.length) {
      // eslint-disable-next-line no-await-in-loop
      await waitForNextStaggeredSolve()
    }
  }

  async function flushPreparedFlips({force = false} = {}) {
    if (!pendingPreparedFlips.length) {
      return
    }

    if (providerBudgetExceeded || !hasProviderDailyBudgetAvailable()) {
      providerBudgetExceeded = true
      pendingPreparedFlips.splice(0, pendingPreparedFlips.length)
      return
    }

    if (!force && pendingPreparedFlips.length < solveConcurrency) {
      return
    }

    const batchSize = force ? pendingPreparedFlips.length : solveConcurrency
    const batch = pendingPreparedFlips.splice(0, batchSize)
    const solvedEntries = await Promise.all(
      batch.map((preparedFlip, launchIndex) =>
        solvePreparedPayloadFlipWithLaunchDelay(preparedFlip, launchIndex)
      )
    )

    for (const solvedEntry of solvedEntries) {
      await applySolvedPayloadFlip(solvedEntry)
    }
  }

  async function buildPayloadFlip(flip) {
    const prepareCompositePayloads =
      effectiveProfile.flipVisionMode === 'composite'
    const leftImage = prepareCompositePayloads
      ? await composeFlipVariant({
          flip,
          variant: AnswerType.Left,
          ...frameRenderSize,
        })
      : null
    const rightImage = prepareCompositePayloads
      ? await composeFlipVariant({
          flip,
          variant: AnswerType.Right,
          ...frameRenderSize,
        })
      : null
    const leftFrames = prepareFramePayloads
      ? await composeFlipFrames({
          flip,
          variant: AnswerType.Left,
          ...frameRenderSize,
        })
      : []
    const rightFrames = prepareFramePayloads
      ? await composeFlipFrames({
          flip,
          variant: AnswerType.Right,
          ...frameRenderSize,
        })
      : []

    return {
      hash: flip.hash,
      leftImage,
      rightImage,
      leftFrames,
      rightFrames,
      words: Array.isArray(flip.words) ? flip.words : [],
      keywords: normalizeAnswerPhaseKeywords(flip.keywords || flip.words),
      expectedAnswer: flip.expectedAnswer || null,
      expectedStrength: flip.expectedStrength || null,
      consensusAnswer: flip.consensusAnswer || null,
      consensusStrength: flip.consensusStrength || null,
      consensusVotes: flip.consensusVotes || null,
      sourceDataset: flip.sourceDataset || null,
      sourceSplit: flip.sourceSplit || null,
      sourceStats: flip.sourceStats || null,
    }
  }

  async function buildCompositePayloadFlipFallback({sourceFlip, payloadFlip}) {
    const leftImage =
      payloadFlip.leftImage ||
      (await composeFlipVariant({
        flip: sourceFlip,
        variant: AnswerType.Left,
        ...frameRenderSize,
      }))
    const rightImage =
      payloadFlip.rightImage ||
      (await composeFlipVariant({
        flip: sourceFlip,
        variant: AnswerType.Right,
        ...frameRenderSize,
      }))

    return {
      ...payloadFlip,
      leftImage,
      rightImage,
    }
  }

  function hasCompletePreparedImages(payloadFlip) {
    const needsComposite = effectiveProfile.flipVisionMode === 'composite'
    const hasComposite =
      !needsComposite || (payloadFlip.leftImage && payloadFlip.rightImage)
    const hasFrames =
      !prepareFramePayloads ||
      (Array.isArray(payloadFlip.leftFrames) &&
        payloadFlip.leftFrames.length > 0 &&
        Array.isArray(payloadFlip.rightFrames) &&
        payloadFlip.rightFrames.length > 0)

    return Boolean(hasComposite && hasFrames)
  }

  async function buildPayloadFlipWithImageWait({flip}) {
    let lastError = null
    const imageRetryWaitMs = getImagePayloadPrepRetryWaitMs()

    for (
      let attempt = 1;
      attempt <= IMAGE_PAYLOAD_PREP_MAX_ATTEMPTS;
      attempt += 1
    ) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const payloadFlip = await buildPayloadFlip(flip)
        if (!hasCompletePreparedImages(payloadFlip)) {
          throw new Error(`Flip ${flip.hash} has incomplete decoded images`)
        }
        return payloadFlip
      } catch (error) {
        lastError = error

        if (
          attempt >= IMAGE_PAYLOAD_PREP_MAX_ATTEMPTS ||
          !hasRuntimeRemaining(
            sessionDeadlineAt,
            sessionSolveGuardMs +
              MIN_PROVIDER_REQUEST_TIMEOUT_MS +
              imageRetryWaitMs
          )
        ) {
          break
        }

        // eslint-disable-next-line no-await-in-loop
        await sleep(imageRetryWaitMs)
      }
    }

    throw lastError || new Error(`Flip ${flip.hash} image payload unavailable`)
  }

  let candidateIndex = 0
  for (; candidateIndex < candidateFlips.length; candidateIndex += 1) {
    if (providerBudgetExceeded || !hasProviderDailyBudgetAvailable()) {
      providerBudgetExceeded = true
      break
    }

    if (
      !hasRuntimeRemaining(sessionDeadlineAt, sessionSolveGuardMs) ||
      Date.now() >= buildDeadlineAt
    ) {
      break
    }

    const flip = candidateFlips[candidateIndex]
    if (
      !hasRuntimeRemaining(
        sessionDeadlineAt,
        sessionSolveGuardMs + MIN_PROVIDER_REQUEST_TIMEOUT_MS
      )
    ) {
      break
    }

    let payloadFlip

    try {
      payloadFlip = await buildPayloadFlipWithImageWait({flip})
    } catch (error) {
      await applyForcedRandomFlipDecision({
        flip,
        index: candidateIndex,
        error: `image_prepare_failed: ${formatSolveError(error)}`,
        reasoning: 'image payload preparation failed',
        forcedDecisionReason: 'image_prepare_failed',
      })

      // Move on; one broken or expired blob URL must not leave the flip unvoted.
      // eslint-disable-next-line no-continue
      continue
    }

    if (onProgress) {
      onProgress({
        stage: 'prepared',
        sessionType,
        index: candidateIndex + 1,
        total: totalFlips,
        hash: flip.hash,
        leftImage: payloadFlip.leftImage,
        rightImage: payloadFlip.rightImage,
        leftFrames: payloadFlip.leftFrames,
        rightFrames: payloadFlip.rightFrames,
        words: payloadFlip.words,
        expectedAnswer: payloadFlip.expectedAnswer,
        expectedStrength: payloadFlip.expectedStrength,
        consensusAnswer: payloadFlip.consensusAnswer,
        consensusStrength: payloadFlip.consensusStrength,
        consensusVotes: payloadFlip.consensusVotes,
        sourceDataset: payloadFlip.sourceDataset,
        sourceSplit: payloadFlip.sourceSplit,
        sourceStats: payloadFlip.sourceStats,
      })
    }

    if (useLongSessionOpenAiStaggeredSolving) {
      await launchStaggeredPreparedFlip({
        payloadFlip,
        sourceFlip: flip,
        index: candidateIndex,
      })
    } else {
      pendingPreparedFlips.push({
        payloadFlip,
        sourceFlip: flip,
        index: candidateIndex,
      })
      await flushPreparedFlips()
    }
  }

  for (
    let remainingIndex = candidateIndex;
    !providerBudgetExceeded && remainingIndex < candidateFlips.length;
    remainingIndex += 1
  ) {
    const flip = candidateFlips[remainingIndex]
    // eslint-disable-next-line no-await-in-loop
    await applyForcedRandomFlipDecision({
      flip,
      index: remainingIndex,
      error: 'deadline_guard',
      reasoning: 'not enough session time remained to request AI solving',
      forcedDecisionReason: 'deadline_guard',
    })
  }

  if (useLongSessionOpenAiStaggeredSolving) {
    await flushStaggeredSolves()
  } else {
    await flushPreparedFlips({force: true})
  }

  if (!results.length) {
    throw new Error('Unable to prepare flip image payload before deadline')
  }

  const answers = results
    .map((item) => ({
      hash: item.hash,
      option: toAnswerOption(item.answer),
      answer: item.answer,
      confidence: item.confidence,
      latencyMs: item.latencyMs,
      reasoning: item.reasoning,
      error: item.error,
      tokenUsage: normalizeTokenUsage(item.tokenUsage),
      costs: normalizeCostSummary(item.costs),
    }))
    .filter(({option}) => option > 0)

  const summary = summarizeResults(results, startedAt)
  const fastMode = summarizeFastMode(results)
  const modelFallback = summarizeModelFallbacks(results)
  if (onProgress) {
    onProgress({
      stage: 'completed',
      sessionType,
      summary,
      total: results.length,
      appliedAnswers: answers.length,
    })
  }

  return {
    provider,
    model,
    profile: effectiveProfile,
    summary,
    fastMode,
    modelFallback,
    providerBudgetExceeded,
    results,
    answers,
  }
}

export async function solveShortSessionWithAi({
  shortFlips = [],
  aiSolver = {},
  sessionMeta = null,
  onProgress,
  onDecision,
} = {}) {
  return solveValidationSessionWithAi({
    sessionType: 'short',
    shortFlips,
    aiSolver,
    sessionMeta,
    onProgress,
    onDecision,
  })
}
