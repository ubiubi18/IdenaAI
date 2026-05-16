import {loadPersistentStateValue, persistItem} from '../../shared/utils/persist'
import {AnswerType} from '../../shared/types'
import {buildValidationSessionScopeKey, filterRegularFlips} from './utils'

export const AI_DECISION_LEARNING_DATASET_VERSION = 1
export const AI_DECISION_LEARNING_STORAGE_KEY = 'ai-decision-learning-records'

const MAX_AI_DECISION_LEARNING_RECORDS = 1000
const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function normalizeHash(value) {
  const hash = String(value || '').trim()
  return hash && !UNSAFE_OBJECT_KEYS.has(hash) ? hash : ''
}

function normalizeRecordKey(value) {
  const key = normalizeShortText(value, 500)
  return key && !UNSAFE_OBJECT_KEYS.has(key) ? key : ''
}

function normalizeAnswer(value) {
  const next = String(value || '')
    .trim()
    .toLowerCase()

  if (['left', 'l', '1', 'a', 'option a'].includes(next)) {
    return 'left'
  }
  if (['right', 'r', '2', 'b', 'option b'].includes(next)) {
    return 'right'
  }
  if (
    [
      'skip',
      'reported',
      'report',
      'inappropriate',
      'irrelevant',
      String(AnswerType.Inappropriate),
    ].includes(next)
  ) {
    return 'skip'
  }

  return null
}

function answerFromOption(option) {
  switch (Number(option)) {
    case AnswerType.Left:
      return 'left'
    case AnswerType.Right:
      return 'right'
    case AnswerType.Inappropriate:
      return 'skip'
    default:
      return null
  }
}

function normalizeConfidence(value) {
  const next = Number(value)
  if (!Number.isFinite(next)) {
    return 0
  }
  return Math.max(0, Math.min(1, next))
}

function normalizeShortText(value, maxLength = 360) {
  return String(value || '')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function normalizeStringList(value, maxItems = 4, maxLength = 220) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => normalizeShortText(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems)
}

function normalizeEvidenceFrames(value) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => Number.parseInt(item, 10))
    .filter((item) => Number.isFinite(item) && item >= 1 && item <= 8)
    .slice(0, 8)
}

function normalizeHypotheses(value) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item, index) => {
      if (typeof item === 'string') {
        const textClaim = normalizeShortText(item, 220)
        return textClaim
          ? {
              id: `hypothesis_${index + 1}`,
              claim: textClaim,
              evidenceFrames: [],
            }
          : null
      }

      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return null
      }

      const claim = normalizeShortText(
        item.claim || item.text || item.summary,
        220
      )
      if (!claim) {
        return null
      }

      return {
        id:
          normalizeShortText(item.id || item.key || '', 60) ||
          `hypothesis_${index + 1}`,
        claim,
        evidenceFrames: normalizeEvidenceFrames(
          item.evidenceFrames || item.frames || item.evidence_frames
        ),
      }
    })
    .filter(Boolean)
    .slice(0, 4)
}

function normalizeConsensusVotes(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const left = Math.max(0, Number.parseInt(value.left ?? value.Left, 10) || 0)
  const right = Math.max(
    0,
    Number.parseInt(value.right ?? value.Right, 10) || 0
  )
  const reported = Math.max(
    0,
    Number.parseInt(
      value.reported ?? value.Reported ?? value.skip ?? value.inappropriate,
      10
    ) || 0
  )
  const total =
    Math.max(0, Number.parseInt(value.total, 10) || 0) ||
    left + right + reported

  return total > 0
    ? {
        left,
        right,
        reported,
        total,
      }
    : null
}

function normalizeWords(value) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((word) => {
      if (!word || typeof word !== 'object' || Array.isArray(word)) {
        return null
      }
      const name = normalizeShortText(word.name || word.keyword, 80)
      const desc = normalizeShortText(word.desc || word.description, 180)
      return name || desc ? {name, desc} : null
    })
    .filter(Boolean)
    .slice(0, 2)
}

function normalizeTokenUsage(value = {}) {
  const source = value && typeof value === 'object' ? value : {}
  const promptTokens = Math.max(0, Number(source.promptTokens) || 0)
  const completionTokens = Math.max(0, Number(source.completionTokens) || 0)
  const totalTokens = Math.max(
    0,
    Number(source.totalTokens) || promptTokens + completionTokens
  )

  return {
    promptTokens,
    completionTokens,
    totalTokens,
  }
}

function normalizeCostSummary(value = {}) {
  const source = value && typeof value === 'object' ? value : {}
  const estimatedUsd = Number(source.estimatedUsd)
  const actualUsd = Number(source.actualUsd)

  return {
    estimatedUsd:
      Number.isFinite(estimatedUsd) && estimatedUsd >= 0 ? estimatedUsd : null,
    actualUsd: Number.isFinite(actualUsd) && actualUsd >= 0 ? actualUsd : null,
  }
}

function normalizeProfile(value = {}) {
  const source = value && typeof value === 'object' ? value : {}

  return {
    benchmarkProfile: normalizeShortText(source.benchmarkProfile, 80),
    flipVisionMode: normalizeShortText(source.flipVisionMode, 80),
    forceDecision: source.forceDecision === true,
    uncertaintyRepromptEnabled: source.uncertaintyRepromptEnabled === true,
    probabilityEnsembleEnabled: source.probabilityEnsembleEnabled === true,
    requestTimeoutMs: Number.isFinite(Number(source.requestTimeoutMs))
      ? Number(source.requestTimeoutMs)
      : null,
    maxConcurrency: Number.isFinite(Number(source.maxConcurrency))
      ? Number(source.maxConcurrency)
      : null,
  }
}

function normalizeDecisionStructure(value = {}) {
  const source = value && typeof value === 'object' ? value : {}

  return {
    observations: normalizeStringList(source.observations),
    hypotheses: normalizeHypotheses(source.hypotheses),
    knownRisks: normalizeStringList(
      source.knownRisks || source.known_risks || source.risks
    ),
  }
}

function normalizeDecisionResult(value = {}) {
  const source = value && typeof value === 'object' ? value : {}
  const structure = normalizeDecisionStructure(source.decisionStructure)

  return {
    answer: normalizeAnswer(source.answer),
    rawAnswerBeforeRemap: normalizeAnswer(source.rawAnswerBeforeRemap),
    finalAnswerAfterRemap: normalizeAnswer(source.finalAnswerAfterRemap),
    confidence: normalizeConfidence(source.confidence),
    reasoning: normalizeShortText(source.reasoning, 700),
    observations: structure.observations,
    hypotheses: structure.hypotheses,
    knownRisks: structure.knownRisks,
    sideSwapped: source.sideSwapped === true,
    uncertaintyRepromptUsed: source.uncertaintyRepromptUsed === true,
    finalAdjudicationUsed: source.finalAdjudicationUsed === true,
    forcedDecision: source.forcedDecision === true,
    forcedDecisionPolicy: normalizeShortText(source.forcedDecisionPolicy, 80),
    forcedDecisionReason: normalizeShortText(source.forcedDecisionReason, 120),
    secondPassStrategy: normalizeShortText(source.secondPassStrategy, 120),
    flipVisionModeRequested: normalizeShortText(
      source.flipVisionModeRequested,
      80
    ),
    flipVisionModeApplied: normalizeShortText(source.flipVisionModeApplied, 80),
    error: normalizeShortText(source.error, 500),
    latencyMs: Number.isFinite(Number(source.latencyMs))
      ? Number(source.latencyMs)
      : null,
    tokenUsage: normalizeTokenUsage(source.tokenUsage),
    costs: normalizeCostSummary(source.costs),
  }
}

function hasChronologySignal(decision = {}) {
  const text = [
    decision.reasoning,
    ...(decision.observations || []),
    ...(decision.hypotheses || []).map((item) => item.claim),
  ]
    .join(' ')
    .toLowerCase()

  return /\b(chronolog|sequence|order|panel|frame|cause|effect|final|progress|then|before|after)\b/u.test(
    text
  )
}

function hasTextOrOrderRiskSignal(decision = {}) {
  const text = [
    decision.reasoning,
    ...(decision.knownRisks || []),
    ...(decision.observations || []),
  ]
    .join(' ')
    .toLowerCase()

  return /\b(ocr|text|caption|watermark|label|letter|number|arrow|readable|translate|translation)\b/u.test(
    text
  )
}

function buildDecisionChecks({decision, expectedAnswer}) {
  const checks = []
  const answer = decision.answer || decision.finalAnswerAfterRemap

  if (decision.error) {
    checks.push({
      id: 'provider_response',
      status: 'fail',
      note: decision.error,
    })
  } else {
    checks.push({
      id: 'provider_response',
      status: 'pass',
      note: 'provider returned a parseable decision',
    })
  }

  if (decision.forcedDecision) {
    checks.push({
      id: 'forced_decision',
      status: 'warn',
      note: decision.forcedDecisionPolicy
        ? `forced by ${decision.forcedDecisionPolicy}`
        : 'decision was forced',
    })
  }

  checks.push({
    id: 'chronology_evidence',
    status: hasChronologySignal(decision) ? 'pass' : 'warn',
    note: hasChronologySignal(decision)
      ? 'decision cited sequence, cause/effect, frames, or final state'
      : 'decision did not expose a clear chronology/cause-effect cue',
  })

  if (decision.sideSwapped) {
    checks.push({
      id: 'side_swap_remap',
      status:
        decision.rawAnswerBeforeRemap &&
        decision.finalAnswerAfterRemap &&
        decision.rawAnswerBeforeRemap !== decision.finalAnswerAfterRemap
          ? 'pass'
          : 'warn',
      note:
        decision.rawAnswerBeforeRemap &&
        decision.finalAnswerAfterRemap &&
        decision.rawAnswerBeforeRemap !== decision.finalAnswerAfterRemap
          ? 'swapped presentation was remapped back to the original side'
          : 'swapped presentation did not expose a remapped side decision',
    })
  }

  if (hasTextOrOrderRiskSignal(decision)) {
    checks.push({
      id: 'text_or_order_label_risk',
      status: 'warn',
      note: 'decision mentions text, OCR, watermark, label, number, arrow, or translation risk',
    })
  }

  if (expectedAnswer && answer && expectedAnswer !== answer) {
    checks.push({
      id: 'benchmark_answer_match',
      status: 'fail',
      note: `expected ${expectedAnswer}, got ${answer}`,
    })
  } else if (expectedAnswer && answer) {
    checks.push({
      id: 'benchmark_answer_match',
      status: 'pass',
      note: `matched expected ${expectedAnswer}`,
    })
  }

  if (
    expectedAnswer &&
    answer &&
    expectedAnswer !== answer &&
    decision.confidence >= 0.85
  ) {
    checks.push({
      id: 'confidence_sanity',
      status: 'fail',
      note: `wrong answer with ${Math.round(
        decision.confidence * 100
      )}% confidence`,
    })
  } else if (decision.confidence < 0.5) {
    checks.push({
      id: 'confidence_sanity',
      status: 'warn',
      note: `low confidence ${Math.round(decision.confidence * 100)}%`,
    })
  } else {
    checks.push({
      id: 'confidence_sanity',
      status: 'pass',
      note: `confidence ${Math.round(decision.confidence * 100)}%`,
    })
  }

  return checks
}

function classifyMismatch({decision, expectedAnswer}) {
  const answer = decision.answer || decision.finalAnswerAfterRemap
  if (!expectedAnswer) {
    return {
      status: 'unlabeled',
      mismatchType: '',
      failedHypothesis: '',
      lesson:
        'Decision was stored without a benchmark or consensus label; keep for later human or consensus comparison.',
    }
  }

  if (answer === expectedAnswer) {
    return {
      status: 'match',
      mismatchType: '',
      failedHypothesis: '',
      lesson:
        'Decision matched the available benchmark label; keep the evidence pattern as a positive example.',
    }
  }

  if (!answer) {
    return {
      status: 'mismatch',
      mismatchType: 'missing_answer',
      failedHypothesis: 'answer_available',
      lesson:
        'The solver produced no usable side decision; inspect provider parsing, image preparation, and timeout handling.',
    }
  }

  if (decision.error) {
    return {
      status: 'mismatch',
      mismatchType: 'provider_error_mismatch',
      failedHypothesis: 'provider_response',
      lesson:
        'The decision path failed before reliable visual reasoning; do not treat the answer as a model-quality signal.',
    }
  }

  if (decision.forcedDecisionPolicy === 'random') {
    return {
      status: 'mismatch',
      mismatchType: 'random_fallback_mismatch',
      failedHypothesis: 'forced_random_decision',
      lesson:
        'The fallback guessed after uncertainty or an error; spend future rehearsal budget on reducing the upstream skip/error.',
    }
  }

  if (decision.confidence >= 0.85) {
    return {
      status: 'mismatch',
      mismatchType: 'overconfident_wrong_answer',
      failedHypothesis: 'confidence_calibration',
      lesson:
        'The solver was overconfident on a wrong answer; lower trust unless the visual chronology is explicitly verified.',
    }
  }

  if (hasTextOrOrderRiskSignal(decision)) {
    return {
      status: 'mismatch',
      mismatchType: 'text_or_order_label_overtrust',
      failedHypothesis: 'text_or_label_is_side_evidence',
      lesson:
        'The answer may have over-weighted text, labels, arrows, watermarks, or OCR; keep report risk separate from side choice.',
    }
  }

  if (!hasChronologySignal(decision)) {
    return {
      status: 'mismatch',
      mismatchType: 'weak_chronology_evidence',
      failedHypothesis: 'chronology_match',
      lesson:
        'The answer lacked an explicit chronology or cause-effect cue; require visible sequence evidence before trusting similar cases.',
    }
  }

  if (answer === 'skip') {
    return {
      status: 'mismatch',
      mismatchType: 'uncertain_skip',
      failedHypothesis: 'answerability',
      lesson:
        'The solver skipped a labeled flip; use rehearsal review to identify the missing visual discriminator.',
    }
  }

  return {
    status: 'mismatch',
    mismatchType: 'visual_reasoning_mismatch',
    failedHypothesis: 'selected_story_coherence',
    lesson:
      'The selected story did not match the benchmark label; compare object continuity, chronology, and final state in human review.',
  }
}

function buildFlipIndex(flips = [], sessionType = 'short') {
  const source =
    sessionType === 'short' ? filterRegularFlips(flips || []) : flips || []

  return new Map(
    source
      .map((flip) => [normalizeHash(flip?.hash), flip])
      .filter(([hash]) => Boolean(hash))
  )
}

function buildRecordKey({scopeKey, sessionType, hash, provider, model}) {
  return [scopeKey || 'unknown-scope', sessionType || 'unknown-session', hash]
    .concat(provider ? [provider] : [])
    .concat(model ? [model] : [])
    .join(':')
}

export function buildValidationAiDecisionLearningRecords({
  scope = {},
  sessionType = 'short',
  provider = '',
  model = '',
  profile = {},
  results = [],
  flips = [],
  createdAt = new Date().toISOString(),
} = {}) {
  const normalizedSessionType =
    String(sessionType || '').toLowerCase() === 'long' ? 'long' : 'short'
  const scopeKey = buildValidationSessionScopeKey(scope)
  const flipIndex = buildFlipIndex(flips, normalizedSessionType)
  const normalizedProvider = normalizeShortText(provider, 120)
  const normalizedModel = normalizeShortText(model, 180)
  const normalizedProfile = normalizeProfile(profile)

  return (Array.isArray(results) ? results : [])
    .map((result) => {
      const hash = normalizeHash(result?.hash)
      if (!hash) {
        return null
      }

      const flip = flipIndex.get(hash) || {}
      const decision = normalizeDecisionResult(result)
      const expectedAnswer =
        normalizeAnswer(flip.expectedAnswer) ||
        normalizeAnswer(flip.consensusAnswer)
      const selectedAnswer = answerFromOption(flip.option) || decision.answer
      const checks = buildDecisionChecks({decision, expectedAnswer})
      const comparison = classifyMismatch({decision, expectedAnswer})
      const recordKey = buildRecordKey({
        scopeKey,
        sessionType: normalizedSessionType,
        hash,
        provider: normalizedProvider,
        model: normalizedModel,
      })

      return {
        version: AI_DECISION_LEARNING_DATASET_VERSION,
        recordKey,
        hash,
        scopeKey,
        epoch: Number.isFinite(Number(scope.epoch))
          ? Number(scope.epoch)
          : null,
        validationStart:
          typeof scope.validationStart === 'number'
            ? scope.validationStart
            : normalizeShortText(scope.validationStart, 80) || null,
        sessionType: normalizedSessionType,
        provider: normalizedProvider,
        model: normalizedModel,
        profile: normalizedProfile,
        selectedAnswer,
        expected: {
          answer: expectedAnswer,
          expectedStrength: normalizeShortText(flip.expectedStrength, 120),
          consensusAnswer: normalizeAnswer(flip.consensusAnswer),
          consensusStrength: normalizeShortText(flip.consensusStrength, 120),
          consensusVotes: normalizeConsensusVotes(flip.consensusVotes),
          words: normalizeWords(flip.words),
          sourceDataset: normalizeShortText(flip.sourceDataset, 120),
          sourceSplit: normalizeShortText(flip.sourceSplit, 120),
          hasBenchmarkLabel: Boolean(expectedAnswer),
        },
        decision,
        checks,
        comparison,
        createdAt,
      }
    })
    .filter(Boolean)
}

function normalizeCheck(value = {}) {
  const source = value && typeof value === 'object' ? value : {}
  const status = normalizeShortText(source.status, 20)

  return {
    id: normalizeShortText(source.id, 80),
    status: ['pass', 'warn', 'fail'].includes(status) ? status : 'warn',
    note: normalizeShortText(source.note, 500),
  }
}

function normalizeLearningRecord(value = {}) {
  const source = value && typeof value === 'object' ? value : {}
  const hash = normalizeHash(source.hash)
  const recordKey = normalizeRecordKey(source.recordKey)

  if (!hash || !recordKey) {
    return null
  }

  return {
    version: AI_DECISION_LEARNING_DATASET_VERSION,
    recordKey,
    hash,
    scopeKey: normalizeShortText(source.scopeKey, 500),
    epoch: Number.isFinite(Number(source.epoch)) ? Number(source.epoch) : null,
    validationStart:
      typeof source.validationStart === 'number'
        ? source.validationStart
        : normalizeShortText(source.validationStart, 80) || null,
    sessionType:
      String(source.sessionType || '').toLowerCase() === 'long'
        ? 'long'
        : 'short',
    provider: normalizeShortText(source.provider, 120),
    model: normalizeShortText(source.model, 180),
    profile: normalizeProfile(source.profile),
    selectedAnswer: normalizeAnswer(source.selectedAnswer),
    expected: {
      answer: normalizeAnswer(source.expected?.answer),
      expectedStrength: normalizeShortText(
        source.expected?.expectedStrength,
        120
      ),
      consensusAnswer: normalizeAnswer(source.expected?.consensusAnswer),
      consensusStrength: normalizeShortText(
        source.expected?.consensusStrength,
        120
      ),
      consensusVotes: normalizeConsensusVotes(source.expected?.consensusVotes),
      words: normalizeWords(source.expected?.words),
      sourceDataset: normalizeShortText(source.expected?.sourceDataset, 120),
      sourceSplit: normalizeShortText(source.expected?.sourceSplit, 120),
      hasBenchmarkLabel: source.expected?.hasBenchmarkLabel === true,
    },
    decision: normalizeDecisionResult(source.decision),
    checks: Array.isArray(source.checks)
      ? source.checks.map(normalizeCheck).filter((item) => item.id)
      : [],
    comparison: {
      status: ['match', 'mismatch', 'unlabeled'].includes(
        normalizeShortText(source.comparison?.status, 20)
      )
        ? normalizeShortText(source.comparison?.status, 20)
        : 'unlabeled',
      mismatchType: normalizeShortText(source.comparison?.mismatchType, 120),
      failedHypothesis: normalizeShortText(
        source.comparison?.failedHypothesis,
        120
      ),
      lesson: normalizeShortText(source.comparison?.lesson, 700),
    },
    createdAt: normalizeShortText(source.createdAt, 80),
  }
}

export function normalizeAiDecisionLearningDataset(value = {}) {
  const source =
    value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const recordsSource =
    source.recordsByKey &&
    typeof source.recordsByKey === 'object' &&
    !Array.isArray(source.recordsByKey)
      ? source.recordsByKey
      : {}
  const recordsByKey = Object.entries(recordsSource).reduce(
    (result, [key, record]) => {
      const normalizedKey = normalizeRecordKey(key)
      const normalizedRecord = normalizeLearningRecord({
        ...(record && typeof record === 'object' && !Array.isArray(record)
          ? record
          : {}),
        recordKey: normalizedKey,
      })

      if (normalizedKey && normalizedRecord) {
        result[normalizedKey] = normalizedRecord
      }

      return result
    },
    {}
  )

  return {
    version: AI_DECISION_LEARNING_DATASET_VERSION,
    updatedAt: normalizeShortText(source.updatedAt, 80) || null,
    recordsByKey,
  }
}

export function loadAiDecisionLearningDataset() {
  return normalizeAiDecisionLearningDataset(
    loadPersistentStateValue(
      'validationResults',
      AI_DECISION_LEARNING_STORAGE_KEY
    )
  )
}

export function persistAiDecisionLearningRecords(records = []) {
  const normalizedRecords = (Array.isArray(records) ? records : [])
    .map(normalizeLearningRecord)
    .filter(Boolean)

  if (!normalizedRecords.length) {
    return false
  }

  const currentDataset = loadAiDecisionLearningDataset()
  const recordsByKey = {
    ...(currentDataset.recordsByKey || {}),
  }

  normalizedRecords.forEach((record) => {
    recordsByKey[record.recordKey] = record
  })

  const boundedEntries = Object.entries(recordsByKey)
    .sort((left, right) =>
      String(right[1]?.createdAt || '').localeCompare(
        String(left[1]?.createdAt || '')
      )
    )
    .slice(0, MAX_AI_DECISION_LEARNING_RECORDS)

  persistItem(
    'validationResults',
    AI_DECISION_LEARNING_STORAGE_KEY,
    normalizeAiDecisionLearningDataset({
      updatedAt: new Date().toISOString(),
      recordsByKey: Object.fromEntries(boundedEntries),
    })
  )

  return true
}

export function computeAiDecisionLearningSummary(records = []) {
  const source = Array.isArray(records) ? records : []
  const total = source.length
  const labeled = source.filter(
    (record) => record?.expected?.hasBenchmarkLabel === true
  ).length
  const matches = source.filter(
    (record) => record?.comparison?.status === 'match'
  ).length
  const mismatches = source.filter(
    (record) => record?.comparison?.status === 'mismatch'
  ).length
  const unlabeled = source.filter(
    (record) => record?.comparison?.status === 'unlabeled'
  ).length
  const highRisk = source.filter((record) =>
    (record?.checks || []).some((check) => check.status === 'fail')
  ).length

  return {
    total,
    labeled,
    matches,
    mismatches,
    unlabeled,
    highRisk,
    accuracy: labeled > 0 ? matches / labeled : null,
  }
}
