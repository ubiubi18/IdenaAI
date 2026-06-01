const DEFAULT_TOP_K = 5

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
  const keywords = matches.filter((token) => !STOP_WORDS.has(token))

  return keywords.length ? keywords : matches
}

function uniqueTokens(text) {
  return Array.from(new Set(tokenize(text)))
}

function annotationText(annotations = []) {
  return (Array.isArray(annotations) ? annotations : [])
    .map((annotation) => JSON.stringify(annotation.payload || {}))
    .join('\n')
}

function scoreKnowledgeItem(queryTokens, item, annotations) {
  const itemTokens = new Set(
    tokenize(
      `${item && item.text ? item.text : ''}\n${annotationText(annotations)}`
    )
  )
  const matchedKeywords = queryTokens.filter((token) => itemTokens.has(token))

  if (!matchedKeywords.length) {
    return {
      score: 0,
      matchedKeywords: [],
    }
  }

  return {
    score: matchedKeywords.length / queryTokens.length,
    matchedKeywords,
  }
}

function mapAnnotationsByTarget(annotations = []) {
  return (Array.isArray(annotations) ? annotations : []).reduce(
    (acc, annotation) => {
      const targetId = annotation && annotation.targetId
      if (!targetId) {
        return acc
      }

      if (!acc[targetId]) {
        acc[targetId] = []
      }
      acc[targetId].push(annotation)
      return acc
    },
    {}
  )
}

function retrieveKnowledgeLexical(query, knowledgeItems = [], options = {}) {
  const topK = Math.max(
    1,
    Number.parseInt(options.topK || DEFAULT_TOP_K, 10) || DEFAULT_TOP_K
  )
  const queryTokens = uniqueTokens(query)
  const annotationsByTarget = mapAnnotationsByTarget(options.annotations)

  if (!queryTokens.length || !Array.isArray(knowledgeItems)) {
    return []
  }

  return knowledgeItems
    .map((item) => {
      const annotations = annotationsByTarget[item.knowledgeId] || []
      const result = scoreKnowledgeItem(queryTokens, item, annotations)
      return {
        ...item,
        score: result.score,
        matchedKeywords: result.matchedKeywords,
        annotationCount: annotations.length,
      }
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }
      return String(left.knowledgeId || '').localeCompare(
        String(right.knowledgeId || '')
      )
    })
    .slice(0, topK)
}

module.exports = {
  DEFAULT_TOP_K,
  retrieveKnowledgeLexical,
  tokenize,
}
