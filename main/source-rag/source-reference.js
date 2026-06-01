const {normalizeSha256Hex, sha256Json, sha256Text} = require('./hash')
const {resolveLicensePolicy} = require('./license-policy')

const SOURCE_REFERENCE_VERSION = 1
const SOURCE_TYPES = new Set([
  'wikipedia',
  'grokipedia',
  'arxiv',
  'public-docs',
  'github-repo',
  'website',
  'pdf',
  'other',
])
const ACCESS_STATUSES = new Set([
  'ok',
  'requires-auth',
  'not-found',
  'blocked',
  'changed',
  'unknown',
])
const TRACKING_QUERY_KEYS = new Set([
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  'ref',
  'ref_src',
])
const SOURCE_TYPE_ALIASES = {
  docs: 'public-docs',
  documentation: 'public-docs',
  github: 'github-repo',
  grokpedia: 'grokipedia',
  wiki: 'wikipedia',
}
const NON_PUBLIC_HOSTNAMES = new Set(['localhost'])

function normalizeString(value) {
  return String(value || '').trim()
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return []
  }

  return value.map(normalizeString).filter(Boolean)
}

function normalizeSourceType(value) {
  const normalized = normalizeString(value).toLowerCase()
  if (SOURCE_TYPE_ALIASES[normalized]) {
    return SOURCE_TYPE_ALIASES[normalized]
  }
  return SOURCE_TYPES.has(normalized) ? normalized : 'other'
}

function normalizeAccessStatus(value) {
  const normalized = normalizeString(value).toLowerCase()
  return ACCESS_STATUSES.has(normalized) ? normalized : 'unknown'
}

function shouldDropSearchParam(key) {
  const normalized = String(key || '')
    .trim()
    .toLowerCase()
  return normalized.startsWith('utm_') || TRACKING_QUERY_KEYS.has(normalized)
}

function normalizeUrl(value, {required = false} = {}) {
  const text = normalizeString(value)

  if (!text) {
    if (required) {
      throw new Error('canonicalUrl is required')
    }
    return ''
  }

  let url
  try {
    url = new URL(text)
  } catch {
    throw new Error(`Invalid URL: ${text}`)
  }

  if (!/^https?:$/iu.test(url.protocol)) {
    throw new Error(`Unsupported URL protocol: ${url.protocol}`)
  }

  if (url.username || url.password) {
    throw new Error('Source URL must not include embedded credentials')
  }

  url.protocol = url.protocol.toLowerCase()
  url.hostname = url.hostname.toLowerCase()
  url.hash = ''

  if (
    (url.protocol === 'https:' && url.port === '443') ||
    (url.protocol === 'http:' && url.port === '80')
  ) {
    url.port = ''
  }

  const params = Array.from(url.searchParams.entries())
    .filter(([key]) => !shouldDropSearchParam(key))
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      if (leftKey !== rightKey) {
        return leftKey.localeCompare(rightKey)
      }
      return leftValue.localeCompare(rightValue)
    })

  url.search = ''
  params.forEach(([key, itemValue]) => {
    url.searchParams.append(key, itemValue)
  })

  return url.toString()
}

function normalizeHostnameForPolicy(hostname) {
  return String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/^\[/u, '')
    .replace(/\]$/u, '')
    .replace(/\.$/u, '')
}

function parseIpv4Address(hostname) {
  const parts = normalizeHostnameForPolicy(hostname).split('.')
  if (parts.length !== 4) {
    return null
  }

  const octets = parts.map((part) => {
    if (!/^\d{1,3}$/u.test(part)) {
      return Number.NaN
    }
    return Number.parseInt(part, 10)
  })

  return octets.every((octet) => Number.isInteger(octet) && octet <= 255)
    ? octets
    : null
}

function isNonPublicIpv4(hostname) {
  const octets = parseIpv4Address(hostname)
  if (!octets) {
    return false
  }

  const [first, second] = octets
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  )
}

function isNonPublicIpv6(hostname) {
  const normalized = normalizeHostnameForPolicy(hostname)
  if (!normalized.includes(':')) {
    return false
  }

  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    /^fe[89ab]/u.test(normalized) ||
    normalized.startsWith('::ffff:10.') ||
    normalized.startsWith('::ffff:127.') ||
    normalized.startsWith('::ffff:169.254.') ||
    normalized.startsWith('::ffff:192.168.')
  )
}

function isNonPublicHostname(hostname) {
  const normalized = normalizeHostnameForPolicy(hostname)

  return (
    NON_PUBLIC_HOSTNAMES.has(normalized) ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal') ||
    isNonPublicIpv4(normalized) ||
    isNonPublicIpv6(normalized)
  )
}

function detectUrlRiskFlags(value, {role = 'canonical'} = {}) {
  const normalizedUrl = normalizeString(value)
  if (!normalizedUrl) {
    return []
  }

  const url = new URL(normalizedUrl)
  const flags = []

  if (url.protocol === 'http:') {
    flags.push(`url-risk:${role}-plain-http`)
  }

  if (isNonPublicHostname(url.hostname)) {
    flags.push(`url-risk:${role}-non-public-host`)
  }

  return flags
}

function normalizeQualityFlags(value, policyFlags = []) {
  const flags = Array.isArray(value) ? value : []

  return Array.from(
    new Set(
      flags
        .concat(policyFlags)
        .map((flag) => normalizeString(flag).toLowerCase())
        .filter(Boolean)
    )
  ).sort()
}

function toIsoTimestamp(value, fallback) {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback
}

function normalizeTimestamp(value, fallback) {
  const raw = normalizeString(value)
  if (!raw) {
    return fallback
  }

  return toIsoTimestamp(raw, fallback)
}

function resolveNowTimestamp(now) {
  const value = typeof now === 'function' ? now() : now
  return toIsoTimestamp(value, new Date().toISOString())
}

function buildSourceId({sourceType, canonicalUrl, versionUrl}) {
  return `source:${sha256Json({
    sourceType,
    canonicalUrl,
    versionUrl: versionUrl || '',
  }).slice(0, 32)}`
}

function normalizeExplicitSourceId(value) {
  const sourceId = normalizeString(value)

  if (!sourceId) {
    return ''
  }

  if (!/^source:[a-f0-9]{16,64}$/u.test(sourceId)) {
    throw new Error('sourceId must be a source: prefixed lowercase hex id')
  }

  return sourceId
}

function isStoredSourceReference(source = {}) {
  return Boolean(
    source &&
      typeof source === 'object' &&
      !Array.isArray(source) &&
      source.schemaVersion &&
      source.sourceId &&
      source.canonicalUrl
  )
}

function createSourceReference(
  source = {},
  {now = () => new Date(), allowExplicitSourceId = false} = {}
) {
  const canonicalUrl = normalizeUrl(source.canonicalUrl, {required: true})
  const versionUrl = normalizeUrl(source.versionUrl)
  const sourceType = normalizeSourceType(source.sourceType)
  const generatedSourceId = buildSourceId({
    sourceType,
    canonicalUrl,
    versionUrl,
  })
  const timestamp = resolveNowTimestamp(now)
  const retrievedAt = normalizeTimestamp(source.retrievedAt, timestamp)
  const lastCheckedAt = normalizeTimestamp(source.lastCheckedAt, retrievedAt)
  const licensePolicy = resolveLicensePolicy(source)
  const accessStatus = normalizeAccessStatus(
    source.accessStatus || (source.contentHash ? 'ok' : 'unknown')
  )
  const urlRiskFlags = detectUrlRiskFlags(canonicalUrl, {
    role: 'canonical',
  }).concat(
    detectUrlRiskFlags(versionUrl, {
      role: 'version',
    })
  )

  return {
    schemaVersion: SOURCE_REFERENCE_VERSION,
    sourceId: allowExplicitSourceId
      ? normalizeExplicitSourceId(source.sourceId) || generatedSourceId
      : generatedSourceId,
    sourceType,
    canonicalUrl,
    versionUrl,
    title: normalizeString(source.title),
    authors: normalizeStringArray(source.authors),
    publisher: normalizeString(source.publisher),
    platform: normalizeString(source.platform),
    retrievedAt,
    lastCheckedAt,
    contentHash: normalizeSha256Hex(source.contentHash, {
      fieldName: 'contentHash',
    }),
    license: licensePolicy.license,
    licenseUrl: licensePolicy.licenseUrl,
    licenseDetectedFrom: licensePolicy.licenseDetectedFrom,
    licenseClass: licensePolicy.licenseClass,
    attributionRequired: licensePolicy.attributionRequired,
    shareAlikeRequired: licensePolicy.shareAlikeRequired,
    commercialUseAllowed: licensePolicy.commercialUseAllowed,
    derivativesAllowed: licensePolicy.derivativesAllowed,
    fullTextStorageAllowed: licensePolicy.fullTextStorageAllowed,
    condensedKnowledgeStorageAllowed:
      licensePolicy.condensedKnowledgeStorageAllowed,
    publicCondensedKnowledgeAllowed:
      licensePolicy.publicCondensedKnowledgeAllowed,
    reviewRequired: licensePolicy.reviewRequired,
    accessStatus,
    sourceQualityFlags: normalizeQualityFlags(
      source.sourceQualityFlags,
      licensePolicy.sourceQualityFlags.concat(urlRiskFlags)
    ),
  }
}

function hashSourceReference(
  source = {},
  {allowExplicitSourceId = false} = {}
) {
  const stableTimestamp =
    normalizeString(source.retrievedAt) ||
    normalizeString(source.lastCheckedAt) ||
    '1970-01-01T00:00:00.000Z'

  return sha256Json(
    createSourceReference(source, {
      allowExplicitSourceId:
        allowExplicitSourceId || isStoredSourceReference(source),
      now: () => stableTimestamp,
    })
  )
}

function hashFetchedSourceContent(content) {
  return sha256Text(content)
}

module.exports = {
  ACCESS_STATUSES,
  SOURCE_TYPE_ALIASES,
  SOURCE_REFERENCE_VERSION,
  SOURCE_TYPES,
  buildSourceId,
  createSourceReference,
  hashFetchedSourceContent,
  hashSourceReference,
  isStoredSourceReference,
  detectUrlRiskFlags,
  isNonPublicHostname,
  normalizeExplicitSourceId,
  normalizeSourceType,
  normalizeUrl,
}
