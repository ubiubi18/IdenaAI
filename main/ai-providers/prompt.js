function renderPromptOverride(template, variables = {}) {
  let rendered = String(template || '')
  Object.entries(variables).forEach(([key, value]) => {
    const token = `{{${key}}}`
    rendered = rendered.split(token).join(String(value))
  })
  return rendered.trim()
}

function truncateText(value, maxLength = 12000) {
  const text = String(value || '').trim()
  if (!text) {
    return ''
  }
  return text.length <= maxLength ? text : text.slice(0, maxLength)
}

function normalizeVisionMode(value) {
  const mode = String(value || '')
    .trim()
    .toLowerCase()

  if (['composite', 'frames_single_pass', 'frames_two_pass'].includes(mode)) {
    return mode
  }
  return 'composite'
}

function normalizePromptPhase(value) {
  const phase = String(value || '')
    .trim()
    .toLowerCase()

  if (
    ['decision', 'frame_reasoning', 'decision_from_frame_reasoning'].includes(
      phase
    )
  ) {
    return phase
  }
  return 'decision'
}

function systemPromptTemplate() {
  return `
You are a careful visual reasoning judge for the Idena FLIP benchmark.
- Candidate labels such as left/right, option A/B, story 1/2, and first/second are arbitrary placeholders, never evidence.
- Judge only from visible chronology, cause -> effect links, consistent entities, and the final scene state.
- Do not anchor on the first shown candidate or the label wording.
- Return only the requested JSON and no extra prose.
`.trim()
}

function buildAllowedAnswers(forceDecision) {
  return forceDecision ? 'a|b' : 'a|b|skip'
}

function buildDecisionRules({forceDecision, secondPass, repromptRule}) {
  const allowedAnswers = buildAllowedAnswers(forceDecision)
  let uncertaintyRule =
    '- If the evidence is weak or conflicting, return "skip" instead of defaulting to the first shown side.'
  if (forceDecision) {
    uncertaintyRule =
      '- You must choose option A or B. If the evidence stays close, pick the better supported side, but never because it appeared first.'
  }

  let passRule =
    '- This is the first-pass decision. Compare both candidates from scratch before answering.'
  if (secondPass) {
    passRule =
      '- This is a second-pass uncertainty review. Re-check both sides from scratch and do not anchor on the first listed candidate or your earlier lean.'
  }

  return {
    allowedAnswers,
    uncertaintyRule,
    passRule,
    repromptRule: String(repromptRule || '').trim(),
  }
}

function buildAntiPositionRules() {
  return [
    '- LEFT/RIGHT names, OPTION A/B labels, STORY 1/2 labels, first-vs-second presentation, and candidate slot are arbitrary.',
    '- Candidate order is never evidence.',
    '- Compare story identity, visible chronology, and cause -> effect links, not slot position.',
    '- Never choose a side just because it was shown first.',
  ].join('\n')
}

function buildReportabilityRules() {
  return [
    '- Track report risk separately if solving clearly requires reading text, including visible watermarks, captions, labels, letters, numbers, arrows, or sequence markers.',
    '- Track report risk separately if inappropriate, NSFW, or graphic violent content is present.',
    '- Report risk is not evidence for OPTION A or OPTION B and must not by itself become "skip" during side solving.',
    '- Keep judging chronology, cause-effect, entity continuity, and final state even when report risk is present.',
  ].join('\n')
}

function buildAnswerPhaseKeywordRules() {
  return [
    '- This is the validation answer phase. Official keywords may be unavailable or arrive later; do not wait for them or treat them as required.',
    '- If official keywords are already present in session context, treat them as optional context only. They must not override the visible story.',
    '- Keywords are checked later only in the long-session report section, where report decisions may be reviewed separately.',
    '- During this answer phase, side choice depends on the visible four-panel story: chronology, cause-effect, entity continuity, and final state.',
  ].join('\n')
}

function normalizeOptionalAnswerPhaseKeywords(keywords = []) {
  if (!Array.isArray(keywords)) {
    return []
  }

  return keywords
    .map((item, index) => {
      if (item && typeof item === 'object') {
        const name = String(item.name || item.keyword || '').trim()
        const desc = String(item.desc || item.description || '').trim()
        if (!name && !desc) {
          return null
        }
        return `${index + 1}. ${name || `keyword-${index + 1}`}${
          desc ? ` - ${desc}` : ''
        }`
      }

      const keywordName = String(item || '').trim()
      return keywordName ? `${index + 1}. ${keywordName}` : null
    })
    .filter(Boolean)
    .slice(0, 2)
}

function buildOptionalAnswerPhaseKeywordContext(keywords = []) {
  const keywordLines = normalizeOptionalAnswerPhaseKeywords(keywords)
  if (!keywordLines.length) {
    return ''
  }

  return [
    'Optional official keyword context already available for this flip:',
    ...keywordLines,
    'Use this only as non-blocking context. Do not wait for missing keywords, and do not let keywords override visual chronology, cause-effect, entity continuity, or final state.',
  ].join('\n')
}

function buildCompositePrompt({
  hash,
  allowedAnswers,
  uncertaintyRule,
  passRule,
  repromptRule,
  keywords,
}) {
  const reportabilityRules = buildReportabilityRules()
  const antiPositionRules = buildAntiPositionRules()
  const answerPhaseKeywordRules = buildAnswerPhaseKeywordRules()
  const optionalKeywordContext =
    buildOptionalAnswerPhaseKeywordContext(keywords)
  const mustChoose = allowedAnswers === 'a|b'
  return `
You are solving an Idena validation answer-phase flip.
You are given two candidate 2x2 composite images:
- The first attached image is OPTION A
- The second attached image is OPTION B

Each candidate image contains four panels:
- Panel 1 = top-left
- Panel 2 = top-right
- Panel 3 = bottom-left
- Panel 4 = bottom-right
${optionalKeywordContext ? `\n${optionalKeywordContext}` : ''}

Task:
1) Inspect each panel separately and identify the main actors, actions, and visible state.
2) If any readable text appears, transcribe it and translate it to English if needed.
3) Mentally simulate OPTION A and OPTION B as chronological stories.
4) Choose the story with the clearest causal chain and consistent entity progression.
5) Return JSON only.

Allowed JSON schema:
{"answer":"a|b|skip","confidence":0.0,"reasoning":"short optional note"}

Rules:
- Use only ${allowedAnswers} for "answer"
- "confidence" must be between 0 and 1
${antiPositionRules}
${answerPhaseKeywordRules}
- Keep reasoning concise and factual, and mention one concrete visual cue when possible.
${reportabilityRules}
${
  mustChoose
    ? '- In forced answer mode, report risk lowers confidence but must not become "skip". Choose the more coherent side for the answer session.'
    : ''
}
${uncertaintyRule}
${passRule}
${repromptRule ? `- Extra instruction: ${repromptRule}` : ''}

Flip hash: ${hash}
`.trim()
}

function buildFramesSinglePassPrompt({
  hash,
  allowedAnswers,
  uncertaintyRule,
  passRule,
  repromptRule,
  keywords,
}) {
  const reportabilityRules = buildReportabilityRules()
  const antiPositionRules = buildAntiPositionRules()
  const answerPhaseKeywordRules = buildAnswerPhaseKeywordRules()
  const optionalKeywordContext =
    buildOptionalAnswerPhaseKeywordContext(keywords)
  const mustChoose = allowedAnswers === 'a|b'
  return `
You are solving an Idena validation answer-phase flip.
You are given 8 ordered frame images:
- Images 1-4 belong to OPTION A (in temporal order)
- Images 5-8 belong to OPTION B (in temporal order)
${optionalKeywordContext ? `\n${optionalKeywordContext}` : ''}

Task:
1) Inspect each frame separately and identify actors, actions, and visible state changes.
2) If any readable text appears, transcribe it and translate it to English if needed.
3) Build one short story summary for OPTION A and one short story summary for OPTION B.
4) Compare coherence using common-sense chronology and visible cause -> effect links.
5) Choose the most meaningful story.
6) Return JSON only.

Allowed JSON schema:
{"answer":"a|b|skip","confidence":0.0,"reasoning":"short optional note"}

Rules:
- Use only ${allowedAnswers} for "answer"
- "confidence" must be between 0 and 1
- Keep reasoning concise and factual, and mention one concrete visual cue when possible.
${antiPositionRules}
${answerPhaseKeywordRules}
${reportabilityRules}
${
  mustChoose
    ? '- In forced answer mode, report risk lowers confidence but must not become "skip". Choose the more coherent side for the answer session.'
    : ''
}
${uncertaintyRule}
${passRule}
${repromptRule ? `- Extra instruction: ${repromptRule}` : ''}

Flip hash: ${hash}
`.trim()
}

function buildFramesReasoningPrompt({hash, keywords}) {
  const antiPositionRules = buildAntiPositionRules()
  const answerPhaseKeywordRules = buildAnswerPhaseKeywordRules()
  const optionalKeywordContext =
    buildOptionalAnswerPhaseKeywordContext(keywords)
  return `
You are solving an Idena validation answer-phase flip in analysis mode.
You are given 8 ordered frame images:
- Images 1-4 belong to OPTION A (in temporal order)
- Images 5-8 belong to OPTION B (in temporal order)
${optionalKeywordContext ? `\n${optionalKeywordContext}` : ''}

Task:
1) For each frame, write one short factual caption.
2) Extract any readable text from each frame and translate it to English if needed.
3) Build one concise story summary for OPTION A and OPTION B.
4) Estimate one coherence score from 0 to 100 for OPTION A and OPTION B.
5) Flag report risk separately if the flip may be report-worthy, but keep scoring both stories.
6) Return JSON only.

Allowed JSON schema:
{
  "optionAFrames":[
    {"caption":"...", "text":"...", "translation":"..."},
    {"caption":"...", "text":"...", "translation":"..."},
    {"caption":"...", "text":"...", "translation":"..."},
    {"caption":"...", "text":"...", "translation":"..."}
  ],
  "optionBFrames":[
    {"caption":"...", "text":"...", "translation":"..."},
    {"caption":"...", "text":"...", "translation":"..."},
    {"caption":"...", "text":"...", "translation":"..."},
    {"caption":"...", "text":"...", "translation":"..."}
  ],
  "optionAStory":"...",
  "optionBStory":"...",
  "coherenceA":0,
  "coherenceB":0,
  "reportRisk": false,
  "reportReason":""
}

Rules:
- Keep each frame caption short and factual
- Use "" for text and translation when no readable text exists
- Keep story summaries concise
- coherence scores must be integers between 0 and 100
- Evaluate OPTION A and OPTION B independently before comparing them
- Do not let the first listed side inherit a higher coherence score by default
- Set reportRisk=true if reading text is required to solve the flip, including watermarks, labels, or captions
- Set reportRisk=true if visible order labels, numbers, letters, arrows, captions, or sequence markers appear on the images
- Set reportRisk=true if the flip contains inappropriate, NSFW, or graphic violent content
- A watermark, text overlay, order marker, or reportRisk flag is not a side decision and must not reduce coherence scores by itself
${antiPositionRules}
${answerPhaseKeywordRules}

Flip hash: ${hash}
`.trim()
}

function buildFramesDecisionPrompt({
  hash,
  frameReasoning,
  allowedAnswers,
  uncertaintyRule,
  passRule,
  repromptRule,
  keywords,
}) {
  const reportabilityRules = buildReportabilityRules()
  const antiPositionRules = buildAntiPositionRules()
  const answerPhaseKeywordRules = buildAnswerPhaseKeywordRules()
  const optionalKeywordContext =
    buildOptionalAnswerPhaseKeywordContext(keywords)
  return `
You are solving an Idena validation answer-phase flip.
You are given pre-analysis JSON for OPTION A and OPTION B story frames.
${optionalKeywordContext ? `\n${optionalKeywordContext}` : ''}

Task:
1) Read the captions, extracted text, translations, story summaries, coherence scores, and report flags.
2) Treat reportRisk as a separate report-section signal, not as an answer.
3) Choose the story with the better coherence and clearer causal chain.
4) Prefer skip only when both stories are similarly weak or ambiguous and skip is allowed.
5) Return JSON only.

Allowed JSON schema:
{"answer":"a|b|skip","confidence":0.0,"reasoning":"short optional note"}

Rules:
- Use only ${allowedAnswers} for "answer"
- "confidence" must be between 0 and 1
- Do not return skip solely because reportRisk is true, a watermark/text overlay exists, or the flip may be reported later.
- Keep reasoning concise and factual, and cite one key visual coherence cue
${antiPositionRules}
${answerPhaseKeywordRules}
${reportabilityRules}
${uncertaintyRule}
${passRule}
${repromptRule ? `- Extra instruction: ${repromptRule}` : ''}

Flip hash: ${hash}

Pre-analysis JSON:
${truncateText(frameReasoning)}
`.trim()
}

function buildProbabilitySchemaText() {
  return `{
  "optionA": {
    "chronology_probability": 0.0,
    "cause_effect_probability": 0.0,
    "entity_continuity_probability": 0.0,
    "final_state_probability": 0.0,
    "overall_story_probability": 0.0,
    "main_strength": "short factual note",
    "main_weakness": "short factual note"
  },
  "optionB": {
    "chronology_probability": 0.0,
    "cause_effect_probability": 0.0,
    "entity_continuity_probability": 0.0,
    "final_state_probability": 0.0,
    "overall_story_probability": 0.0,
    "main_strength": "short factual note",
    "main_weakness": "short factual note"
  },
  "report_risk_probability": 0.0,
  "text_or_order_label_risk_probability": 0.0,
  "uncertainty_probability": 0.0
}`
}

function buildProbabilityTaskRules({
  runIndex,
  totalRuns,
  candidateOrder,
  probabilityPasses,
  previousProbabilityJson = '',
  keywords,
}) {
  const antiPositionRules = buildAntiPositionRules()
  const reportabilityRules = buildReportabilityRules()
  const answerPhaseKeywordRules = buildAnswerPhaseKeywordRules()
  const optionalKeywordContext =
    buildOptionalAnswerPhaseKeywordContext(keywords)
  const passes =
    Array.isArray(probabilityPasses) && probabilityPasses.length
      ? probabilityPasses
      : ['visual_observation', 'independent_scores', 'adversarial_recheck']
  const previousProbabilityNote = String(previousProbabilityJson || '').trim()
  return `
This flip is independent. Do not infer patterns from other flips in the session. Previous flips give no information about this flip.
This is probability ensemble run ${runIndex} of ${totalRuns}. Run marker: ${candidateOrder}. The marker is not visual evidence.
${optionalKeywordContext ? `\n${optionalKeywordContext}` : ''}
${
  previousProbabilityNote
    ? `
Previous probability estimate, mapped to this run's current OPTION A/B order:
${truncateText(previousProbabilityNote, 2400)}

Audit instruction:
- Treat the previous estimate as a hypothesis to challenge, not as evidence.
- Look for the strongest visual reason its scores could be wrong or overconfident.
- Recompute the final probabilities from the images after the audit.`
    : ''
}

Task:
1) Use these internal passes in order: ${passes.join(', ')}.
2) visual_observation: describe each candidate and visible state changes internally; make no decision.
3) independent_scores: estimate OPTION A and OPTION B independently as coherent four-panel visual stories.
4) adversarial_recheck: note the strongest weakness for each option, then revise probabilities.
5) Do not choose a side inside the model response.
6) Return JSON only using the schema below.

Probability rules:
- All probabilities must be numbers from 0 to 1.
- Do not output 1.0 unless the visual sequence is essentially unambiguous.
- Do not output 0.0 unless the side is clearly impossible.
- Similar weak stories should both receive middling probabilities.
- A side can score high only if panel order, cause-effect, entity continuity, and final state are all plausible.
- Candidate labels A/B, left/right, first/second are arbitrary placeholders.
- Judge only chronology, cause-effect, entity continuity, and final state.
- Report/text/order-label risks are separate risk probabilities; they must not suppress chronology, cause-effect, entity-continuity, or final-state scores.
- Watermarks or text overlays should still receive side probability scores. Reporting is handled later in the report section.
${antiPositionRules}
${answerPhaseKeywordRules}
${reportabilityRules}
`.trim()
}

function buildCompositeProbabilityPrompt({
  hash,
  runIndex,
  totalRuns,
  candidateOrder,
  probabilityPasses,
  previousProbabilityJson,
  keywords,
}) {
  return `
You are solving an Idena validation answer-phase flip with probability scoring.
You are given two candidate 2x2 composite images:
- The first attached image is OPTION A
- The second attached image is OPTION B

Each candidate image contains four panels:
- Panel 1 = top-left
- Panel 2 = top-right
- Panel 3 = bottom-left
- Panel 4 = bottom-right

${buildProbabilityTaskRules({
  runIndex,
  totalRuns,
  candidateOrder,
  probabilityPasses,
  previousProbabilityJson,
  keywords,
})}

Allowed JSON schema:
${buildProbabilitySchemaText()}

Flip hash: ${hash}
`.trim()
}

function buildFramesProbabilityPrompt({
  hash,
  runIndex,
  totalRuns,
  candidateOrder,
  probabilityPasses,
  previousProbabilityJson,
  keywords,
}) {
  return `
You are solving an Idena validation answer-phase flip with probability scoring.
You are given 8 ordered frame images:
- Images 1-4 belong to OPTION A in temporal order
- Images 5-8 belong to OPTION B in temporal order

${buildProbabilityTaskRules({
  runIndex,
  totalRuns,
  candidateOrder,
  probabilityPasses,
  previousProbabilityJson,
  keywords,
})}

Allowed JSON schema:
${buildProbabilitySchemaText()}

Flip hash: ${hash}
`.trim()
}

function probabilityPromptTemplate({
  hash,
  flipVisionMode = 'composite',
  runIndex = 1,
  totalRuns = 3,
  candidateOrder = 'normal',
  probabilityPasses = null,
  previousProbabilityJson = '',
  keywords,
}) {
  const mode = normalizeVisionMode(flipVisionMode)
  const normalizedRunIndex =
    Number.isFinite(Number(runIndex)) && Number(runIndex) > 0
      ? Number(runIndex)
      : 1
  const normalizedTotalRuns =
    Number.isFinite(Number(totalRuns)) && Number(totalRuns) > 0
      ? Number(totalRuns)
      : 3
  const normalizedCandidateOrder =
    String(candidateOrder || '').trim() || 'normal'

  if (mode === 'composite') {
    return buildCompositeProbabilityPrompt({
      hash,
      runIndex: normalizedRunIndex,
      totalRuns: normalizedTotalRuns,
      candidateOrder: normalizedCandidateOrder,
      probabilityPasses,
      previousProbabilityJson,
      keywords,
    })
  }

  return buildFramesProbabilityPrompt({
    hash,
    runIndex: normalizedRunIndex,
    totalRuns: normalizedTotalRuns,
    candidateOrder: normalizedCandidateOrder,
    probabilityPasses,
    previousProbabilityJson,
    keywords,
  })
}

function promptTemplate({
  hash,
  forceDecision = false,
  secondPass = false,
  promptTemplateOverride = '',
  uncertaintyRepromptInstruction = '',
  flipVisionMode = 'composite',
  promptPhase = 'decision',
  frameReasoning = '',
  keywords,
}) {
  const mode = normalizeVisionMode(flipVisionMode)
  const phase = normalizePromptPhase(promptPhase)
  const repromptRule = String(uncertaintyRepromptInstruction || '').trim()
  const customTemplate = String(promptTemplateOverride || '').trim()
  const {allowedAnswers, uncertaintyRule, passRule} = buildDecisionRules({
    forceDecision,
    secondPass,
    repromptRule,
  })

  if (customTemplate && phase === 'decision') {
    return renderPromptOverride(customTemplate, {
      hash,
      allowSkip: forceDecision ? 'false' : 'true',
      secondPass: secondPass ? 'true' : 'false',
      allowedAnswers,
      visionMode: mode,
      promptPhase: phase,
    })
  }

  if (phase === 'frame_reasoning') {
    return buildFramesReasoningPrompt({hash, keywords})
  }

  if (phase === 'decision_from_frame_reasoning') {
    return buildFramesDecisionPrompt({
      hash,
      frameReasoning,
      allowedAnswers,
      uncertaintyRule,
      passRule,
      repromptRule,
      keywords,
    })
  }

  if (mode === 'composite') {
    return buildCompositePrompt({
      hash,
      allowedAnswers,
      uncertaintyRule,
      passRule,
      repromptRule,
      keywords,
    })
  }

  return buildFramesSinglePassPrompt({
    hash,
    allowedAnswers,
    uncertaintyRule,
    passRule,
    repromptRule,
    keywords,
  })
}

module.exports = {
  probabilityPromptTemplate,
  systemPromptTemplate,
  promptTemplate,
}
