const {normalizeEvidenceAnchors} = require('./evidence-anchor')
const {sha256Json} = require('./hash')
const {
  detectPromptInjectionRisk,
  mergeSecurityFlags,
} = require('../rag-security')
const {getPublicCondensedKnowledgeBlockReasons} = require('./license-policy')

const KNOWLEDGE_ITEM_VERSION = 1
const KNOWLEDGE_TYPES = new Set([
  'summary',
  'claim',
  'definition',
  'relation',
  'Q&A',
  'topic',
  'entity',
  'warning',
])
const KNOWLEDGE_TYPE_ALIASES = {
  qa: 'Q&A',
  qna: 'Q&A',
  question_answer: 'Q&A',
  question_and_answer: 'Q&A',
}
const REVIEW_STATUSES = new Set([
  'draft',
  'ai-candidate',
  'human-reviewed',
  'approved',
  'rejected',
  'disputed',
])
const VISIBILITIES = new Set(['private', 'group', 'public'])
const CREATED_BY_TYPES = new Set(['ai', 'human', 'heuristic'])

function normalizeString(value) {
  return String(value || '').trim()
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return []
  }

  return value.map(normalizeString).filter(Boolean)
}

function normalizeKnowledgeType(value) {
  const raw = normalizeString(value)
  const lower = raw.toLowerCase()

  if (KNOWLEDGE_TYPE_ALIASES[lower]) {
    return KNOWLEDGE_TYPE_ALIASES[lower]
  }

  return KNOWLEDGE_TYPES.has(raw) ? raw : 'claim'
}

function normalizeReviewStatus(value) {
  const normalized = normalizeString(value).toLowerCase()
  return REVIEW_STATUSES.has(normalized) ? normalized : 'draft'
}

function normalizeVisibility(value) {
  const normalized = normalizeString(value).toLowerCase()
  return VISIBILITIES.has(normalized) ? normalized : 'private'
}

function normalizeConfidence(value, fallback = 0) {
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.max(0, Math.min(1, parsed))
}

function normalizeTimestamp(value, fallback) {
  const raw = normalizeString(value)
  if (!raw) {
    return fallback
  }

  const date = new Date(raw)
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback
}

function resolveNowTimestamp(now) {
  const value = typeof now === 'function' ? now() : now
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime())
    ? date.toISOString()
    : new Date().toISOString()
}

function normalizeCreatedBy(value = {}) {
  const type = normalizeString(value.type).toLowerCase()

  return {
    type: CREATED_BY_TYPES.has(type) ? type : 'human',
    id: normalizeString(value.id) || 'local-human',
  }
}

function normalizeSecurityFlags(value) {
  return mergeSecurityFlags(Array.isArray(value) ? value : [])
}

function normalizeLicenseStatusForHash(value = {}) {
  return {
    status: normalizeString(value.status) || 'review-required',
    inheritedFromSourceIds: normalizeStringArray(
      value.inheritedFromSourceIds
    ).sort(),
    sourceLicenses: normalizeStringArray(value.sourceLicenses).sort(),
    sourceLicenseClasses: normalizeStringArray(
      value.sourceLicenseClasses
    ).sort(),
    condensedKnowledgeStorageAllowed: Boolean(
      value.condensedKnowledgeStorageAllowed
    ),
    publicExportAllowed: Boolean(value.publicExportAllowed),
    blockReasons: normalizeStringArray(value.blockReasons).sort(),
  }
}

function isStoredKnowledgeItem(item = {}) {
  return Boolean(
    item &&
      typeof item === 'object' &&
      !Array.isArray(item) &&
      item.licenseStatus &&
      Array.isArray(item.evidenceAnchors) &&
      Array.isArray(item.sourceIds)
  )
}

function normalizeStoredKnowledgeItemForHash(item = {}, options = {}) {
  const createdAt = normalizeTimestamp(
    item.createdAt,
    '1970-01-01T00:00:00.000Z'
  )

  return {
    schemaVersion: item.schemaVersion || KNOWLEDGE_ITEM_VERSION,
    knowledgeId: normalizeString(item.knowledgeId),
    type: normalizeKnowledgeType(item.type),
    text: normalizeString(item.text),
    sourceIds: Array.from(new Set(normalizeStringArray(item.sourceIds))).sort(),
    evidenceAnchors: normalizeEvidenceAnchors(item.evidenceAnchors, {
      maxQuoteChars: options.maxQuoteChars,
    }),
    confidence: normalizeConfidence(item.confidence, 0),
    createdBy: normalizeCreatedBy(item.createdBy),
    licenseStatus: normalizeLicenseStatusForHash(item.licenseStatus),
    reviewStatus: normalizeReviewStatus(item.reviewStatus),
    visibility: normalizeVisibility(item.visibility),
    securityFlags: normalizeSecurityFlags(item.securityFlags),
    createdAt,
    updatedAt: normalizeTimestamp(item.updatedAt, createdAt),
  }
}

function mapSourceReferences(sourceReferences = []) {
  return new Map(
    (Array.isArray(sourceReferences) ? sourceReferences : [])
      .filter((source) => source && source.sourceId)
      .map((source) => [source.sourceId, source])
  )
}

function deriveKnowledgeLicenseStatus(sourceIds = [], sourceReferences = []) {
  const sourceMap = mapSourceReferences(sourceReferences)
  const inheritedFromSourceIds = Array.from(new Set(sourceIds)).sort()
  const missingSourceIds = inheritedFromSourceIds.filter(
    (sourceId) => !sourceMap.has(sourceId)
  )
  const sourceLicenseClasses = Array.from(
    new Set(
      inheritedFromSourceIds
        .map((sourceId) => sourceMap.get(sourceId))
        .filter(Boolean)
        .map((source) => source.licenseClass || 'unknown')
    )
  ).sort()
  const sourceLicenses = Array.from(
    new Set(
      inheritedFromSourceIds
        .map((sourceId) => sourceMap.get(sourceId))
        .filter(Boolean)
        .map((source) => source.license || 'UNKNOWN')
    )
  ).sort()
  const blockReasons = inheritedFromSourceIds.reduce((reasons, sourceId) => {
    const source = sourceMap.get(sourceId)

    if (!source) {
      reasons.push(`source_missing:${sourceId}`)
      return reasons
    }

    getPublicCondensedKnowledgeBlockReasons(source).forEach((reason) => {
      reasons.push(`${sourceId}:${reason}`)
    })
    return reasons
  }, [])
  const condensedKnowledgeStorageAllowed = inheritedFromSourceIds.every(
    (sourceId) => {
      const source = sourceMap.get(sourceId)
      return source && source.condensedKnowledgeStorageAllowed
    }
  )
  const publicExportAllowed =
    inheritedFromSourceIds.length > 0 &&
    missingSourceIds.length === 0 &&
    blockReasons.length === 0
  let status = 'ok'

  if (!inheritedFromSourceIds.length || missingSourceIds.length) {
    status = 'review-required'
  } else if (!condensedKnowledgeStorageAllowed) {
    status = 'blocked'
  } else if (blockReasons.length) {
    status = 'review-required'
  } else if (sourceLicenses.length > 1 || sourceLicenseClasses.length > 1) {
    status = 'mixed'
  }

  return {
    status,
    inheritedFromSourceIds,
    sourceLicenses,
    sourceLicenseClasses,
    condensedKnowledgeStorageAllowed,
    publicExportAllowed,
    blockReasons: Array.from(new Set(blockReasons)).sort(),
  }
}

function assertKnowledgeSourcesAllowed(licenseStatus) {
  if (!licenseStatus.condensedKnowledgeStorageAllowed) {
    throw new Error(
      `Condensed knowledge storage is not allowed for sources: ${licenseStatus.blockReasons.join(
        ', '
      )}`
    )
  }
}

function assertVisibilityAllowed(visibility, licenseStatus) {
  if (visibility !== 'public') {
    return
  }

  if (!licenseStatus.publicExportAllowed) {
    throw new Error(
      `Knowledge item cannot be public: ${licenseStatus.blockReasons.join(
        ', '
      )}`
    )
  }
}

function buildKnowledgeId({type, text, sourceIds, evidenceAnchors}) {
  return `knowledge:${sha256Json({
    type,
    text,
    sourceIds,
    evidenceAnchors,
  }).slice(0, 32)}`
}

function detectKnowledgeSecurityFlags({text, evidenceAnchors}) {
  const evidenceText = (Array.isArray(evidenceAnchors) ? evidenceAnchors : [])
    .map((anchor) =>
      [anchor.quote, anchor.textSelector, anchor.path]
        .filter(Boolean)
        .join('\n')
    )
    .join('\n')

  return mergeSecurityFlags(
    detectPromptInjectionRisk(text).flags,
    detectPromptInjectionRisk(evidenceText).flags
  )
}

function normalizeExplicitKnowledgeId(value) {
  const knowledgeId = normalizeString(value)

  if (!knowledgeId) {
    return ''
  }

  if (!/^knowledge:[a-f0-9]{16,64}$/u.test(knowledgeId)) {
    throw new Error(
      'knowledgeId must be a knowledge: prefixed lowercase hex id'
    )
  }

  return knowledgeId
}

function validateEvidenceAnchorSources(evidenceAnchors, sourceIds) {
  const allowed = new Set(sourceIds)
  const invalidAnchor = evidenceAnchors.find(
    (anchor) => !allowed.has(anchor.sourceId)
  )

  if (invalidAnchor) {
    throw new Error(
      `Evidence anchor sourceId is not linked to this knowledge item: ${invalidAnchor.sourceId}`
    )
  }
}

function createKnowledgeItem(item = {}, options = {}) {
  const text = normalizeString(item.text)
  if (!text) {
    throw new Error('Knowledge item text is required')
  }

  const sourceIds = Array.from(
    new Set(normalizeStringArray(item.sourceIds))
  ).sort()
  if (!sourceIds.length) {
    throw new Error('Knowledge item sourceIds are required')
  }

  const evidenceAnchors = normalizeEvidenceAnchors(item.evidenceAnchors, {
    maxQuoteChars: options.maxQuoteChars,
  })
  if (!evidenceAnchors.length) {
    throw new Error('Knowledge item evidenceAnchors are required')
  }
  validateEvidenceAnchorSources(evidenceAnchors, sourceIds)

  const type = normalizeKnowledgeType(item.type)
  const licenseStatus = deriveKnowledgeLicenseStatus(
    sourceIds,
    options.sourceReferences || item.sourceReferences
  )

  assertKnowledgeSourcesAllowed(licenseStatus)

  const visibility = normalizeVisibility(item.visibility)
  assertVisibilityAllowed(visibility, licenseStatus)

  const timestamp = resolveNowTimestamp(options.now)
  const createdAt = normalizeTimestamp(item.createdAt, timestamp)
  const updatedAt = normalizeTimestamp(item.updatedAt, createdAt)
  const securityFlags = mergeSecurityFlags(
    normalizeSecurityFlags(item.securityFlags),
    detectKnowledgeSecurityFlags({text, evidenceAnchors})
  )
  const generatedKnowledgeId = buildKnowledgeId({
    type,
    text,
    sourceIds,
    evidenceAnchors,
  })

  return {
    schemaVersion: KNOWLEDGE_ITEM_VERSION,
    knowledgeId: options.allowExplicitKnowledgeId
      ? normalizeExplicitKnowledgeId(item.knowledgeId) || generatedKnowledgeId
      : generatedKnowledgeId,
    type,
    text,
    sourceIds,
    evidenceAnchors,
    confidence: normalizeConfidence(item.confidence, 0),
    createdBy: normalizeCreatedBy(item.createdBy),
    licenseStatus,
    reviewStatus: normalizeReviewStatus(item.reviewStatus),
    visibility,
    securityFlags,
    createdAt,
    updatedAt,
  }
}

function hashKnowledgeItem(item = {}, options = {}) {
  if (isStoredKnowledgeItem(item)) {
    return sha256Json(normalizeStoredKnowledgeItemForHash(item, options))
  }

  return sha256Json(
    createKnowledgeItem(item, {
      ...options,
      now: () =>
        normalizeString(item.createdAt) ||
        normalizeString(item.updatedAt) ||
        '1970-01-01T00:00:00.000Z',
    })
  )
}

module.exports = {
  CREATED_BY_TYPES,
  KNOWLEDGE_ITEM_VERSION,
  KNOWLEDGE_TYPES,
  REVIEW_STATUSES,
  VISIBILITIES,
  buildKnowledgeId,
  createKnowledgeItem,
  deriveKnowledgeLicenseStatus,
  hashKnowledgeItem,
  detectKnowledgeSecurityFlags,
  normalizeExplicitKnowledgeId,
  normalizeStoredKnowledgeItemForHash,
  normalizeKnowledgeType,
  normalizeReviewStatus,
  normalizeVisibility,
}
