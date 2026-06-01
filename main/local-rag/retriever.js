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
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  const matches = normalized.match(/[a-z0-9][a-z0-9_-]*/g) || []
  const keywords = matches.filter((token) => !STOP_WORDS.has(token))

  return keywords.length ? keywords : matches
}

function uniqueTokens(text) {
  return Array.from(new Set(tokenize(text)))
}

function scoreChunk(queryTokens, chunk) {
  const chunkTokens = new Set(tokenize(chunk && chunk.text))
  const matchedKeywords = queryTokens.filter((token) => chunkTokens.has(token))

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

function retrieveLexical(query, chunks = [], options = {}) {
  const topK = Math.max(
    1,
    Number.parseInt(options.topK || DEFAULT_TOP_K, 10) || DEFAULT_TOP_K
  )
  const queryTokens = uniqueTokens(query)

  if (!queryTokens.length || !Array.isArray(chunks)) {
    return []
  }

  return chunks
    .map((chunk) => {
      const result = scoreChunk(queryTokens, chunk)
      return {
        ...chunk,
        score: result.score,
        matchedKeywords: result.matchedKeywords,
        source: chunk && chunk.source ? {...chunk.source} : {},
      }
    })
    .filter((chunk) => chunk.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }

      if ((left.index || 0) !== (right.index || 0)) {
        return (left.index || 0) - (right.index || 0)
      }

      return String(left.id || '').localeCompare(String(right.id || ''))
    })
    .slice(0, topK)
}

module.exports = {
  DEFAULT_TOP_K,
  retrieveLexical,
  tokenize,
}
