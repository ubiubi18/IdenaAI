const {extractJsonBlock} = require('./decision')

const REQUIRED_SEQUENCE_CHECKS = [
  'keyword_clarity',
  'story_alignment',
  'character_scene_continuity',
  'causal_progression',
  'premature_reveal',
  'state_regression',
  'panel_distinctness',
]

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  return fallback
}

function hasOwn(value, key) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      Object.prototype.hasOwnProperty.call(value, key)
  )
}

function normalizeStringList(value, limit = 12) {
  return Array.isArray(value)
    ? value
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
        .slice(0, limit)
    : []
}

function normalizePanelIndices(value) {
  return Array.from(
    new Set(
      (Array.isArray(value) ? value : [])
        .map((entry) => Number.parseInt(entry, 10))
        .filter((entry) => Number.isFinite(entry) && entry >= 1 && entry <= 4)
        .map((entry) => entry - 1)
    )
  ).sort((left, right) => left - right)
}

function isValidPanelIndexList(value) {
  if (!Array.isArray(value)) return false
  const normalized = value.map((entry) => Number(entry))
  return (
    normalized.every(
      (entry) => Number.isInteger(entry) && entry >= 1 && entry <= 4
    ) && new Set(normalized).size === normalized.length
  )
}

function normalizeShuffleCandidates(value) {
  return (Array.isArray(value) ? value : [])
    .map((candidate) =>
      (Array.isArray(candidate) ? candidate : [])
        .map((entry) => Number.parseInt(entry, 10))
        .filter((entry) => Number.isFinite(entry) && entry >= 0 && entry < 4)
    )
    .filter(
      (candidate) =>
        candidate.length === 4 && new Set(candidate).size === candidate.length
    )
    .slice(0, 8)
}

function createUnavailableSequenceAudit(reason = 'disabled') {
  return {
    invoked: false,
    complete: false,
    passed: false,
    verdict: 'unavailable',
    score: 0,
    failureReasons: [],
    repairPanelIndices: [],
    repairGuidanceByPanel: {},
    shouldReplan: false,
    safeShuffleCandidateIndex: null,
    safeShuffleOrder: null,
    checks: {},
    summary: '',
    error: String(reason || '').trim(),
  }
}

function buildRenderedStorySequenceAuditPrompt(context = {}) {
  const storyPanels = Array.isArray(context.storyPanels)
    ? context.storyPanels.slice(0, 4)
    : []
  const keywords = (Array.isArray(context.keywords) ? context.keywords : [])
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .slice(0, 2)
  const shuffleCandidates = normalizeShuffleCandidates(
    context.shuffleCandidates
  )
  const storyLines = storyPanels
    .map((panel, index) => `${index + 1}. ${String(panel || '').trim()}`)
    .join('\n')
  const shuffleLines = shuffleCandidates
    .map(
      (candidate, index) =>
        `Candidate ${index + 1}: ${candidate
          .map((panelIndex) => panelIndex + 1)
          .join(' -> ')}`
    )
    .join('\n')

  return [
    'You are the final safety auditor for one four-panel Idena flip.',
    'The four attached images are supplied in intended chronological order, panels 1 through 4.',
    'Audit the complete visual sequence, not each image in isolation.',
    'Return strict JSON only using this schema:',
    '{',
    '  "verdict": "accept|repair|replan",',
    '  "passed": true,',
    '  "score": 0,',
    '  "failure_reasons": [],',
    '  "repair_panel_indices": [],',
    '  "repair_guidance_by_panel": [{"panel": 1, "instruction": ""}],',
    '  "should_replan_story": false,',
    '  "safe_shuffle_candidate": 1,',
    '  "checks": {',
    '    "keyword_clarity": {"passed": true, "notes": ""},',
    '    "story_alignment": {"passed": true, "notes": ""},',
    '    "character_scene_continuity": {"passed": true, "notes": ""},',
    '    "causal_progression": {"passed": true, "notes": ""},',
    '    "premature_reveal": {"passed": true, "panel_indices": [], "notes": ""},',
    '    "state_regression": {"passed": true, "panel_indices": [], "notes": ""},',
    '    "panel_distinctness": {"passed": true, "notes": ""},',
    '    "shuffled_order": {"passed": true, "forms_meaningful_story": false, "notes": ""}',
    '  },',
    '  "summary": ""',
    '}',
    `Keywords: ${keywords.join(' / ') || '-'}`,
    `Planned story:\n${storyLines || '-'}`,
    shuffleLines
      ? `Candidate shuffled orders:\n${shuffleLines}`
      : 'Candidate shuffled orders: none supplied',
    'Required audit rules:',
    '- Both keywords must be unmistakably visible and materially involved in the story.',
    '- Every image must match its own planned panel rather than an earlier or later panel.',
    '- The same characters, clothing, location, camera logic, and important objects must remain consistent unless the plan explicitly changes them.',
    '- The sequence must have one clear initial state, trigger, consequence, and irreversible final aftermath.',
    '- Fail premature_reveal if an object, event, damage, reveal, or outcome planned for a later panel is already visible earlier.',
    '- Fail state_regression if a later image reverses an irreversible change, restores an earlier state, closes an opened object, repairs damage, or otherwise resets the story without the plan saying so.',
    '- Adjacent panels must show visibly distinct states, while still preserving continuity.',
    '- Evaluate every supplied shuffled candidate. safe_shuffle_candidate must identify the safest candidate that clearly cannot be read as a meaningful chronological story. Use 0 if none is safe.',
    '- Use verdict=accept only when all checks pass, score is at least 85, and a safe shuffled candidate exists.',
    '- Use verdict=repair only when one or two specific rendered panels can fix the problem without changing the story plan.',
    '- Use verdict=replan when the story itself is ambiguous, three or more panels fail, or no safe shuffled candidate exists.',
    '- repair_panel_indices and all panel numbers are one-based.',
  ].join('\n')
}

function normalizeCheck(value) {
  const item = value && typeof value === 'object' ? value : null
  if (!item) {
    return {present: false, passed: false, panelIndices: [], notes: ''}
  }
  return {
    present: true,
    passedPresent: hasOwn(item, 'passed'),
    passed: normalizeBoolean(item.passed, false),
    panelIndices: normalizePanelIndices(
      item.panel_indices || item.panelIndices
    ),
    notes: String(item.notes || item.reason || '').trim(),
    formsMeaningfulStory: normalizeBoolean(
      item.forms_meaningful_story ?? item.formsMeaningfulStory,
      false
    ),
    formsMeaningfulStoryPresent:
      hasOwn(item, 'forms_meaningful_story') ||
      hasOwn(item, 'formsMeaningfulStory'),
  }
}

function normalizeRepairGuidance(value) {
  const guidance = {}
  if (Array.isArray(value)) {
    value.forEach((entry) => {
      const panel = Number.parseInt(entry && entry.panel, 10)
      const instruction = String(
        (entry && (entry.instruction || entry.guidance)) || ''
      ).trim()
      if (panel >= 1 && panel <= 4 && instruction) {
        guidance[panel - 1] = instruction
      }
    })
    return guidance
  }

  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, instructionValue]) => {
      const panel = Number.parseInt(key, 10)
      const instruction = String(instructionValue || '').trim()
      if (panel >= 1 && panel <= 4 && instruction) {
        guidance[panel - 1] = instruction
      }
    })
  }
  return guidance
}

function parseRenderedStorySequenceAudit(rawText, context = {}) {
  const parsed = extractJsonBlock(rawText)
  if (!parsed || typeof parsed !== 'object') {
    return {
      ...createUnavailableSequenceAudit('invalid_sequence_audit_response'),
      invoked: true,
      verdict: 'replan',
      failureReasons: ['sequence_audit_invalid'],
      shouldReplan: true,
    }
  }

  const shuffleCandidates = normalizeShuffleCandidates(
    context.shuffleCandidates
  )
  const checksSource =
    parsed.checks && typeof parsed.checks === 'object' ? parsed.checks : {}
  const checks = REQUIRED_SEQUENCE_CHECKS.reduce((acc, checkName) => {
    acc[checkName] = normalizeCheck(checksSource[checkName])
    return acc
  }, {})
  const shuffledOrderCheck = normalizeCheck(
    checksSource.shuffled_order || checksSource.shuffledOrder
  )
  checks.shuffled_order = shuffledOrderCheck

  const requiredChecks = REQUIRED_SEQUENCE_CHECKS.map(
    (checkName) => checks[checkName]
  )
  if (shuffleCandidates.length > 0) {
    requiredChecks.push(shuffledOrderCheck)
  }

  const score = Math.max(0, Math.min(100, Number(parsed.score) || 0))
  const requestedVerdict = String(parsed.verdict || '')
    .trim()
    .toLowerCase()
  const rawSafeShuffleCandidate =
    parsed.safe_shuffle_candidate ?? parsed.safeShuffleCandidate
  const safeShuffleCandidate = Number(rawSafeShuffleCandidate)
  const safeShuffleCandidateIndex =
    Number.isInteger(safeShuffleCandidate) &&
    safeShuffleCandidate >= 1 &&
    safeShuffleCandidate <= shuffleCandidates.length
      ? safeShuffleCandidate - 1
      : null
  const missingChecks = requiredChecks.filter(
    (check) => !check.present || !check.passedPresent
  )
  const shuffledOrderFieldsMissing = Boolean(
    shuffleCandidates.length > 0 &&
      !shuffledOrderCheck.formsMeaningfulStoryPresent
  )
  const failedChecks = Object.entries(checks)
    .filter(([, check]) => check.present && !check.passed)
    .map(([name]) => name)
  const shuffledStoryIsMeaningful = Boolean(
    shuffledOrderCheck.formsMeaningfulStory
  )
  const failureReasonSource = parsed.failure_reasons || parsed.failureReasons
  const repairPanelSource =
    parsed.repair_panel_indices || parsed.repairPanelIndices
  const repairGuidanceSource =
    parsed.repair_guidance_by_panel || parsed.repairGuidanceByPanel
  const shouldReplanFieldPresent =
    hasOwn(parsed, 'should_replan_story') || hasOwn(parsed, 'shouldReplanStory')
  const passedFieldPresent = hasOwn(parsed, 'passed')
  const scoreFieldPresent =
    hasOwn(parsed, 'score') && Number.isFinite(Number(parsed.score))
  const repairPanelIndices = normalizePanelIndices(repairPanelSource)
  const repairGuidanceByPanel = normalizeRepairGuidance(repairGuidanceSource)
  const explicitShouldReplan = normalizeBoolean(
    parsed.should_replan_story ?? parsed.shouldReplanStory,
    false
  )
  const repairPanelIndicesValid = isValidPanelIndexList(repairPanelSource)
  const rawRepairPanelCount = Array.isArray(repairPanelSource)
    ? repairPanelSource.length
    : -1
  const repairGuidanceCoversPanels = repairPanelIndices.every((panelIndex) =>
    Boolean(String(repairGuidanceByPanel[panelIndex] || '').trim())
  )
  let verdictFieldsConsistent = false
  if (requestedVerdict === 'accept') {
    verdictFieldsConsistent =
      rawRepairPanelCount === 0 &&
      Object.keys(repairGuidanceByPanel).length === 0 &&
      !explicitShouldReplan
  } else if (requestedVerdict === 'repair') {
    verdictFieldsConsistent =
      repairPanelIndices.length >= 1 &&
      repairPanelIndices.length <= 2 &&
      repairGuidanceCoversPanels &&
      !explicitShouldReplan
  } else if (requestedVerdict === 'replan') {
    verdictFieldsConsistent = explicitShouldReplan
  }
  const topLevelFieldsComplete = Boolean(
    passedFieldPresent &&
      scoreFieldPresent &&
      Array.isArray(failureReasonSource) &&
      Array.isArray(repairPanelSource) &&
      repairPanelIndicesValid &&
      (Array.isArray(repairGuidanceSource) ||
        (repairGuidanceSource && typeof repairGuidanceSource === 'object')) &&
      shouldReplanFieldPresent &&
      verdictFieldsConsistent
  )
  const complete =
    missingChecks.length === 0 &&
    !shuffledOrderFieldsMissing &&
    topLevelFieldsComplete &&
    ['accept', 'repair', 'replan'].includes(requestedVerdict) &&
    (shuffleCandidates.length === 0 ||
      safeShuffleCandidateIndex !== null ||
      (safeShuffleCandidate === 0 && requestedVerdict !== 'accept'))

  const failureReasons = normalizeStringList(failureReasonSource)
  failedChecks.forEach((reason) => {
    if (!failureReasons.includes(reason)) failureReasons.push(reason)
  })
  if (
    missingChecks.length > 0 ||
    shuffledOrderFieldsMissing ||
    !topLevelFieldsComplete
  ) {
    failureReasons.push('sequence_audit_incomplete')
  }
  if (shuffledStoryIsMeaningful) {
    failureReasons.push('shuffled_story_ambiguity')
  }
  if (
    shuffleCandidates.length > 0 &&
    safeShuffleCandidateIndex === null &&
    !failureReasons.includes('no_safe_shuffle')
  ) {
    failureReasons.push('no_safe_shuffle')
  }

  const reportedPassed = normalizeBoolean(parsed.passed, false)
  const acceptResponseIsConsistent = Boolean(
    verdictFieldsConsistent &&
      safeShuffleCandidateIndex !== null &&
      failureReasons.length === 0
  )
  if (requestedVerdict === 'accept' && !acceptResponseIsConsistent) {
    failureReasons.push('sequence_audit_inconsistent')
  }
  const passed =
    complete &&
    requestedVerdict === 'accept' &&
    reportedPassed &&
    score >= 85 &&
    failedChecks.length === 0 &&
    !shuffledStoryIsMeaningful &&
    acceptResponseIsConsistent
  const shouldReplan =
    explicitShouldReplan ||
    requestedVerdict === 'replan' ||
    (requestedVerdict === 'accept' && !passed) ||
    !complete ||
    (!passed && repairPanelIndices.length === 0)

  return {
    invoked: true,
    complete,
    passed,
    verdict: passed ? 'accept' : requestedVerdict || 'replan',
    score,
    failureReasons: Array.from(new Set(failureReasons)),
    repairPanelIndices,
    repairGuidanceByPanel,
    shouldReplan,
    safeShuffleCandidateIndex,
    safeShuffleOrder:
      safeShuffleCandidateIndex === null
        ? null
        : shuffleCandidates[safeShuffleCandidateIndex],
    checks,
    summary: String(parsed.summary || '').trim(),
    error: '',
  }
}

module.exports = {
  REQUIRED_SEQUENCE_CHECKS,
  buildRenderedStorySequenceAuditPrompt,
  createUnavailableSequenceAudit,
  normalizeShuffleCandidates,
  parseRenderedStorySequenceAudit,
}
