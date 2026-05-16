/** @jest-environment jsdom */
import {persistState} from '../../shared/utils/persist'
import {
  buildValidationAiDecisionLearningRecords,
  computeAiDecisionLearningSummary,
  loadAiDecisionLearningDataset,
  normalizeAiDecisionLearningDataset,
  persistAiDecisionLearningRecords,
} from './ai-decision-learning'

let validationResultsStoreState = {}

function createValidationResultsStore() {
  return {
    loadState() {
      return {...validationResultsStoreState}
    },
    loadValue(key) {
      return validationResultsStoreState[key] || null
    },
    persistItem(key, value) {
      if (value == null) {
        delete validationResultsStoreState[key]
      } else {
        validationResultsStoreState[key] = value
      }
    },
    persistState(state) {
      validationResultsStoreState = state ? {...state} : {}
    },
  }
}

describe('AI decision learning records', () => {
  beforeEach(() => {
    validationResultsStoreState = {}
    window.idena = {
      storage: {
        validationResults: createValidationResultsStore(),
      },
    }
  })

  afterEach(() => {
    persistState('validationResults', null)
    delete window.idena
  })

  it('builds labeled mismatch lessons without storing image payloads', () => {
    const records = buildValidationAiDecisionLearningRecords({
      scope: {
        epoch: 42,
        validationStart: 1710000000000,
        address: '0xabc',
      },
      sessionType: 'short',
      provider: 'openai',
      model: 'gpt-5.5',
      profile: {
        benchmarkProfile: 'strict',
        flipVisionMode: 'frames_single_pass',
        forceDecision: true,
      },
      flips: [
        {
          hash: '0x1',
          option: 1,
          expectedAnswer: 'right',
          expectedStrength: 'Strong',
          consensusVotes: {left: 1, right: 8, reported: 0},
          words: [{name: 'apple', desc: 'fruit'}],
          leftImage: 'data:image/png;base64,private-left',
        },
      ],
      results: [
        {
          hash: '0x1',
          answer: 'left',
          confidence: 0.92,
          reasoning: 'The panels show a sequence from setup to final state.',
          tokenUsage: {promptTokens: 10, completionTokens: 4, totalTokens: 14},
          decisionStructure: {
            observations: ['object stays near the table'],
            hypotheses: [
              {
                id: 'chronology_match',
                claim: 'left candidate continues the visible sequence',
                evidenceFrames: [1, 2, 3, 4],
              },
            ],
            knownRisks: ['similar candidates'],
          },
        },
      ],
    })

    expect(records).toHaveLength(1)
    expect(JSON.stringify(records[0])).not.toContain('private-left')
    expect(records[0]).toMatchObject({
      hash: '0x1',
      expected: {
        answer: 'right',
        hasBenchmarkLabel: true,
      },
      decision: {
        answer: 'left',
        confidence: 0.92,
        observations: ['object stays near the table'],
      },
      comparison: {
        status: 'mismatch',
        mismatchType: 'overconfident_wrong_answer',
        failedHypothesis: 'confidence_calibration',
      },
    })
    expect(records[0].checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({id: 'benchmark_answer_match', status: 'fail'}),
        expect.objectContaining({id: 'confidence_sanity', status: 'fail'}),
      ])
    )
  })

  it('keeps unlabeled real-session decisions for later comparison', () => {
    const records = buildValidationAiDecisionLearningRecords({
      scope: {epoch: 43, validationStart: 1710000000001},
      sessionType: 'long',
      provider: 'local-ai',
      model: 'idenaai-qwen36-27b-claude-opus:q4km',
      flips: [{hash: '0x2', option: 2}],
      results: [
        {
          hash: '0x2',
          answer: 'right',
          confidence: 0.64,
          reasoning: 'Final panel resolves the action.',
        },
      ],
    })

    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      sessionType: 'long',
      selectedAnswer: 'right',
      comparison: {
        status: 'unlabeled',
      },
    })
  })

  it('persists records into the local validationResults dataset', () => {
    const records = buildValidationAiDecisionLearningRecords({
      scope: {epoch: 42, validationStart: 1710000000000},
      flips: [{hash: '0x1', expectedAnswer: 'left'}],
      results: [
        {
          hash: '0x1',
          answer: 'left',
          confidence: 0.7,
          reasoning: 'Panels show cause and effect.',
        },
      ],
    })

    expect(persistAiDecisionLearningRecords(records)).toBe(true)

    const dataset = loadAiDecisionLearningDataset()
    expect(Object.keys(dataset.recordsByKey)).toHaveLength(1)
    expect(Object.values(dataset.recordsByKey)[0]).toMatchObject({
      hash: '0x1',
      comparison: {status: 'match'},
    })
  })

  it('summarizes local learning records', () => {
    expect(
      computeAiDecisionLearningSummary([
        {
          expected: {hasBenchmarkLabel: true},
          comparison: {status: 'match'},
          checks: [{status: 'pass'}],
        },
        {
          expected: {hasBenchmarkLabel: true},
          comparison: {status: 'mismatch'},
          checks: [{status: 'fail'}],
        },
        {
          expected: {hasBenchmarkLabel: false},
          comparison: {status: 'unlabeled'},
          checks: [{status: 'warn'}],
        },
      ])
    ).toEqual({
      total: 3,
      labeled: 2,
      matches: 1,
      mismatches: 1,
      unlabeled: 1,
      highRisk: 1,
      accuracy: 0.5,
    })
  })

  it('rejects unsafe persisted record-map keys', () => {
    const dataset = normalizeAiDecisionLearningDataset(
      JSON.parse(`{
        "recordsByKey": {
          "__proto__": {
            "hash": "0xunsafe",
            "recordKey": "__proto__"
          },
          "scope:short:0x1": {
            "hash": "0x1",
            "recordKey": "scope:short:0x1"
          }
        }
      }`)
    )

    expect(Object.keys(dataset.recordsByKey)).toEqual(['scope:short:0x1'])
    expect(
      Object.prototype.hasOwnProperty.call(dataset.recordsByKey, '__proto__')
    ).toBe(false)
  })
})
