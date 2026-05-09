/** @jest-environment jsdom */
import {persistState} from './persist'
import {
  AI_PROVIDER_BUDGET_LEDGER_STORAGE_KEY,
  appendAiProviderBudgetLedgerEntry,
  getAiProviderBudgetDayKey,
  getAiProviderDailyBudgetStatus,
  getSuggestedAiProviderDailyBudgetUsd,
  loadAiProviderBudgetLedger,
} from './ai-provider-budget'

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

describe('ai provider daily budget guardrail', () => {
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

  it('blocks a remote provider when today usage reaches the default cap', () => {
    const now = new Date('2026-05-09T12:00:00')
    const dayKey = getAiProviderBudgetDayKey(now)
    const validationResultsState = {
      [`scope-${dayKey}-validation-ai-cost-ledger`]: {
        entries: [
          {
            time: '2026-05-09T09:00:00',
            actualUsd: 14.5,
          },
          {
            time: '2026-05-09T10:00:00',
            estimatedUsd: 0.5,
          },
        ],
      },
    }

    const status = getAiProviderDailyBudgetStatus(
      {provider: 'openai'},
      {
        now,
        validationResultsState,
        providerBudgetLedger: {entries: []},
      }
    )

    expect(status.blocked).toBe(true)
    expect(status.limitUsd).toBe(15)
    expect(status.usage.usd).toBe(15)
  })

  it('counts standalone rehearsal lane ledger entries in the daily cap', () => {
    appendAiProviderBudgetLedgerEntry({
      time: '2026-05-09T10:30:00',
      source: 'rehearsal-solver-lanes',
      provider: 'openai',
      model: 'gpt-5.5',
      actualUsd: 4,
      tokenUsage: {
        promptTokens: 100,
        completionTokens: 20,
      },
    })

    const status = getAiProviderDailyBudgetStatus(
      {provider: 'openai', providerDailyBudgetUsd: 5},
      {now: new Date('2026-05-09T12:00:00'), additionalUsd: 1}
    )

    expect(loadAiProviderBudgetLedger().entries).toHaveLength(1)
    expect(validationResultsStoreState).toHaveProperty(
      AI_PROVIDER_BUDGET_LEDGER_STORAGE_KEY
    )
    expect(status.projectedUsd).toBe(5)
    expect(status.blocked).toBe(true)
  })

  it('does not treat legacy same-day overrides as uncapped provider consent', () => {
    const now = new Date('2026-05-09T12:00:00')
    const dayKey = getAiProviderBudgetDayKey(now)
    const status = getAiProviderDailyBudgetStatus(
      {
        provider: 'openai',
        providerDailyBudgetUsd: 1,
        providerDailyBudgetOverrideDate: dayKey,
        providerDailyBudgetOverrideConsentAt: '2026-05-09T11:00:00',
      },
      {
        now,
        providerBudgetLedger: {
          entries: [{time: '2026-05-09T10:00:00', actualUsd: 4}],
        },
      }
    )

    expect(status.overrideActive).toBe(true)
    expect(status.blocked).toBe(true)
    expect(getSuggestedAiProviderDailyBudgetUsd(status)).toBe(9)
  })

  it('does not block Local AI or disabled guardrails', () => {
    const status = getAiProviderDailyBudgetStatus(
      {provider: 'local-ai', providerDailyBudgetUsd: 1},
      {
        now: new Date('2026-05-09T12:00:00'),
        providerBudgetLedger: {
          entries: [{time: '2026-05-09T10:00:00', actualUsd: 50}],
        },
      }
    )
    const disabled = getAiProviderDailyBudgetStatus(
      {
        provider: 'openai',
        providerDailyBudgetEnabled: false,
        providerDailyBudgetUsd: 1,
      },
      {
        now: new Date('2026-05-09T12:00:00'),
        providerBudgetLedger: {
          entries: [{time: '2026-05-09T10:00:00', actualUsd: 50}],
        },
      }
    )

    expect(status.blocked).toBe(false)
    expect(disabled.blocked).toBe(false)
  })
})
