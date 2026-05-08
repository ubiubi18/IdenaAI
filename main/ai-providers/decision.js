function tryParseJson(value) {
  try {
    return JSON.parse(value)
  } catch (error) {
    return null
  }
}

function findJsonBlockEnd(text, startIndex) {
  const opening = text[startIndex]
  const openingToClosing = {
    '{': '}',
    '[': ']',
  }
  const firstClosing = openingToClosing[opening]
  if (!firstClosing) return -1

  const stack = [firstClosing]
  let inString = false
  let isEscaped = false

  for (let index = startIndex + 1; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (isEscaped) {
        isEscaped = false
      } else if (char === '\\') {
        isEscaped = true
      } else if (char === '"') {
        inString = false
      }
    } else if (char === '"') {
      inString = true
    } else if (char === '{') {
      stack.push('}')
    } else if (char === '[') {
      stack.push(']')
    } else if (char === '}' || char === ']') {
      if (!stack.length || stack[stack.length - 1] !== char) {
        return -1
      }
      stack.pop()
      if (!stack.length) {
        return index
      }
    }
  }

  return -1
}

function extractJsonBlock(rawText) {
  const text = String(rawText || '').trim()
  if (!text) {
    throw new Error('Empty provider response')
  }

  const direct = tryParseJson(text)
  if (direct !== null) {
    return direct
  }

  const fencedMatches = text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)
  for (const match of fencedMatches) {
    const candidate = String((match && match[1]) || '').trim()
    if (candidate) {
      const parsed = tryParseJson(candidate)
      if (parsed !== null) {
        return parsed
      }
    }
  }

  for (let start = 0; start < text.length; start += 1) {
    const char = text[start]
    if (char === '{' || char === '[') {
      const end = findJsonBlockEnd(text, start)
      if (end >= 0) {
        const candidate = text.slice(start, end + 1)
        const parsed = tryParseJson(candidate)
        if (parsed !== null) {
          return parsed
        }
      }
    }
  }

  throw new Error('Provider response does not contain JSON')
}

function normalizeAnswer(answer) {
  const value = String(answer || '')
    .trim()
    .toLowerCase()

  if (
    [
      'left',
      'l',
      '1',
      'a',
      'option a',
      'candidate a',
      'story 1',
      'order 1',
    ].includes(value)
  ) {
    return 'left'
  }

  if (
    [
      'right',
      'r',
      '2',
      'b',
      'option b',
      'candidate b',
      'story 2',
      'order 2',
    ].includes(value)
  ) {
    return 'right'
  }

  return 'skip'
}

function normalizeConfidence(confidence) {
  const value = Number(confidence)
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.min(1, value))
}

function normalizeDecision(parsed) {
  return {
    answer: normalizeAnswer(parsed && parsed.answer),
    confidence: normalizeConfidence(parsed && parsed.confidence),
    reasoning:
      typeof (parsed && parsed.reasoning) === 'string'
        ? parsed.reasoning.slice(0, 240)
        : undefined,
  }
}

function normalizeProbability(value) {
  return normalizeConfidence(value)
}

function stripControlCharacters(value) {
  return String(value || '')
    .split('')
    .map((char) => {
      const code = char.charCodeAt(0)
      return code < 32 || code === 127 ? ' ' : char
    })
    .join('')
}

function normalizeShortNote(value) {
  return typeof value === 'string'
    ? stripControlCharacters(value).slice(0, 180)
    : ''
}

function pickFirstDefined(source, keys) {
  if (!source || typeof source !== 'object') {
    return undefined
  }

  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      return source[key]
    }
  }

  return undefined
}

function normalizeProbabilityOption(value = {}) {
  const source = value && typeof value === 'object' ? value : {}

  return {
    chronology_probability: normalizeProbability(
      pickFirstDefined(source, ['chronology_probability', 'chronology'])
    ),
    cause_effect_probability: normalizeProbability(
      pickFirstDefined(source, [
        'cause_effect_probability',
        'causeEffectProbability',
        'cause_effect',
      ])
    ),
    entity_continuity_probability: normalizeProbability(
      pickFirstDefined(source, [
        'entity_continuity_probability',
        'entityContinuityProbability',
        'entity_continuity',
      ])
    ),
    final_state_probability: normalizeProbability(
      pickFirstDefined(source, [
        'final_state_probability',
        'finalStateProbability',
        'final_state',
      ])
    ),
    overall_story_probability: normalizeProbability(
      pickFirstDefined(source, [
        'overall_story_probability',
        'overallStoryProbability',
        'overall_story',
        'overall',
      ])
    ),
    main_strength: normalizeShortNote(
      pickFirstDefined(source, ['main_strength', 'mainStrength', 'strength'])
    ),
    main_weakness: normalizeShortNote(
      pickFirstDefined(source, ['main_weakness', 'mainWeakness', 'weakness'])
    ),
  }
}

function normalizeProbabilityJudgePayload(parsed = {}) {
  const source = parsed && typeof parsed === 'object' ? parsed : {}

  return {
    optionA: normalizeProbabilityOption(
      pickFirstDefined(source, ['optionA', 'option_a', 'a'])
    ),
    optionB: normalizeProbabilityOption(
      pickFirstDefined(source, ['optionB', 'option_b', 'b'])
    ),
    report_risk_probability: normalizeProbability(
      pickFirstDefined(source, [
        'report_risk_probability',
        'reportRiskProbability',
        'report_risk',
        'reportRisk',
      ])
    ),
    text_or_order_label_risk_probability: normalizeProbability(
      pickFirstDefined(source, [
        'text_or_order_label_risk_probability',
        'textOrOrderLabelRiskProbability',
        'text_or_label_risk',
        'textOrLabelRisk',
      ])
    ),
    uncertainty_probability: normalizeProbability(
      pickFirstDefined(source, [
        'uncertainty_probability',
        'uncertaintyProbability',
        'uncertainty',
      ])
    ),
  }
}

function hasFiniteProbability(source, keys) {
  const value = pickFirstDefined(source, keys)
  if (value == null || typeof value === 'boolean') {
    return false
  }
  if (typeof value === 'string' && !value.trim()) {
    return false
  }
  return Number.isFinite(Number(value))
}

function hasUsableProbabilityOption(value = {}) {
  const source = value && typeof value === 'object' ? value : {}

  return (
    hasFiniteProbability(source, ['chronology_probability', 'chronology']) &&
    hasFiniteProbability(source, [
      'cause_effect_probability',
      'causeEffectProbability',
      'cause_effect',
    ]) &&
    hasFiniteProbability(source, [
      'entity_continuity_probability',
      'entityContinuityProbability',
      'entity_continuity',
    ]) &&
    hasFiniteProbability(source, [
      'final_state_probability',
      'finalStateProbability',
      'final_state',
    ])
  )
}

function hasUsableProbabilityJudgePayload(parsed = {}) {
  const source = parsed && typeof parsed === 'object' ? parsed : {}
  return (
    hasUsableProbabilityOption(
      pickFirstDefined(source, ['optionA', 'option_a', 'a'])
    ) &&
    hasUsableProbabilityOption(
      pickFirstDefined(source, ['optionB', 'option_b', 'b'])
    )
  )
}

function computeProbabilitySideScore(option = {}) {
  const normalized = normalizeProbabilityOption(option)
  return (
    0.25 * normalized.chronology_probability +
    0.35 * normalized.cause_effect_probability +
    0.2 * normalized.entity_continuity_probability +
    0.2 * normalized.final_state_probability
  )
}

function mean(values) {
  const finiteValues = values.filter((value) => Number.isFinite(value))
  if (!finiteValues.length) {
    return 0
  }
  return (
    finiteValues.reduce((total, value) => total + value, 0) /
    finiteValues.length
  )
}

function hashScore(value) {
  const text = String(value || '')
  let score = 17
  for (let index = 0; index < text.length; index += 1) {
    score = (score * 131 + text.charCodeAt(index)) % 2147483647
  }
  return score
}

function chooseHigherProbabilitySide(avgLeft, avgRight, tieBreakerKey = '') {
  const delta = avgLeft - avgRight
  if (Math.abs(delta) > 1e-9) {
    return delta > 0 ? 'left' : 'right'
  }
  return hashScore(tieBreakerKey) % 2 === 0 ? 'left' : 'right'
}

function aggregateProbabilityEnsembleRuns(runs = [], options = {}) {
  const normalizedRuns = (Array.isArray(runs) ? runs : [])
    .map((run, index) => {
      const payload = normalizeProbabilityJudgePayload(
        run && typeof run === 'object' ? run.payload || run.parsed || run : null
      )
      const scoreA = computeProbabilitySideScore(payload.optionA)
      const scoreB = computeProbabilitySideScore(payload.optionB)
      const swapped = Boolean(run && run.swapped)
      return {
        runIndex:
          Number.isFinite(Number(run && run.runIndex)) &&
          Number(run && run.runIndex) > 0
            ? Number(run.runIndex)
            : index + 1,
        swapped,
        optionATo: swapped ? 'right' : 'left',
        optionBTo: swapped ? 'left' : 'right',
        scoreA,
        scoreB,
        leftScore: swapped ? scoreB : scoreA,
        rightScore: swapped ? scoreA : scoreB,
        reportRiskProbability: payload.report_risk_probability,
        textOrOrderLabelRiskProbability:
          payload.text_or_order_label_risk_probability,
        uncertaintyProbability: payload.uncertainty_probability,
        payload,
      }
    })
    .filter(
      (run) => Number.isFinite(run.leftScore) && Number.isFinite(run.rightScore)
    )

  if (!normalizedRuns.length) {
    return {
      answer: 'skip',
      confidence: 0,
      reasoning: 'probability ensemble had no valid runs',
      probabilities: {left: 0, right: 0, skip: 1},
      runs: [],
      runCount: 0,
      avgLeft: 0,
      avgRight: 0,
      delta: 0,
      skippedByRisk: false,
      skippedByDelta: true,
    }
  }

  const forceDecision = Boolean(options.forceDecision)
  const decisionDelta = normalizeConfidence(
    options.probabilityDecisionDelta == null
      ? 0.08
      : options.probabilityDecisionDelta
  )
  const avgLeft = mean(normalizedRuns.map((run) => run.leftScore))
  const avgRight = mean(normalizedRuns.map((run) => run.rightScore))
  const avgReportRisk = mean(
    normalizedRuns.map((run) => run.reportRiskProbability)
  )
  const avgTextOrOrderLabelRisk = mean(
    normalizedRuns.map((run) => run.textOrOrderLabelRiskProbability)
  )
  const avgUncertainty = mean(
    normalizedRuns.map((run) => run.uncertaintyProbability)
  )
  const delta = Math.abs(avgLeft - avgRight)
  const skippedByRisk = false
  const skippedByDelta = !forceDecision && delta < decisionDelta
  let answer = 'skip'

  if (!skippedByDelta) {
    answer = chooseHigherProbabilitySide(
      avgLeft,
      avgRight,
      options.tieBreakerKey
    )
  }

  const skipProbability =
    answer === 'skip' ? Math.max(avgUncertainty, 1 - delta) : avgUncertainty
  const confidence =
    answer === 'skip'
      ? normalizeConfidence(Math.min(0.95, Math.max(0.5, skipProbability)))
      : normalizeConfidence(Math.min(0.95, 0.5 + delta))
  let reasoningSuffix = ''
  if (skippedByDelta) {
    reasoningSuffix = '; skipped by low delta'
  }

  return {
    answer,
    confidence,
    reasoning: `probability ensemble avg left=${avgLeft.toFixed(
      3
    )} right=${avgRight.toFixed(3)} delta=${delta.toFixed(3)} over ${
      normalizedRuns.length
    } runs${reasoningSuffix}`,
    probabilities: {
      left: avgLeft,
      right: avgRight,
      skip: normalizeConfidence(skipProbability),
      reportRisk: avgReportRisk,
      textOrOrderLabelRisk: avgTextOrOrderLabelRisk,
    },
    runs: normalizedRuns,
    runCount: normalizedRuns.length,
    avgLeft,
    avgRight,
    delta,
    avgReportRisk,
    avgTextOrOrderLabelRisk,
    avgUncertainty,
    skippedByRisk,
    skippedByDelta,
  }
}

function stripDataUrl(dataUrl) {
  const value = String(dataUrl || '')
  const match = value.match(/^data:(.*?);base64,(.*)$/)
  if (!match) {
    throw new Error('Image payload must be a base64 data URL')
  }

  return {
    mimeType: match[1] || 'image/png',
    data: match[2],
  }
}

module.exports = {
  aggregateProbabilityEnsembleRuns,
  computeProbabilitySideScore,
  extractJsonBlock,
  normalizeAnswer,
  normalizeConfidence,
  normalizeDecision,
  normalizeProbabilityJudgePayload,
  hasUsableProbabilityJudgePayload,
  stripDataUrl,
}
