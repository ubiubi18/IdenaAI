const {STRICT_PROFILE} = require('./constants')
const {sanitizeBenchmarkProfile} = require('./profile')

describe('sanitizeBenchmarkProfile', () => {
  it('returns strict defaults when benchmarkProfile is not custom', () => {
    expect(sanitizeBenchmarkProfile()).toStrictEqual(STRICT_PROFILE)
    expect(
      sanitizeBenchmarkProfile({benchmarkProfile: 'strict'})
    ).toStrictEqual(STRICT_PROFILE)
  })

  it('allows vision mode override while keeping strict defaults', () => {
    expect(
      sanitizeBenchmarkProfile({
        benchmarkProfile: 'strict',
        flipVisionMode: 'frames_single_pass',
      })
    ).toStrictEqual({
      ...STRICT_PROFILE,
      flipVisionMode: 'frames_single_pass',
    })
  })

  it('preserves prompt override in strict profile mode', () => {
    expect(
      sanitizeBenchmarkProfile({
        benchmarkProfile: 'strict',
        promptTemplateOverride: 'Custom solver prompt for {{hash}}',
      })
    ).toStrictEqual({
      ...STRICT_PROFILE,
      promptTemplateOverride: 'Custom solver prompt for {{hash}}',
    })
  })

  it('preserves explicit runtime overrides in strict profile mode', () => {
    expect(
      sanitizeBenchmarkProfile({
        benchmarkProfile: 'strict',
        deadlineMs: 95000,
        requestTimeoutMs: 45000,
        maxConcurrency: 6,
        maxRetries: 0,
        uncertaintyConfidenceThreshold: 0.68,
        uncertaintyRepromptMinRemainingMs: 35000,
      })
    ).toStrictEqual({
      ...STRICT_PROFILE,
      deadlineMs: 95000,
      requestTimeoutMs: 45000,
      maxConcurrency: 6,
      maxRetries: 0,
      uncertaintyConfidenceThreshold: 0.68,
      uncertaintyRepromptMinRemainingMs: 35000,
    })
  })

  it('clamps custom values to allowed limits', () => {
    expect(
      sanitizeBenchmarkProfile({
        benchmarkProfile: 'custom',
        deadlineMs: 999999,
        requestTimeoutMs: 5,
        maxConcurrency: 99,
        maxRetries: -1,
        maxOutputTokens: 1,
      })
    ).toStrictEqual({
      benchmarkProfile: 'custom',
      deadlineMs: 180000,
      requestTimeoutMs: 1000,
      maxConcurrency: 6,
      maxRetries: 0,
      maxOutputTokens: 1,
      interFlipDelayMs: 0,
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
    })
  })

  it('preserves probability ensemble overrides in strict profile mode', () => {
    expect(
      sanitizeBenchmarkProfile({
        benchmarkProfile: 'strict',
        probabilityEnsembleEnabled: true,
        probabilityRuns: 4,
        probabilityPasses: ['independent_scores', 'adversarial_recheck'],
        probabilityDecisionDelta: 0.12,
        probabilityUseSwappedOrder: false,
        probabilityReasoningEffort: 'high',
      })
    ).toStrictEqual({
      ...STRICT_PROFILE,
      probabilityEnsembleEnabled: true,
      probabilityRuns: 4,
      probabilityPasses: ['independent_scores', 'adversarial_recheck'],
      probabilityDecisionDelta: 0.12,
      probabilityUseSwappedOrder: false,
      probabilityReasoningEffort: 'high',
    })
  })

  it('preserves 0 maxOutputTokens as auto mode', () => {
    expect(
      sanitizeBenchmarkProfile({
        benchmarkProfile: 'custom',
        maxOutputTokens: 0,
      }).maxOutputTokens
    ).toBe(0)
  })

  it('normalizes custom flip vision mode values', () => {
    expect(
      sanitizeBenchmarkProfile({
        benchmarkProfile: 'custom',
        flipVisionMode: 'frames_two_pass',
      }).flipVisionMode
    ).toBe('frames_two_pass')

    expect(
      sanitizeBenchmarkProfile({
        benchmarkProfile: 'custom',
        flipVisionMode: 'unknown-mode',
      }).flipVisionMode
    ).toBe('composite')
  })
})
