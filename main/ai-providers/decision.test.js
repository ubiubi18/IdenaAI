const {
  aggregateProbabilityEnsembleRuns,
  extractJsonBlock,
  normalizeAnswer,
  normalizeConfidence,
  normalizeDecision,
  hasUsableProbabilityJudgePayload,
  normalizeProbabilityJudgePayload,
  stripDataUrl,
} = require('./decision')

describe('decision helpers', () => {
  it('extracts JSON block from mixed provider response', () => {
    expect(
      extractJsonBlock('Here it is {"answer":"left","confidence":0.7}')
    ).toStrictEqual({
      answer: 'left',
      confidence: 0.7,
    })
  })

  it('extracts JSON from fenced code blocks', () => {
    expect(
      extractJsonBlock('```json\n{"answer":"right","confidence":0.4}\n```')
    ).toStrictEqual({
      answer: 'right',
      confidence: 0.4,
    })
  })

  it('extracts first valid nested JSON object from noisy text', () => {
    expect(
      extractJsonBlock(
        'prefix text {not valid json} and then {"stories":[{"panels":["a","b","c","d"]}]} suffix'
      )
    ).toStrictEqual({
      stories: [{panels: ['a', 'b', 'c', 'd']}],
    })
  })

  it('normalizes answer and confidence bounds', () => {
    expect(normalizeAnswer('R')).toBe('right')
    expect(normalizeAnswer('option a')).toBe('left')
    expect(normalizeAnswer('story 2')).toBe('right')
    expect(normalizeAnswer('unknown')).toBe('skip')
    expect(normalizeConfidence(2)).toBe(1)
    expect(normalizeConfidence(-1)).toBe(0)
  })

  it('normalizes decision payload and reasoning length', () => {
    const longReasoning = 'x'.repeat(500)
    const normalized = normalizeDecision({
      answer: 'l',
      confidence: 0.42,
      reasoning: longReasoning,
    })

    expect(normalized.answer).toBe('left')
    expect(normalized.confidence).toBe(0.42)
    expect(normalized.reasoning).toHaveLength(240)
  })

  it('clamps probability judge payload values to 0..1', () => {
    const normalized = normalizeProbabilityJudgePayload({
      optionA: {
        chronology_probability: 2,
        cause_effect_probability: -1,
        entity_continuity_probability: '0.7',
        final_state_probability: 'bad',
      },
      report_risk_probability: 4,
      text_or_order_label_risk_probability: -2,
      uncertainty_probability: 0.4,
    })

    expect(normalized.optionA.chronology_probability).toBe(1)
    expect(normalized.optionA.cause_effect_probability).toBe(0)
    expect(normalized.optionA.entity_continuity_probability).toBe(0.7)
    expect(normalized.optionA.final_state_probability).toBe(0)
    expect(normalized.report_risk_probability).toBe(1)
    expect(normalized.text_or_order_label_risk_probability).toBe(0)
    expect(normalized.uncertainty_probability).toBe(0.4)
  })

  it('rejects probability judge payloads missing required numeric fields', () => {
    expect(
      hasUsableProbabilityJudgePayload({
        optionA: {
          chronology_probability: 0.5,
          cause_effect_probability: 0.5,
          entity_continuity_probability: 0.5,
          final_state_probability: 0.5,
        },
        optionB: {
          chronology_probability: 0.4,
          cause_effect_probability: 0.4,
          entity_continuity_probability: 0.4,
          final_state_probability: 0.4,
        },
      })
    ).toBe(true)

    expect(
      hasUsableProbabilityJudgePayload({
        optionA: {
          chronology_probability: null,
          cause_effect_probability: 0.5,
          entity_continuity_probability: 0.5,
          final_state_probability: 0.5,
        },
        optionB: {
          chronology_probability: 0.4,
          cause_effect_probability: 0.4,
          entity_continuity_probability: 0.4,
          final_state_probability: 0.4,
        },
      })
    ).toBe(false)

    expect(
      hasUsableProbabilityJudgePayload({
        optionA: {
          chronology_probability: '0.5',
        },
        optionB: {
          chronology_probability: 0.4,
          cause_effect_probability: 0.4,
          entity_continuity_probability: 0.4,
          final_state_probability: 0.4,
        },
      })
    ).toBe(false)
  })

  it('aggregates probability runs to the higher side above threshold', () => {
    const result = aggregateProbabilityEnsembleRuns(
      [
        {
          payload: {
            optionA: {
              chronology_probability: 0.8,
              cause_effect_probability: 0.8,
              entity_continuity_probability: 0.8,
              final_state_probability: 0.8,
            },
            optionB: {
              chronology_probability: 0.45,
              cause_effect_probability: 0.45,
              entity_continuity_probability: 0.45,
              final_state_probability: 0.45,
            },
          },
        },
      ],
      {forceDecision: false, probabilityDecisionDelta: 0.08}
    )

    expect(result.answer).toBe('left')
    expect(result.confidence).toBeCloseTo(0.85)
    expect(result.probabilities.left).toBeCloseTo(0.8)
    expect(result.probabilities.right).toBeCloseTo(0.45)
  })

  it('tracks report risk without skipping a clear probability decision', () => {
    const result = aggregateProbabilityEnsembleRuns(
      [
        {
          payload: {
            optionA: {
              chronology_probability: 0.82,
              cause_effect_probability: 0.82,
              entity_continuity_probability: 0.82,
              final_state_probability: 0.82,
            },
            optionB: {
              chronology_probability: 0.44,
              cause_effect_probability: 0.44,
              entity_continuity_probability: 0.44,
              final_state_probability: 0.44,
            },
            report_risk_probability: 0.99,
            text_or_order_label_risk_probability: 0.98,
            uncertainty_probability: 0.2,
          },
        },
      ],
      {forceDecision: false, probabilityDecisionDelta: 0.08}
    )

    expect(result.answer).toBe('left')
    expect(result.skippedByRisk).toBe(false)
    expect(result.probabilities.left).toBeCloseTo(0.82)
    expect(result.probabilities.right).toBeCloseTo(0.44)
    expect(result.probabilities.skip).toBeCloseTo(0.2)
    expect(result.probabilities.reportRisk).toBeCloseTo(0.99)
    expect(result.probabilities.textOrOrderLabelRisk).toBeCloseTo(0.98)
  })

  it('returns skip when probability delta is below threshold and skip is allowed', () => {
    const result = aggregateProbabilityEnsembleRuns(
      [
        {
          payload: {
            optionA: {
              chronology_probability: 0.55,
              cause_effect_probability: 0.55,
              entity_continuity_probability: 0.55,
              final_state_probability: 0.55,
            },
            optionB: {
              chronology_probability: 0.5,
              cause_effect_probability: 0.5,
              entity_continuity_probability: 0.5,
              final_state_probability: 0.5,
            },
          },
        },
      ],
      {forceDecision: false, probabilityDecisionDelta: 0.08}
    )

    expect(result.answer).toBe('skip')
    expect(result.skippedByDelta).toBe(true)
  })

  it('chooses the higher probability side when forceDecision is true', () => {
    const result = aggregateProbabilityEnsembleRuns(
      [
        {
          payload: {
            optionA: {
              chronology_probability: 0.53,
              cause_effect_probability: 0.53,
              entity_continuity_probability: 0.53,
              final_state_probability: 0.53,
            },
            optionB: {
              chronology_probability: 0.5,
              cause_effect_probability: 0.5,
              entity_continuity_probability: 0.5,
              final_state_probability: 0.5,
            },
          },
        },
      ],
      {forceDecision: true, probabilityDecisionDelta: 0.08}
    )

    expect(result.answer).toBe('left')
    expect(result.skippedByDelta).toBe(false)
  })

  it('does not default forced equal probability ties to left', () => {
    const payload = {
      optionA: {
        chronology_probability: 0.5,
        cause_effect_probability: 0.5,
        entity_continuity_probability: 0.5,
        final_state_probability: 0.5,
      },
      optionB: {
        chronology_probability: 0.5,
        cause_effect_probability: 0.5,
        entity_continuity_probability: 0.5,
        final_state_probability: 0.5,
      },
    }

    const resultA = aggregateProbabilityEnsembleRuns([{payload}], {
      forceDecision: true,
      probabilityDecisionDelta: 0.08,
      tieBreakerKey: 'tie-seed-a',
    })
    const resultB = aggregateProbabilityEnsembleRuns([{payload}], {
      forceDecision: true,
      probabilityDecisionDelta: 0.08,
      tieBreakerKey: 'tie-seed-b',
    })

    expect(['left', 'right']).toContain(resultA.answer)
    expect(['left', 'right']).toContain(resultB.answer)
    expect(new Set([resultA.answer, resultB.answer]).size).toBe(2)
  })

  it('maps swapped option A/B scores back to original left/right', () => {
    const result = aggregateProbabilityEnsembleRuns(
      [
        {
          swapped: true,
          payload: {
            optionA: {
              chronology_probability: 0.2,
              cause_effect_probability: 0.2,
              entity_continuity_probability: 0.2,
              final_state_probability: 0.2,
            },
            optionB: {
              chronology_probability: 0.8,
              cause_effect_probability: 0.8,
              entity_continuity_probability: 0.8,
              final_state_probability: 0.8,
            },
          },
        },
      ],
      {forceDecision: false, probabilityDecisionDelta: 0.08}
    )

    expect(result.answer).toBe('left')
    expect(result.probabilities.left).toBeCloseTo(0.8)
    expect(result.probabilities.right).toBeCloseTo(0.2)
    expect(result.runs[0]).toMatchObject({
      optionATo: 'right',
      optionBTo: 'left',
    })
  })

  it('parses data URL payload', () => {
    expect(stripDataUrl('data:image/png;base64,AAA=')).toStrictEqual({
      mimeType: 'image/png',
      data: 'AAA=',
    })
  })
})
