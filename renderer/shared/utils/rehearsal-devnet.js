export const REHEARSAL_NETWORK_NODE_COUNT = 10
export const REHEARSAL_NETWORK_BOOTSTRAP_NODE_COUNT = 1
export const REHEARSAL_NETWORK_VALIDATOR_COUNT = Math.max(
  0,
  REHEARSAL_NETWORK_NODE_COUNT - REHEARSAL_NETWORK_BOOTSTRAP_NODE_COUNT
)
export const REHEARSAL_NETWORK_LEAD_SECONDS = 8 * 60
export const REHEARSAL_NETWORK_SEED_FLIP_COUNT = 30
export const REHEARSAL_DEFAULT_SOLVER_PARTICIPANT_COUNT = 1
export const REHEARSAL_SHARED_NODE_PARTICIPANT_START_DELAY_MS = 500
export const REHEARSAL_PROBABILITY_PASSES = [
  'visual_observation',
  'independent_scores',
  'adversarial_recheck',
]

export function buildRehearsalNetworkPayload({connectApp = false} = {}) {
  return {
    nodeCount: REHEARSAL_NETWORK_NODE_COUNT,
    firstCeremonyLeadSeconds: REHEARSAL_NETWORK_LEAD_SECONDS,
    seedFlipCount: REHEARSAL_NETWORK_SEED_FLIP_COUNT,
    connectApp,
    connectCountdownSeconds: null,
  }
}

export function buildRehearsalLaneProviderConfig(aiSolver = {}) {
  if (aiSolver.provider !== 'openai-compatible') {
    return null
  }

  return {
    name: aiSolver.customProviderName,
    baseUrl: aiSolver.customProviderBaseUrl,
    chatPath: aiSolver.customProviderChatPath,
  }
}

export function buildRehearsalSolverLanePayload(
  aiSolver = {},
  {participantCount = REHEARSAL_DEFAULT_SOLVER_PARTICIPANT_COUNT} = {}
) {
  const provider = aiSolver.provider || 'openai'
  const laneCount = Math.max(
    1,
    Math.min(REHEARSAL_NETWORK_VALIDATOR_COUNT, Number(participantCount) || 1)
  )
  const probabilityRuns = Number.parseInt(aiSolver.probabilityRuns, 10)
  const probabilityDecisionDelta = Number.parseFloat(
    aiSolver.probabilityDecisionDelta
  )
  const probabilityReasoningEffort = String(
    aiSolver.probabilityReasoningEffort || ''
  )
    .trim()
    .toLowerCase()

  return {
    rehearsalOnly: true,
    mode:
      laneCount > 1
        ? 'shared-node-participant-rehearsal'
        : 'single-participant-rehearsal',
    laneCount,
    laneStartDelayMs:
      laneCount > 1 ? REHEARSAL_SHARED_NODE_PARTICIPANT_START_DELAY_MS : 0,
    provider,
    model: aiSolver.model || 'gpt-5.5',
    providerConfig: buildRehearsalLaneProviderConfig(aiSolver),
    ensembleEnabled: Boolean(aiSolver.ensembleEnabled),
    ensemblePrimaryWeight: aiSolver.ensemblePrimaryWeight,
    legacyHeuristicEnabled: Boolean(aiSolver.legacyHeuristicEnabled),
    legacyHeuristicWeight: aiSolver.legacyHeuristicWeight,
    legacyHeuristicOnly: Boolean(aiSolver.legacyHeuristicOnly),
    ensembleProvider2Enabled: Boolean(aiSolver.ensembleProvider2Enabled),
    ensembleProvider2: aiSolver.ensembleProvider2,
    ensembleModel2: aiSolver.ensembleModel2,
    ensembleProvider2Weight: aiSolver.ensembleProvider2Weight,
    ensembleProvider3Enabled: Boolean(aiSolver.ensembleProvider3Enabled),
    ensembleProvider3: aiSolver.ensembleProvider3,
    ensembleModel3: aiSolver.ensembleModel3,
    ensembleProvider3Weight: aiSolver.ensembleProvider3Weight,
    benchmarkProfile: 'custom',
    deadlineMs: 180 * 1000,
    requestTimeoutMs: Math.max(
      90 * 1000,
      Number(aiSolver.requestTimeoutMs) || 0
    ),
    maxConcurrency: 1,
    maxRetries: Number(aiSolver.maxRetries) || 1,
    maxOutputTokens: Number(aiSolver.maxOutputTokens) || 0,
    interFlipDelayMs: 0,
    temperature: Number(aiSolver.temperature) || 0,
    forceDecision: true,
    uncertaintyRepromptEnabled: true,
    uncertaintyConfidenceThreshold:
      Number(aiSolver.uncertaintyConfidenceThreshold) || 0.95,
    uncertaintyRepromptMinRemainingMs: 3000,
    flipVisionMode: 'composite',
    probabilityEnsembleEnabled: provider !== 'local-ai',
    probabilityRuns:
      Number.isInteger(probabilityRuns) && probabilityRuns > 0
        ? Math.max(1, Math.min(5, probabilityRuns))
        : 3,
    probabilityPasses: REHEARSAL_PROBABILITY_PASSES,
    probabilityDecisionDelta:
      Number.isFinite(probabilityDecisionDelta) && probabilityDecisionDelta >= 0
        ? Math.max(0, Math.min(0.5, probabilityDecisionDelta))
        : 0.08,
    probabilityUseSwappedOrder: aiSolver.probabilityUseSwappedOrder !== false,
    probabilityReasoningEffort: [
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
    ].includes(probabilityReasoningEffort)
      ? probabilityReasoningEffort
      : 'xhigh',
  }
}
