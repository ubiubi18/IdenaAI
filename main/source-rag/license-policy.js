const LICENSE_DETECTED_FROM_VALUES = new Set([
  'api',
  'metadata',
  'page-footer',
  'repository-license',
  'manual',
  'unknown',
])

const KNOWN_LICENSES = {
  'cc-by-sa-4.0': {
    license: 'CC-BY-SA-4.0',
    licenseClass: 'copyleft',
    attributionRequired: true,
    shareAlikeRequired: true,
    commercialUseAllowed: true,
    derivativesAllowed: true,
    fullTextStorageAllowed: false,
    condensedKnowledgeStorageAllowed: true,
    publicCondensedKnowledgeAllowed: true,
    sourceQualityFlags: ['license-detected', 'attribution-required'],
  },
  'cc-by-sa-3.0': {
    license: 'CC-BY-SA-3.0',
    licenseClass: 'copyleft',
    attributionRequired: true,
    shareAlikeRequired: true,
    commercialUseAllowed: true,
    derivativesAllowed: true,
    fullTextStorageAllowed: false,
    condensedKnowledgeStorageAllowed: true,
    publicCondensedKnowledgeAllowed: true,
    sourceQualityFlags: ['license-detected', 'attribution-required'],
  },
  'cc-by-4.0': {
    license: 'CC-BY-4.0',
    licenseClass: 'permissive',
    attributionRequired: true,
    shareAlikeRequired: false,
    commercialUseAllowed: true,
    derivativesAllowed: true,
    fullTextStorageAllowed: false,
    condensedKnowledgeStorageAllowed: true,
    publicCondensedKnowledgeAllowed: true,
    sourceQualityFlags: ['license-detected', 'attribution-required'],
  },
  cc0: {
    license: 'CC0-1.0',
    licenseClass: 'public-domain',
    attributionRequired: false,
    shareAlikeRequired: false,
    commercialUseAllowed: true,
    derivativesAllowed: true,
    fullTextStorageAllowed: true,
    condensedKnowledgeStorageAllowed: true,
    publicCondensedKnowledgeAllowed: true,
    sourceQualityFlags: ['license-detected'],
  },
  'cc0-1.0': {
    license: 'CC0-1.0',
    licenseClass: 'public-domain',
    attributionRequired: false,
    shareAlikeRequired: false,
    commercialUseAllowed: true,
    derivativesAllowed: true,
    fullTextStorageAllowed: true,
    condensedKnowledgeStorageAllowed: true,
    publicCondensedKnowledgeAllowed: true,
    sourceQualityFlags: ['license-detected'],
  },
  mit: {
    license: 'MIT',
    licenseClass: 'permissive',
    attributionRequired: true,
    shareAlikeRequired: false,
    commercialUseAllowed: true,
    derivativesAllowed: true,
    fullTextStorageAllowed: false,
    condensedKnowledgeStorageAllowed: true,
    publicCondensedKnowledgeAllowed: true,
    sourceQualityFlags: ['license-detected', 'attribution-required'],
  },
  'apache-2.0': {
    license: 'Apache-2.0',
    licenseClass: 'permissive',
    attributionRequired: true,
    shareAlikeRequired: false,
    commercialUseAllowed: true,
    derivativesAllowed: true,
    fullTextStorageAllowed: false,
    condensedKnowledgeStorageAllowed: true,
    publicCondensedKnowledgeAllowed: true,
    sourceQualityFlags: ['license-detected', 'attribution-required'],
  },
  'bsd-2-clause': {
    license: 'BSD-2-Clause',
    licenseClass: 'permissive',
    attributionRequired: true,
    shareAlikeRequired: false,
    commercialUseAllowed: true,
    derivativesAllowed: true,
    fullTextStorageAllowed: false,
    condensedKnowledgeStorageAllowed: true,
    publicCondensedKnowledgeAllowed: true,
    sourceQualityFlags: ['license-detected', 'attribution-required'],
  },
  'bsd-3-clause': {
    license: 'BSD-3-Clause',
    licenseClass: 'permissive',
    attributionRequired: true,
    shareAlikeRequired: false,
    commercialUseAllowed: true,
    derivativesAllowed: true,
    fullTextStorageAllowed: false,
    condensedKnowledgeStorageAllowed: true,
    publicCondensedKnowledgeAllowed: true,
    sourceQualityFlags: ['license-detected', 'attribution-required'],
  },
}

function normalizeLicenseKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/creative commons/gu, 'cc')
    .replace(/attribution/gu, 'by')
    .replace(/share alike/gu, 'sa')
    .replace(/share-alike/gu, 'sa')
    .replace(/version/gu, '')
    .replace(/[()]/gu, '')
    .replace(/[^a-z0-9.]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
}

function resolveKnownLicense(value) {
  const key = normalizeLicenseKey(value)

  if (KNOWN_LICENSES[key]) {
    return KNOWN_LICENSES[key]
  }

  if (/^cc-by-sa(?:-4(?:\.0)?|-4-0)?$/u.test(key)) {
    return KNOWN_LICENSES['cc-by-sa-4.0']
  }

  if (/^cc-by(?:-4(?:\.0)?|-4-0)?$/u.test(key)) {
    return KNOWN_LICENSES['cc-by-4.0']
  }

  if (/^apache(?:-license)?-2(?:\.0)?$/u.test(key)) {
    return KNOWN_LICENSES['apache-2.0']
  }

  if (/^public-domain$/u.test(key)) {
    return KNOWN_LICENSES.cc0
  }

  return null
}

function normalizeDetectedFrom(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()

  return LICENSE_DETECTED_FROM_VALUES.has(normalized) ? normalized : 'unknown'
}

function normalizeBooleanOverride(value, fallback) {
  if (typeof value === 'boolean') {
    return value
  }

  return fallback
}

function createUnknownPolicy(input = {}) {
  return {
    license: String(input.license || '').trim() || 'UNKNOWN',
    licenseUrl: String(input.licenseUrl || '').trim(),
    licenseDetectedFrom: normalizeDetectedFrom(input.licenseDetectedFrom),
    licenseClass: 'unknown',
    attributionRequired: true,
    shareAlikeRequired: false,
    commercialUseAllowed: false,
    derivativesAllowed: false,
    fullTextStorageAllowed: false,
    condensedKnowledgeStorageAllowed: false,
    publicCondensedKnowledgeAllowed: false,
    reviewRequired: true,
    sourceQualityFlags: ['license-unknown', 'manual-review-required'],
  }
}

function normalizeReasonToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
}

function isPublicExportBlockingQualityFlag(flag) {
  const normalized = String(flag || '')
    .trim()
    .toLowerCase()

  return (
    normalized.startsWith('url-risk:') ||
    normalized.startsWith('network-risk:') ||
    normalized.startsWith('prompt-injection:')
  )
}

function resolveLicensePolicy(input = {}) {
  const known = resolveKnownLicense(input.license)

  if (!known) {
    return createUnknownPolicy(input)
  }

  return {
    ...known,
    licenseUrl: String(input.licenseUrl || '').trim(),
    licenseDetectedFrom: normalizeDetectedFrom(input.licenseDetectedFrom),
    attributionRequired: normalizeBooleanOverride(
      input.attributionRequired,
      known.attributionRequired
    ),
    shareAlikeRequired: normalizeBooleanOverride(
      input.shareAlikeRequired,
      known.shareAlikeRequired
    ),
    commercialUseAllowed: normalizeBooleanOverride(
      input.commercialUseAllowed,
      known.commercialUseAllowed
    ),
    derivativesAllowed: normalizeBooleanOverride(
      input.derivativesAllowed,
      known.derivativesAllowed
    ),
    fullTextStorageAllowed: normalizeBooleanOverride(
      input.fullTextStorageAllowed,
      known.fullTextStorageAllowed
    ),
    condensedKnowledgeStorageAllowed: normalizeBooleanOverride(
      input.condensedKnowledgeStorageAllowed,
      known.condensedKnowledgeStorageAllowed
    ),
    publicCondensedKnowledgeAllowed: normalizeBooleanOverride(
      input.publicCondensedKnowledgeAllowed,
      known.publicCondensedKnowledgeAllowed
    ),
    reviewRequired: false,
    sourceQualityFlags: known.sourceQualityFlags.slice(),
  }
}

function getPublicCondensedKnowledgeBlockReasons(source = {}) {
  const reasons = []
  const qualityFlags = Array.isArray(source.sourceQualityFlags)
    ? source.sourceQualityFlags
    : []

  if (source.licenseClass === 'unknown') {
    reasons.push('license_unknown')
  }
  if (source.reviewRequired) {
    reasons.push('license_review_required')
  }
  if (!source.condensedKnowledgeStorageAllowed) {
    reasons.push('condensed_knowledge_storage_not_allowed')
  }
  if (!source.publicCondensedKnowledgeAllowed) {
    reasons.push('public_condensed_knowledge_not_allowed')
  }
  if (source.accessStatus && source.accessStatus !== 'ok') {
    reasons.push(`source_access_${source.accessStatus}`)
  }
  qualityFlags.forEach((flag) => {
    if (isPublicExportBlockingQualityFlag(flag)) {
      reasons.push(`source_quality_${normalizeReasonToken(flag)}`)
    }
  })

  return Array.from(new Set(reasons))
}

function canExportCondensedKnowledgePublicly(source = {}) {
  return getPublicCondensedKnowledgeBlockReasons(source).length === 0
}

function assertPublicCondensedKnowledgeAllowed(source = {}) {
  const reasons = getPublicCondensedKnowledgeBlockReasons(source)

  if (reasons.length) {
    throw new Error(
      `Source cannot be used for public condensed knowledge: ${reasons.join(
        ', '
      )}`
    )
  }
}

module.exports = {
  KNOWN_LICENSES,
  canExportCondensedKnowledgePublicly,
  assertPublicCondensedKnowledgeAllowed,
  getPublicCondensedKnowledgeBlockReasons,
  isPublicExportBlockingQualityFlag,
  normalizeLicenseKey,
  resolveLicensePolicy,
}
