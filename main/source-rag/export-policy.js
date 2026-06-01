const {getPublicCondensedKnowledgeBlockReasons} = require('./license-policy')

const PUBLIC_REVIEW_STATUSES = new Set(['approved', 'human-reviewed'])

function normalizeArray(value) {
  return Array.isArray(value) ? value : []
}

function normalizeString(value) {
  return String(value || '').trim()
}

function normalizeStringArray(value) {
  return normalizeArray(value).map(normalizeString).filter(Boolean)
}

function mapSourceReferences(sourceReferences = []) {
  return new Map(
    normalizeArray(sourceReferences)
      .filter((source) => source && source.sourceId)
      .map((source) => [source.sourceId, source])
  )
}

function normalizeSourceMap(sourceReferences = []) {
  return sourceReferences instanceof Map
    ? sourceReferences
    : mapSourceReferences(sourceReferences)
}

function getSourcePublicExportBlockReasons(source = {}) {
  const sourceId = normalizeString(source.sourceId) || 'unknown-source'

  return getPublicCondensedKnowledgeBlockReasons(source).map(
    (reason) => `${sourceId}:${reason}`
  )
}

function getKnowledgePublicExportBlockReasons(
  knowledgeItem = {},
  sourceReferences = []
) {
  const knowledgeId =
    normalizeString(knowledgeItem.knowledgeId) || 'unknown-knowledge'
  const reasons = []
  const sourceMap = normalizeSourceMap(sourceReferences)
  const sourceIds = Array.from(
    new Set(normalizeStringArray(knowledgeItem.sourceIds))
  ).sort()
  const licenseStatus = knowledgeItem.licenseStatus || {}

  if (knowledgeItem.visibility !== 'public') {
    reasons.push(`${knowledgeId}:visibility_not_public`)
  }

  if (!PUBLIC_REVIEW_STATUSES.has(knowledgeItem.reviewStatus)) {
    reasons.push(`${knowledgeId}:not_human_reviewed`)
  }

  if (!sourceIds.length) {
    reasons.push(`${knowledgeId}:source_ids_missing`)
  }

  sourceIds.forEach((sourceId) => {
    const source = sourceMap.get(sourceId)

    if (!source) {
      reasons.push(`${knowledgeId}:source_missing:${sourceId}`)
      return
    }

    getPublicCondensedKnowledgeBlockReasons(source).forEach((reason) => {
      reasons.push(`${knowledgeId}:${sourceId}:${reason}`)
    })
  })

  if (
    !licenseStatus.publicExportAllowed ||
    sourceIds.some((sourceId) => {
      const source = sourceMap.get(sourceId)
      return !source || getPublicCondensedKnowledgeBlockReasons(source).length
    })
  ) {
    reasons.push(`${knowledgeId}:license_not_public_exportable`)
  }

  normalizeArray(licenseStatus.blockReasons).forEach((reason) => {
    reasons.push(`${knowledgeId}:${reason}`)
  })

  normalizeArray(knowledgeItem.securityFlags)
    .filter((flag) => flag.startsWith('prompt-injection:'))
    .forEach((flag) => {
      reasons.push(`${knowledgeId}:${flag}`)
    })

  return Array.from(new Set(reasons)).sort()
}

function getAnnotationPublicExportBlockReasons(annotation = {}, targets = {}) {
  const annotationId =
    normalizeString(annotation.annotationId) || 'unknown-annotation'
  const reasons = []
  const targetKey = `${annotation.targetType}:${annotation.targetId}`

  if (!annotation.targetId || !targets[targetKey]) {
    reasons.push(`${annotationId}:target_missing:${targetKey}`)
  }

  normalizeArray(annotation.securityFlags)
    .filter((flag) => flag.startsWith('prompt-injection:'))
    .forEach((flag) => {
      reasons.push(`${annotationId}:${flag}`)
    })

  return Array.from(new Set(reasons)).sort()
}

function mapExportTargets({sourceReferences = [], knowledgeItems = []} = {}) {
  const targets = {}

  normalizeArray(sourceReferences).forEach((source) => {
    if (source && source.sourceId) {
      targets[`source:${source.sourceId}`] = true
    }
  })
  normalizeArray(knowledgeItems).forEach((item) => {
    if (item && item.knowledgeId) {
      targets[`knowledge:${item.knowledgeId}`] = true
    }
  })

  return targets
}

function getPublicExportBlockReasons({
  sourceReferences = [],
  knowledgeItems = [],
  annotations = [],
} = {}) {
  const sourceMap = mapSourceReferences(sourceReferences)
  const targets = mapExportTargets({sourceReferences, knowledgeItems})

  return Array.from(
    new Set(
      normalizeArray(sourceReferences)
        .flatMap(getSourcePublicExportBlockReasons)
        .concat(
          normalizeArray(knowledgeItems).flatMap((knowledgeItem) =>
            getKnowledgePublicExportBlockReasons(knowledgeItem, sourceMap)
          )
        )
        .concat(
          normalizeArray(annotations).flatMap((annotation) =>
            getAnnotationPublicExportBlockReasons(annotation, targets)
          )
        )
    )
  ).sort()
}

function canExportPublicShard(payload = {}) {
  return getPublicExportBlockReasons(payload).length === 0
}

function assertPublicShardExportAllowed(payload = {}) {
  const reasons = getPublicExportBlockReasons(payload)

  if (reasons.length) {
    throw new Error(`Public shard export blocked: ${reasons.join(', ')}`)
  }
}

module.exports = {
  PUBLIC_REVIEW_STATUSES,
  assertPublicShardExportAllowed,
  canExportPublicShard,
  getAnnotationPublicExportBlockReasons,
  getKnowledgePublicExportBlockReasons,
  getPublicExportBlockReasons,
  getSourcePublicExportBlockReasons,
}
