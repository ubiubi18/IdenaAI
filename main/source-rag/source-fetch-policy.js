const {detectUrlRiskFlags, normalizeUrl} = require('./source-reference')

const DEFAULT_MAX_FETCH_BYTES = 2 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 10000
const DEFAULT_MAX_REDIRECTS = 3
const DEFAULT_ALLOWED_CONTENT_TYPES = [
  'application/json',
  'application/pdf',
  'application/xhtml+xml',
  'text/html',
  'text/markdown',
  'text/plain',
  'text/x-markdown',
]

function normalizePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function normalizeNonNegativeInt(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

function normalizeContentType(value) {
  return String(value || '')
    .split(';')[0]
    .trim()
    .toLowerCase()
}

function normalizeAllowedContentTypes(value) {
  const allowed = Array.isArray(value) ? value : DEFAULT_ALLOWED_CONTENT_TYPES

  return Array.from(
    new Set(allowed.map(normalizeContentType).filter(Boolean))
  ).sort()
}

function normalizeSourceFetchPolicy(policy = {}) {
  return {
    allowHttp: Boolean(policy.allowHttp),
    allowedContentTypes: normalizeAllowedContentTypes(
      policy.allowedContentTypes
    ),
    maxBytes: normalizePositiveInt(policy.maxBytes, DEFAULT_MAX_FETCH_BYTES),
    maxRedirects: normalizeNonNegativeInt(
      policy.maxRedirects,
      DEFAULT_MAX_REDIRECTS
    ),
    timeoutMs: normalizePositiveInt(policy.timeoutMs, DEFAULT_TIMEOUT_MS),
  }
}

function resolveSourceUrl(sourceOrUrl = {}) {
  if (typeof sourceOrUrl === 'string') {
    return sourceOrUrl
  }

  return sourceOrUrl.versionUrl || sourceOrUrl.canonicalUrl || ''
}

function getSourceFetchBlockReasons(sourceOrUrl = {}, policy = {}) {
  const normalizedPolicy = normalizeSourceFetchPolicy(policy)
  const rawUrl = resolveSourceUrl(sourceOrUrl)
  const reasons = []
  let normalizedUrl = ''

  try {
    normalizedUrl = normalizeUrl(rawUrl, {required: true})
  } catch (error) {
    return [`url_invalid:${error.message}`]
  }

  detectUrlRiskFlags(normalizedUrl, {role: 'fetch'}).forEach((flag) => {
    if (flag === 'url-risk:fetch-plain-http' && normalizedPolicy.allowHttp) {
      return
    }
    reasons.push(flag)
  })

  if (
    sourceOrUrl &&
    typeof sourceOrUrl === 'object' &&
    ['blocked', 'not-found', 'requires-auth'].includes(sourceOrUrl.accessStatus)
  ) {
    reasons.push(`source_access_${sourceOrUrl.accessStatus}`)
  }

  return Array.from(new Set(reasons)).sort()
}

function assertSourceFetchAllowed(sourceOrUrl = {}, policy = {}) {
  const reasons = getSourceFetchBlockReasons(sourceOrUrl, policy)

  if (reasons.length) {
    throw new Error(`Source fetch blocked: ${reasons.join(', ')}`)
  }
}

function isAllowedContentType(contentType, policy = {}) {
  const normalizedPolicy = normalizeSourceFetchPolicy(policy)
  const normalized = normalizeContentType(contentType)

  return (
    Boolean(normalized) &&
    normalizedPolicy.allowedContentTypes.includes(normalized)
  )
}

function getSourceFetchResponseBlockReasons(response = {}, policy = {}) {
  const normalizedPolicy = normalizeSourceFetchPolicy(policy)
  const reasons = []
  const status = Number.parseInt(response.status, 10)
  const contentLength =
    response.contentLength == null
      ? null
      : Number.parseInt(response.contentLength, 10)
  const contentType = normalizeContentType(response.contentType)

  if (!Number.isInteger(status) || status < 200 || status >= 300) {
    reasons.push(`http_status_${Number.isInteger(status) ? status : 'unknown'}`)
  }

  if (
    Number.isInteger(contentLength) &&
    contentLength > normalizedPolicy.maxBytes
  ) {
    reasons.push('content_length_exceeds_limit')
  }

  if (!isAllowedContentType(contentType, normalizedPolicy)) {
    reasons.push(`content_type_not_allowed:${contentType || 'unknown'}`)
  }

  return Array.from(new Set(reasons)).sort()
}

function assertSourceFetchResponseAllowed(response = {}, policy = {}) {
  const reasons = getSourceFetchResponseBlockReasons(response, policy)

  if (reasons.length) {
    throw new Error(`Source fetch response blocked: ${reasons.join(', ')}`)
  }
}

function getRedirectBlockReasons(redirectUrls = [], policy = {}) {
  const normalizedPolicy = normalizeSourceFetchPolicy(policy)
  const urls = Array.isArray(redirectUrls) ? redirectUrls : []
  const reasons = []

  if (urls.length > normalizedPolicy.maxRedirects) {
    reasons.push('redirect_count_exceeds_limit')
  }

  urls.forEach((url, index) => {
    getSourceFetchBlockReasons(url, normalizedPolicy).forEach((reason) => {
      reasons.push(`redirect_${index}:${reason}`)
    })
  })

  return Array.from(new Set(reasons)).sort()
}

function assertRedirectsAllowed(redirectUrls = [], policy = {}) {
  const reasons = getRedirectBlockReasons(redirectUrls, policy)

  if (reasons.length) {
    throw new Error(`Source fetch redirect blocked: ${reasons.join(', ')}`)
  }
}

module.exports = {
  DEFAULT_ALLOWED_CONTENT_TYPES,
  DEFAULT_MAX_FETCH_BYTES,
  DEFAULT_MAX_REDIRECTS,
  DEFAULT_TIMEOUT_MS,
  assertRedirectsAllowed,
  assertSourceFetchAllowed,
  assertSourceFetchResponseAllowed,
  getRedirectBlockReasons,
  getSourceFetchBlockReasons,
  getSourceFetchResponseBlockReasons,
  isAllowedContentType,
  normalizeContentType,
  normalizeSourceFetchPolicy,
}
