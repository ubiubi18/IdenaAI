const {STRICT_PROFILE, CUSTOM_LIMITS} = require('./constants')

function clamp(value, [min, max]) {
  return Math.max(min, Math.min(max, value))
}

function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toFloat(value, fallback) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toBool(value, fallback) {
  if (typeof value === 'boolean') {
    return value
  }
  if (value == null) {
    return fallback
  }
  const normalized = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false
  }
  return fallback
}

function toShortText(value, fallback, maxLength = 2400) {
  if (typeof value !== 'string') {
    return fallback
  }
  return value.slice(0, maxLength).trim()
}

function normalizeVisionMode(value, fallback) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
  if (
    ['composite', 'frames_single_pass', 'frames_two_pass'].includes(normalized)
  ) {
    return normalized
  }
  return fallback
}

function hasOwnValue(source, key) {
  return Object.prototype.hasOwnProperty.call(source || {}, key)
}

function sanitizeStrictProfileOverrides(payload = {}) {
  const profile = {}

  if (hasOwnValue(payload, 'deadlineMs')) {
    profile.deadlineMs = clamp(
      toInt(payload.deadlineMs, STRICT_PROFILE.deadlineMs),
      CUSTOM_LIMITS.deadlineMs
    )
  }
  if (hasOwnValue(payload, 'requestTimeoutMs')) {
    profile.requestTimeoutMs = clamp(
      toInt(payload.requestTimeoutMs, STRICT_PROFILE.requestTimeoutMs),
      CUSTOM_LIMITS.requestTimeoutMs
    )
  }
  if (hasOwnValue(payload, 'maxConcurrency')) {
    profile.maxConcurrency = clamp(
      toInt(payload.maxConcurrency, STRICT_PROFILE.maxConcurrency),
      CUSTOM_LIMITS.maxConcurrency
    )
  }
  if (hasOwnValue(payload, 'maxRetries')) {
    profile.maxRetries = clamp(
      toInt(payload.maxRetries, STRICT_PROFILE.maxRetries),
      CUSTOM_LIMITS.maxRetries
    )
  }
  if (hasOwnValue(payload, 'maxOutputTokens')) {
    profile.maxOutputTokens = clamp(
      toInt(payload.maxOutputTokens, STRICT_PROFILE.maxOutputTokens),
      CUSTOM_LIMITS.maxOutputTokens
    )
  }
  if (hasOwnValue(payload, 'interFlipDelayMs')) {
    profile.interFlipDelayMs = clamp(
      toInt(payload.interFlipDelayMs, STRICT_PROFILE.interFlipDelayMs),
      CUSTOM_LIMITS.interFlipDelayMs
    )
  }
  if (hasOwnValue(payload, 'temperature')) {
    profile.temperature = clamp(
      toFloat(payload.temperature, STRICT_PROFILE.temperature),
      CUSTOM_LIMITS.temperature
    )
  }
  if (hasOwnValue(payload, 'forceDecision')) {
    profile.forceDecision = toBool(
      payload.forceDecision,
      STRICT_PROFILE.forceDecision
    )
  }
  if (hasOwnValue(payload, 'uncertaintyRepromptEnabled')) {
    profile.uncertaintyRepromptEnabled = toBool(
      payload.uncertaintyRepromptEnabled,
      STRICT_PROFILE.uncertaintyRepromptEnabled
    )
  }
  if (hasOwnValue(payload, 'uncertaintyConfidenceThreshold')) {
    profile.uncertaintyConfidenceThreshold = clamp(
      toFloat(
        payload.uncertaintyConfidenceThreshold,
        STRICT_PROFILE.uncertaintyConfidenceThreshold
      ),
      CUSTOM_LIMITS.uncertaintyConfidenceThreshold
    )
  }
  if (hasOwnValue(payload, 'uncertaintyRepromptMinRemainingMs')) {
    profile.uncertaintyRepromptMinRemainingMs = clamp(
      toInt(
        payload.uncertaintyRepromptMinRemainingMs,
        STRICT_PROFILE.uncertaintyRepromptMinRemainingMs
      ),
      CUSTOM_LIMITS.uncertaintyRepromptMinRemainingMs
    )
  }
  if (hasOwnValue(payload, 'uncertaintyRepromptInstruction')) {
    profile.uncertaintyRepromptInstruction = toShortText(
      payload.uncertaintyRepromptInstruction,
      STRICT_PROFILE.uncertaintyRepromptInstruction,
      600
    )
  }

  return profile
}

function sanitizeBenchmarkProfile(payload = {}) {
  if (payload.benchmarkProfile !== 'custom') {
    return {
      ...STRICT_PROFILE,
      ...sanitizeStrictProfileOverrides(payload),
      promptTemplateOverride: toShortText(
        payload.promptTemplateOverride,
        STRICT_PROFILE.promptTemplateOverride,
        6000
      ),
      flipVisionMode: normalizeVisionMode(
        payload.flipVisionMode,
        STRICT_PROFILE.flipVisionMode
      ),
    }
  }

  return {
    benchmarkProfile: 'custom',
    deadlineMs: clamp(
      toInt(payload.deadlineMs, STRICT_PROFILE.deadlineMs),
      CUSTOM_LIMITS.deadlineMs
    ),
    requestTimeoutMs: clamp(
      toInt(payload.requestTimeoutMs, STRICT_PROFILE.requestTimeoutMs),
      CUSTOM_LIMITS.requestTimeoutMs
    ),
    maxConcurrency: clamp(
      toInt(payload.maxConcurrency, STRICT_PROFILE.maxConcurrency),
      CUSTOM_LIMITS.maxConcurrency
    ),
    maxRetries: clamp(
      toInt(payload.maxRetries, STRICT_PROFILE.maxRetries),
      CUSTOM_LIMITS.maxRetries
    ),
    maxOutputTokens: clamp(
      toInt(payload.maxOutputTokens, STRICT_PROFILE.maxOutputTokens),
      CUSTOM_LIMITS.maxOutputTokens
    ),
    interFlipDelayMs: clamp(
      toInt(payload.interFlipDelayMs, 0),
      CUSTOM_LIMITS.interFlipDelayMs
    ),
    temperature: clamp(
      toFloat(payload.temperature, STRICT_PROFILE.temperature),
      CUSTOM_LIMITS.temperature
    ),
    forceDecision: toBool(payload.forceDecision, STRICT_PROFILE.forceDecision),
    uncertaintyRepromptEnabled: toBool(
      payload.uncertaintyRepromptEnabled,
      STRICT_PROFILE.uncertaintyRepromptEnabled
    ),
    uncertaintyConfidenceThreshold: clamp(
      toFloat(
        payload.uncertaintyConfidenceThreshold,
        STRICT_PROFILE.uncertaintyConfidenceThreshold
      ),
      CUSTOM_LIMITS.uncertaintyConfidenceThreshold
    ),
    uncertaintyRepromptMinRemainingMs: clamp(
      toInt(
        payload.uncertaintyRepromptMinRemainingMs,
        STRICT_PROFILE.uncertaintyRepromptMinRemainingMs
      ),
      CUSTOM_LIMITS.uncertaintyRepromptMinRemainingMs
    ),
    uncertaintyRepromptInstruction: toShortText(
      payload.uncertaintyRepromptInstruction,
      '',
      600
    ),
    promptTemplateOverride: toShortText(
      payload.promptTemplateOverride,
      '',
      6000
    ),
    flipVisionMode: normalizeVisionMode(
      payload.flipVisionMode,
      STRICT_PROFILE.flipVisionMode
    ),
  }
}

module.exports = {
  clamp,
  toInt,
  toFloat,
  toBool,
  toShortText,
  normalizeVisionMode,
  sanitizeBenchmarkProfile,
}
