const REQUIRED_STORY_COMPLIANCE = [
  'keyword_relevance',
  'no_text_needed',
  'no_order_labels',
  'no_inappropriate_content',
  'single_story_only',
  'no_waking_up_template',
  'no_thumbs_up_down',
  'no_enumeration_logic',
  'no_screen_or_page_keyword_cheat',
  'causal_clarity',
  'consensus_clarity',
  'age_12_clarity',
  'everyday_knowledge_only',
  'large_visual_cues',
  'simple_action_chain',
  'obvious_final_outcome',
]

const AUDITED_SHUFFLE_CANDIDATES = [
  [2, 0, 3, 1],
  [3, 1, 0, 2],
  [1, 3, 0, 2],
  [2, 3, 1, 0],
]

const REQUIRED_PANEL_AUDIT_LAYERS = [
  'ocr_text_check',
  'keyword_visibility_check',
  'alignment_check',
  'policy_risk_check',
]

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function isPlaceholderPanel(value) {
  const text = normalizeText(value)
  return (
    !text ||
    /^panel [1-4] continue (the )?story$/.test(text) ||
    /^panel [1-4] add a clear event in the story$/.test(text)
  )
}

function containsExactPhrase(text, phrase) {
  const normalizedText = normalizeText(text)
  const normalizedPhrase = normalizeText(phrase)
  return Boolean(
    normalizedPhrase && ` ${normalizedText} `.includes(` ${normalizedPhrase} `)
  )
}

function isPermutation(value) {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every(
      (entry) => Number.isInteger(entry) && entry >= 0 && entry < 4
    ) &&
    new Set(value).size === 4
  )
}

function isCompletePassingPanelAudit(value) {
  const audit = value && typeof value === 'object' ? value : {}
  return (
    audit.invoked === true &&
    audit.passed === true &&
    REQUIRED_PANEL_AUDIT_LAYERS.every((layerName) => {
      const layer =
        audit[layerName] && typeof audit[layerName] === 'object'
          ? audit[layerName]
          : null
      return Boolean(layer && layer.status === 'pass' && layer.passed === true)
    })
  )
}

function buildAuditedShuffleCandidates() {
  return AUDITED_SHUFFLE_CANDIDATES.map((candidate) => candidate.slice())
}

function evaluateAutoPublishStoryDraft({
  option = null,
  panels = [],
  keywords = [],
} = {}) {
  const storyOption = option && typeof option === 'object' ? option : {}
  const normalizedPanels = (Array.isArray(panels) ? panels : [])
    .slice(0, 4)
    .map((panel) => String(panel || '').trim())
  const normalizedKeywords = (Array.isArray(keywords) ? keywords : [])
    .map((keyword) => String(keyword || '').trim())
    .filter(Boolean)
    .slice(0, 2)
  const reasons = []

  if (
    normalizedPanels.length !== 4 ||
    normalizedPanels.some(isPlaceholderPanel)
  ) {
    reasons.push('story_requires_four_complete_panels')
  }

  const uniquePanels = new Set(
    normalizedPanels.map(normalizeText).filter(Boolean)
  )
  if (normalizedPanels.length === 4 && uniquePanels.size !== 4) {
    reasons.push('story_panels_are_not_distinct')
  }

  if (storyOption.isStoryboardStarter) reasons.push('storyboard_starter')
  if (storyOption.isWeakStoryDraft) reasons.push('weak_story_draft')
  if (/local fallback/i.test(String(storyOption.rationale || ''))) {
    reasons.push('local_fallback_story')
  }

  const compliance =
    storyOption.complianceReport &&
    typeof storyOption.complianceReport === 'object'
      ? storyOption.complianceReport
      : {}
  const missingCompliance = REQUIRED_STORY_COMPLIANCE.filter(
    (key) => compliance[key] !== 'pass'
  )
  if (missingCompliance.length > 0) {
    reasons.push(`story_compliance_failed:${missingCompliance.join(',')}`)
  }

  const failedComplianceKeys = Array.isArray(storyOption.failedComplianceKeys)
    ? storyOption.failedComplianceKeys.filter(Boolean)
    : []
  if (failedComplianceKeys.length > 0) {
    reasons.push(`story_compliance_failed:${failedComplianceKeys.join(',')}`)
  }

  const riskFlags = Array.isArray(storyOption.riskFlags)
    ? storyOption.riskFlags.filter(Boolean)
    : []
  if (riskFlags.length > 0) {
    reasons.push(`story_risk_flags:${riskFlags.join(',')}`)
  }

  const qualityScore = Number(storyOption.qualityScore)
  if (!Number.isFinite(qualityScore)) {
    reasons.push('story_quality_score_missing')
  } else if (qualityScore < 75) {
    reasons.push('story_quality_score_below_75')
  }

  const qualityFailures = Array.isArray(storyOption.qualityFailures)
    ? storyOption.qualityFailures.filter(Boolean)
    : []
  if (qualityFailures.length > 0) {
    reasons.push(`story_quality_failures:${qualityFailures.join(',')}`)
  }

  const combinedStory = normalizedPanels.join(' ')
  normalizedKeywords.forEach((keyword) => {
    if (!containsExactPhrase(combinedStory, keyword)) {
      reasons.push(`missing_exact_keyword:${keyword}`)
    }
  })
  if (normalizedKeywords.length !== 2) {
    reasons.push('story_requires_two_keywords')
  }

  return {
    passed: reasons.length === 0,
    reasons: Array.from(new Set(reasons)),
  }
}

function selectAuditedStoryCandidate({options = [], keywords = []} = {}) {
  const evaluated = (Array.isArray(options) ? options : []).map(
    (option, index) => {
      const panels = (
        Array.isArray(option && option.panels) ? option.panels : []
      )
        .slice(0, 4)
        .map((panel) => String(panel || '').trim())
      return {
        option,
        panels,
        index,
        audit: evaluateAutoPublishStoryDraft({option, panels, keywords}),
      }
    }
  )
  const [candidate] = evaluated
    .filter((item) => item.audit.passed)
    .sort((left, right) => {
      const scoreDifference =
        Number(right.option.qualityScore) - Number(left.option.qualityScore)
      return scoreDifference || left.index - right.index
    })

  if (candidate) {
    return {
      passed: true,
      reasons: [],
      option: candidate.option,
      panels: candidate.panels,
    }
  }

  const reasons = evaluated.flatMap((item) => item.audit.reasons)
  return {
    passed: false,
    reasons: Array.from(
      new Set(reasons.length > 0 ? reasons : ['no_compliant_story_candidate'])
    ),
    option: null,
    panels: [],
  }
}

function evaluateAutoPublishRender({response = null} = {}) {
  const result = response && typeof response === 'object' ? response : {}
  const audit =
    result.sequenceAudit && typeof result.sequenceAudit === 'object'
      ? result.sequenceAudit
      : null
  const feedback =
    result.renderFeedback && typeof result.renderFeedback === 'object'
      ? result.renderFeedback
      : null
  const validators = Array.isArray(result.validatorAuditByPanel)
    ? result.validatorAuditByPanel.slice(0, 4)
    : []
  const reasons = []

  if (result.ok !== true) reasons.push('panel_generation_failed')
  if (!Array.isArray(result.panels) || result.panels.length !== 4) {
    reasons.push('render_requires_four_panels')
  }
  if (result.includeNoise) reasons.push('post_audit_noise_not_allowed')
  if (!audit || !audit.invoked) reasons.push('sequence_audit_not_invoked')
  if (!audit || !audit.complete) reasons.push('sequence_audit_incomplete')
  if (!audit || !audit.passed || audit.verdict !== 'accept') {
    reasons.push('sequence_audit_rejected')
  }
  if (!audit || !isPermutation(audit.safeShuffleOrder)) {
    reasons.push('audited_shuffle_missing')
  }
  if (!feedback || feedback.verdict !== 'accept_rendered_story') {
    reasons.push('render_feedback_rejected')
  }
  if (
    validators.length !== 4 ||
    validators.some((item) => !isCompletePassingPanelAudit(item))
  ) {
    reasons.push('panel_audit_incomplete')
  }

  return {
    passed: reasons.length === 0,
    reasons: Array.from(new Set(reasons)),
    shuffleOrder:
      audit && isPermutation(audit.safeShuffleOrder)
        ? audit.safeShuffleOrder.slice()
        : null,
  }
}

module.exports = {
  buildAuditedShuffleCandidates,
  evaluateAutoPublishRender,
  evaluateAutoPublishStoryDraft,
  selectAuditedStoryCandidate,
}
