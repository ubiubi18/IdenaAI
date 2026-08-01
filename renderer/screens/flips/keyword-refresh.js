function normalizeNodeKeywordPairs(value) {
  if (!Array.isArray(value)) return []

  return value
    .filter(
      (pair) =>
        pair &&
        typeof pair === 'object' &&
        pair.id != null &&
        Array.isArray(pair.words) &&
        pair.words.length >= 2
    )
    .map((pair) => ({
      ...pair,
      words: pair.words.slice(),
    }))
}

export function resolveNodeKeywordRefresh(context = {}, event = {}) {
  const source = Array.isArray(event.availableKeywords)
    ? event.availableKeywords
    : context.nodeAvailableKeywords
  const availableKeywords = normalizeNodeKeywordPairs(source)
  const firstPair = availableKeywords[0]

  return {
    availableKeywords,
    nodeAvailableKeywords: availableKeywords,
    keywordPairId: firstPair && firstPair.id != null ? firstPair.id : 0,
    keywordSource: 'node',
  }
}
