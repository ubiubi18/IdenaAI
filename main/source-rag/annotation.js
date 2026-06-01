const {
  detectPromptInjectionRisk,
  mergeSecurityFlags,
} = require('../rag-security')
const {sha256Json} = require('./hash')

const ANNOTATION_VERSION = 1
const TARGET_TYPES = new Set(['source', 'knowledge', 'evidence', 'collection'])
const ANNOTATION_TYPES = new Set([
  'summary',
  'topics',
  'Q&A',
  'warning',
  'quality-review',
  'license-review',
  'source-type',
  'correction',
  'dispute',
  'trust-score',
])
const ANNOTATOR_TYPES = new Set(['ai', 'human', 'heuristic'])

function normalizeString(value) {
  return String(value || '').trim()
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return []
  }

  return value.map(normalizeString).filter(Boolean)
}

function normalizeTargetType(value) {
  const normalized = normalizeString(value).toLowerCase()
  return TARGET_TYPES.has(normalized) ? normalized : 'knowledge'
}

function normalizeAnnotationType(value) {
  const raw = normalizeString(value)
  const lower = raw.toLowerCase()

  if (lower === 'qa' || lower === 'q&a') {
    return 'Q&A'
  }

  return ANNOTATION_TYPES.has(raw) ? raw : 'warning'
}

function normalizeAnnotatorType(value) {
  const normalized = normalizeString(value).toLowerCase()
  return ANNOTATOR_TYPES.has(normalized) ? normalized : 'ai'
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

function normalizePayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return JSON.parse(JSON.stringify(value))
}

function detectAnnotationSecurityFlags(payload = {}) {
  return detectPromptInjectionRisk(JSON.stringify(payload)).flags
}

function buildAnnotationId(annotation) {
  return `annotation:${sha256Json({
    targetType: annotation.targetType,
    targetId: annotation.targetId,
    annotationType: annotation.annotationType,
    annotatorType: annotation.annotatorType,
    provider: annotation.provider,
    model: annotation.model,
    promptVersion: annotation.promptVersion,
    identity: annotation.identity,
    payload: annotation.payload,
    supersedes: annotation.supersedes,
    retracts: annotation.retracts,
  }).slice(0, 32)}`
}

function normalizeExplicitAnnotationId(value) {
  const annotationId = normalizeString(value)

  if (!annotationId) {
    return ''
  }

  if (!/^annotation:[a-f0-9]{16,64}$/u.test(annotationId)) {
    throw new Error(
      'annotationId must be an annotation: prefixed lowercase hex id'
    )
  }

  return annotationId
}

function isStoredAnnotation(annotation = {}) {
  return Boolean(
    annotation &&
      typeof annotation === 'object' &&
      !Array.isArray(annotation) &&
      annotation.schemaVersion &&
      annotation.annotationId &&
      annotation.targetId &&
      annotation.payload
  )
}

function normalizeAnnotationForHash(annotation = {}, options = {}) {
  return createAnnotation(annotation, {
    ...options,
    allowExplicitAnnotationId: true,
    now: () =>
      normalizeString(annotation.createdAt) || '1970-01-01T00:00:00.000Z',
  })
}

function createAnnotation(
  annotation = {},
  {now = () => new Date(), allowExplicitAnnotationId = false} = {}
) {
  const targetType = normalizeTargetType(annotation.targetType)
  const targetId = normalizeString(annotation.targetId)
  if (!targetId) {
    throw new Error('Annotation targetId is required')
  }

  const annotationType = normalizeAnnotationType(annotation.annotationType)
  const annotatorType = normalizeAnnotatorType(annotation.annotatorType)
  const payload = normalizePayload(annotation.payload)
  const createdAt = normalizeTimestamp(
    annotation.createdAt,
    resolveNowTimestamp(now)
  )
  const normalized = {
    schemaVersion: ANNOTATION_VERSION,
    annotationId: '',
    targetType,
    targetId,
    annotationType,
    annotatorType,
    provider: normalizeString(annotation.provider),
    model: normalizeString(annotation.model),
    promptVersion: normalizeString(annotation.promptVersion),
    identity: normalizeString(annotation.identity),
    signature: normalizeString(annotation.signature),
    payload,
    confidence: normalizeConfidence(annotation.confidence, 0),
    securityFlags: mergeSecurityFlags(
      normalizeStringArray(annotation.securityFlags),
      detectAnnotationSecurityFlags(payload)
    ),
    createdAt,
    supersedes: normalizeString(annotation.supersedes),
    retracts: normalizeString(annotation.retracts),
  }

  normalized.annotationId = allowExplicitAnnotationId
    ? normalizeExplicitAnnotationId(annotation.annotationId) ||
      buildAnnotationId(normalized)
    : buildAnnotationId(normalized)

  return normalized
}

function hashAnnotation(annotation = {}) {
  return sha256Json(
    isStoredAnnotation(annotation)
      ? normalizeAnnotationForHash(annotation)
      : createAnnotation(annotation, {
          now: () =>
            normalizeString(annotation.createdAt) || '1970-01-01T00:00:00.000Z',
        })
  )
}

module.exports = {
  ANNOTATION_TYPES,
  ANNOTATION_VERSION,
  ANNOTATOR_TYPES,
  TARGET_TYPES,
  buildAnnotationId,
  createAnnotation,
  hashAnnotation,
  isStoredAnnotation,
  normalizeAnnotationForHash,
  normalizeAnnotationType,
  normalizeAnnotatorType,
  normalizeExplicitAnnotationId,
  normalizeTargetType,
}
