const {createAnnotation} = require('./annotation')

const DEFAULT_AI_ANNOTATION_PROVIDER = 'local-qwen-mock'
const DEFAULT_AI_ANNOTATION_MODEL = 'qwen-lite-16gb-annotation-mock'
const DEFAULT_AI_ANNOTATION_PROMPT_VERSION = 'source-rag-annotation-v1'

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'to',
  'with',
])

function tokenize(text) {
  const normalized = String(text || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
  const matches = normalized.match(/[a-z0-9][a-z0-9_-]*/gu) || []
  return matches.filter((token) => !STOP_WORDS.has(token))
}

function extractTopics(text, limit = 6) {
  const counts = tokenize(text).reduce((acc, token) => {
    acc[token] = (acc[token] || 0) + 1
    return acc
  }, {})

  return Object.keys(counts)
    .sort((left, right) => {
      if (counts[right] !== counts[left]) {
        return counts[right] - counts[left]
      }
      return left.localeCompare(right)
    })
    .slice(0, limit)
}

function truncateText(text, maxChars) {
  const normalized = String(text || '')
    .trim()
    .replace(/\s+/gu, ' ')
  if (normalized.length <= maxChars) {
    return normalized
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trim()}...`
}

function sourceTitles(sourceReferences = [], sourceIds = []) {
  const sourceMap = new Map(
    (Array.isArray(sourceReferences) ? sourceReferences : []).map((source) => [
      source.sourceId,
      source,
    ])
  )

  return sourceIds.map((sourceId) => {
    const source = sourceMap.get(sourceId)
    return (source && (source.title || source.canonicalUrl)) || sourceId
  })
}

function createMockAiKnowledgeAnnotator({
  provider = DEFAULT_AI_ANNOTATION_PROVIDER,
  model = DEFAULT_AI_ANNOTATION_MODEL,
  promptVersion = DEFAULT_AI_ANNOTATION_PROMPT_VERSION,
  now = () => new Date(),
} = {}) {
  function createBaseAnnotation(knowledgeItem, annotation) {
    return createAnnotation(
      {
        targetType: 'knowledge',
        targetId: knowledgeItem.knowledgeId,
        annotatorType: 'ai',
        provider,
        model,
        promptVersion,
        ...annotation,
      },
      {now}
    )
  }

  async function annotateKnowledgeItem(knowledgeItem = {}, context = {}) {
    const text = String(knowledgeItem.text || '').trim()
    const sourceIds = Array.isArray(knowledgeItem.sourceIds)
      ? knowledgeItem.sourceIds
      : []
    const topics = extractTopics(text)
    const titles = sourceTitles(context.sourceReferences, sourceIds)
    const annotations = [
      createBaseAnnotation(knowledgeItem, {
        annotationType: 'summary',
        payload: {
          summary: truncateText(text, 220),
          sourceIds,
          sourceTitles: titles,
          evidenceAnchorCount: Array.isArray(knowledgeItem.evidenceAnchors)
            ? knowledgeItem.evidenceAnchors.length
            : 0,
        },
        confidence: 0.74,
      }),
      createBaseAnnotation(knowledgeItem, {
        annotationType: 'topics',
        payload: {
          topics,
        },
        confidence: topics.length ? 0.7 : 0.2,
      }),
      createBaseAnnotation(knowledgeItem, {
        annotationType: 'Q&A',
        payload: {
          questions: [
            {
              question: 'What source-backed knowledge is captured here?',
              answer: truncateText(text, 180),
              sourceIds,
            },
          ],
        },
        confidence: 0.68,
      }),
      createBaseAnnotation(knowledgeItem, {
        annotationType: 'quality-review',
        payload: {
          reviewStatusSuggestion:
            knowledgeItem.reviewStatus === 'approved'
              ? 'keep-approved'
              : 'human-review-recommended',
          publicExportCandidate: Boolean(
            knowledgeItem.licenseStatus &&
              knowledgeItem.licenseStatus.publicExportAllowed &&
              knowledgeItem.visibility === 'public'
          ),
        },
        confidence: 0.62,
      }),
    ]

    if (
      (Array.isArray(knowledgeItem.securityFlags) &&
        knowledgeItem.securityFlags.length) ||
      !(
        knowledgeItem.licenseStatus &&
        knowledgeItem.licenseStatus.publicExportAllowed
      )
    ) {
      annotations.push(
        createBaseAnnotation(knowledgeItem, {
          annotationType: 'warning',
          payload: {
            securityFlags: knowledgeItem.securityFlags || [],
            licenseStatus: knowledgeItem.licenseStatus || null,
            warnings: [
              ...(knowledgeItem.securityFlags || []),
              !(
                knowledgeItem.licenseStatus &&
                knowledgeItem.licenseStatus.publicExportAllowed
              )
                ? 'license-or-source-review-required'
                : '',
            ].filter(Boolean),
          },
          securityFlags: knowledgeItem.securityFlags || [],
          confidence: 0.8,
        })
      )
    }

    return annotations
  }

  return {
    provider,
    model,
    promptVersion,
    annotateKnowledgeItem,
  }
}

async function runAiKnowledgeAnnotationJob({
  knowledgeItems = [],
  sourceReferences = [],
  annotationStore,
  annotator = createMockAiKnowledgeAnnotator(),
  duplicatePolicy = 'return-existing',
} = {}) {
  const createdAnnotations = []

  for (const knowledgeItem of Array.isArray(knowledgeItems)
    ? knowledgeItems
    : []) {
    const annotations = await annotator.annotateKnowledgeItem(knowledgeItem, {
      sourceReferences,
    })

    for (const annotation of annotations) {
      createdAnnotations.push(
        annotationStore
          ? await annotationStore.addAnnotation(annotation, {
              allowExisting: duplicatePolicy === 'replace',
              returnExisting: duplicatePolicy === 'return-existing',
            })
          : annotation
      )
    }
  }

  return {
    provider: annotator.provider,
    model: annotator.model,
    promptVersion: annotator.promptVersion,
    annotationCount: createdAnnotations.length,
    annotations: createdAnnotations,
  }
}

module.exports = {
  DEFAULT_AI_ANNOTATION_MODEL,
  DEFAULT_AI_ANNOTATION_PROMPT_VERSION,
  DEFAULT_AI_ANNOTATION_PROVIDER,
  createMockAiKnowledgeAnnotator,
  extractTopics,
  runAiKnowledgeAnnotationJob,
}
