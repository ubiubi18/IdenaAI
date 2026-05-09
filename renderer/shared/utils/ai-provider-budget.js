import {
  loadPersistentState,
  loadPersistentStateValue,
  persistItem,
} from './persist'

export const DEFAULT_AI_PROVIDER_DAILY_BUDGET_USD = 15
export const DEFAULT_AI_PROVIDER_DAILY_BUDGET_INCREMENT_USD = 5
export const AI_PROVIDER_BUDGET_LEDGER_STORAGE_KEY =
  'ai-provider-daily-budget-ledger'
export const AI_PROVIDER_BUDGET_LEDGER_VERSION = 1

const VALIDATION_AI_COST_LEDGER_STORAGE_SUFFIX = 'validation-ai-cost-ledger'
const MAX_PROVIDER_BUDGET_LEDGER_ENTRIES = 250

function normalizeUsd(value) {
  const next = Number(value)
  return Number.isFinite(next) && next >= 0 ? next : null
}

function normalizeTokenUsage(usage = {}) {
  const source = usage && typeof usage === 'object' ? usage : {}
  const promptTokens = Number(source.promptTokens)
  const completionTokens = Number(source.completionTokens)
  const totalTokens = Number(source.totalTokens)

  const normalizedPrompt =
    Number.isFinite(promptTokens) && promptTokens >= 0 ? promptTokens : 0
  const normalizedCompletion =
    Number.isFinite(completionTokens) && completionTokens >= 0
      ? completionTokens
      : 0

  return {
    promptTokens: normalizedPrompt,
    completionTokens: normalizedCompletion,
    totalTokens:
      Number.isFinite(totalTokens) && totalTokens >= 0
        ? totalTokens
        : normalizedPrompt + normalizedCompletion,
  }
}

function getEntryUsd(entry = {}) {
  const actualUsd = normalizeUsd(entry.actualUsd)
  if (actualUsd !== null) {
    return actualUsd
  }
  const estimatedUsd = normalizeUsd(entry.estimatedUsd)
  return estimatedUsd !== null ? estimatedUsd : 0
}

export function getAiProviderBudgetDayKey(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(value.getTime())) {
    return getAiProviderBudgetDayKey(new Date())
  }

  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function isRemoteAiProvider(provider) {
  const normalized = String(provider || '')
    .trim()
    .toLowerCase()
  return Boolean(normalized && normalized !== 'local-ai')
}

export function normalizeAiProviderDailyBudgetSettings(aiSolver = {}) {
  const limit = Number(aiSolver.providerDailyBudgetUsd)
  const enabled =
    aiSolver.providerDailyBudgetEnabled === undefined
      ? true
      : aiSolver.providerDailyBudgetEnabled !== false

  return {
    enabled,
    limitUsd:
      Number.isFinite(limit) && limit > 0
        ? Math.min(10000, Math.max(0.01, limit))
        : DEFAULT_AI_PROVIDER_DAILY_BUDGET_USD,
    overrideDate: String(aiSolver.providerDailyBudgetOverrideDate || '').trim(),
    overrideConsentAt: String(
      aiSolver.providerDailyBudgetOverrideConsentAt || ''
    ).trim(),
    lastApprovedUsd: normalizeUsd(aiSolver.providerDailyBudgetLastApprovedUsd),
    lastApprovedAt: String(
      aiSolver.providerDailyBudgetLastApprovedAt || ''
    ).trim(),
  }
}

export function getMinimumAiProviderDailyBudgetUsd(status = {}) {
  const limit = normalizeUsd(status.limitUsd)
  const usage = normalizeUsd(status.usage && status.usage.usd)
  const projected = normalizeUsd(status.projectedUsd)

  return Math.max(limit || 0, usage || 0, projected || 0)
}

export function getSuggestedAiProviderDailyBudgetUsd(status = {}) {
  const minimum = getMinimumAiProviderDailyBudgetUsd(status)
  const suggested = minimum + DEFAULT_AI_PROVIDER_DAILY_BUDGET_INCREMENT_USD

  return Math.min(10000, Math.max(0.01, Math.ceil(suggested)))
}

export function normalizeAiProviderBudgetLedgerEntry(entry = {}) {
  const source = entry && typeof entry === 'object' ? entry : {}

  return {
    id:
      String(source.id || '').trim() ||
      `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    time: String(source.time || '').trim() || new Date().toISOString(),
    source: String(source.source || '').trim() || 'unknown',
    action: String(source.action || '').trim() || 'unknown',
    provider: String(source.provider || '').trim() || 'unknown',
    model: String(source.model || '').trim() || 'unknown',
    tokenUsage: normalizeTokenUsage(source.tokenUsage),
    estimatedUsd: normalizeUsd(source.estimatedUsd),
    actualUsd: normalizeUsd(source.actualUsd),
  }
}

export function normalizeAiProviderBudgetLedger(value = {}) {
  const source = value && typeof value === 'object' ? value : {}
  const entries = Array.isArray(source.entries) ? source.entries : []

  return {
    version: AI_PROVIDER_BUDGET_LEDGER_VERSION,
    updatedAt: String(source.updatedAt || '').trim() || null,
    entries: entries
      .map((entry) => normalizeAiProviderBudgetLedgerEntry(entry))
      .slice(0, MAX_PROVIDER_BUDGET_LEDGER_ENTRIES),
  }
}

export function loadAiProviderBudgetLedger() {
  return normalizeAiProviderBudgetLedger(
    loadPersistentStateValue(
      'validationResults',
      AI_PROVIDER_BUDGET_LEDGER_STORAGE_KEY
    )
  )
}

export function persistAiProviderBudgetLedger(ledger = {}) {
  persistItem(
    'validationResults',
    AI_PROVIDER_BUDGET_LEDGER_STORAGE_KEY,
    normalizeAiProviderBudgetLedger({
      ...ledger,
      updatedAt: new Date().toISOString(),
    })
  )
}

export function appendAiProviderBudgetLedgerEntry(entry = {}) {
  const currentLedger = loadAiProviderBudgetLedger()
  const nextEntry = normalizeAiProviderBudgetLedgerEntry(entry)
  persistAiProviderBudgetLedger({
    ...currentLedger,
    entries: [nextEntry]
      .concat(currentLedger.entries || [])
      .slice(0, MAX_PROVIDER_BUDGET_LEDGER_ENTRIES),
  })
  return nextEntry
}

function isEntryOnDay(entry = {}, dayKey = getAiProviderBudgetDayKey()) {
  return getAiProviderBudgetDayKey(entry.time) === dayKey
}

function computeEntriesTotals(
  entries = [],
  dayKey = getAiProviderBudgetDayKey()
) {
  return entries
    .filter((entry) => isEntryOnDay(entry, dayKey))
    .reduce(
      (acc, entry) => {
        const tokenUsage = normalizeTokenUsage(entry.tokenUsage)
        const usd = getEntryUsd(entry)
        return {
          entries: acc.entries + 1,
          promptTokens: acc.promptTokens + tokenUsage.promptTokens,
          completionTokens: acc.completionTokens + tokenUsage.completionTokens,
          totalTokens: acc.totalTokens + tokenUsage.totalTokens,
          usd: acc.usd + usd,
        }
      },
      {
        entries: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        usd: 0,
      }
    )
}

export function computeValidationAiCostLedgerDailyTotals({
  validationResultsState = null,
  dayKey = getAiProviderBudgetDayKey(),
} = {}) {
  const state =
    validationResultsState &&
    typeof validationResultsState === 'object' &&
    !Array.isArray(validationResultsState)
      ? validationResultsState
      : loadPersistentState('validationResults') || {}

  return Object.entries(state).reduce(
    (acc, [key, value]) => {
      if (
        !String(key || '').endsWith(VALIDATION_AI_COST_LEDGER_STORAGE_SUFFIX)
      ) {
        return acc
      }

      const entries = Array.isArray(value && value.entries) ? value.entries : []
      const totals = computeEntriesTotals(entries, dayKey)
      return {
        entries: acc.entries + totals.entries,
        promptTokens: acc.promptTokens + totals.promptTokens,
        completionTokens: acc.completionTokens + totals.completionTokens,
        totalTokens: acc.totalTokens + totals.totalTokens,
        usd: acc.usd + totals.usd,
      }
    },
    {
      entries: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      usd: 0,
    }
  )
}

export function computeAiProviderDailyBudgetUsage({
  dayKey = getAiProviderBudgetDayKey(),
  validationResultsState = null,
  providerBudgetLedger = null,
} = {}) {
  const validationTotals = computeValidationAiCostLedgerDailyTotals({
    validationResultsState,
    dayKey,
  })
  const providerLedgerTotals = computeEntriesTotals(
    normalizeAiProviderBudgetLedger(
      providerBudgetLedger || loadAiProviderBudgetLedger()
    ).entries,
    dayKey
  )

  return {
    dayKey,
    entries: validationTotals.entries + providerLedgerTotals.entries,
    promptTokens:
      validationTotals.promptTokens + providerLedgerTotals.promptTokens,
    completionTokens:
      validationTotals.completionTokens + providerLedgerTotals.completionTokens,
    totalTokens:
      validationTotals.totalTokens + providerLedgerTotals.totalTokens,
    usd: validationTotals.usd + providerLedgerTotals.usd,
    validationUsd: validationTotals.usd,
    standaloneUsd: providerLedgerTotals.usd,
  }
}

export function getAiProviderDailyBudgetStatus(
  aiSolver = {},
  {
    provider = aiSolver.provider,
    now = new Date(),
    additionalUsd = 0,
    validationResultsState = null,
    providerBudgetLedger = null,
  } = {}
) {
  const settings = normalizeAiProviderDailyBudgetSettings(aiSolver)
  const dayKey = getAiProviderBudgetDayKey(now)
  const usage = computeAiProviderDailyBudgetUsage({
    dayKey,
    validationResultsState,
    providerBudgetLedger,
  })
  const additional = normalizeUsd(additionalUsd) || 0
  const projectedUsd = usage.usd + additional
  const remoteProvider = isRemoteAiProvider(provider)
  const overrideActive =
    settings.overrideDate === dayKey && Boolean(settings.overrideConsentAt)
  const blocked =
    remoteProvider && settings.enabled && projectedUsd >= settings.limitUsd

  return {
    ...settings,
    dayKey,
    usage,
    remoteProvider,
    additionalUsd: additional,
    projectedUsd,
    remainingUsd: Math.max(0, settings.limitUsd - usage.usd),
    blocked,
    overrideActive,
  }
}

export function buildAiProviderDailyBudgetErrorMessage(status = {}) {
  const limit = Number(status.limitUsd)
  const spent = Number(status.usage && status.usage.usd)
  const dayKey = status.dayKey || getAiProviderBudgetDayKey()

  return `Remote AI provider budget reached for ${dayKey}. Spent about $${(Number.isFinite(
    spent
  )
    ? spent
    : 0
  ).toFixed(2)} of the daily $${(Number.isFinite(limit)
    ? limit
    : DEFAULT_AI_PROVIDER_DAILY_BUDGET_USD
  ).toFixed(
    2
  )} cap. Remote-provider autosolve is blocked until you approve a higher daily cap or turn the budget guardrail off.`
}
