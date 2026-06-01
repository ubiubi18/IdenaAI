function dotProduct(left = [], right = []) {
  const length = Math.min(left.length, right.length)
  let score = 0

  for (let index = 0; index < length; index += 1) {
    score += left[index] * right[index]
  }

  return score
}

function cosineSimilarity(left = [], right = []) {
  const leftMagnitude = Math.sqrt(
    left.reduce((sum, value) => sum + value * value, 0)
  )
  const rightMagnitude = Math.sqrt(
    right.reduce((sum, value) => sum + value * value, 0)
  )

  if (!leftMagnitude || !rightMagnitude) {
    return 0
  }

  return dotProduct(left, right) / (leftMagnitude * rightMagnitude)
}

async function rankChunksByEmbedding({
  query,
  chunks = [],
  embeddingAdapter,
  topK = 5,
}) {
  if (!embeddingAdapter || typeof embeddingAdapter.embedQuery !== 'function') {
    throw new Error('embeddingAdapter.embedQuery is required')
  }

  if (!embeddingAdapter || typeof embeddingAdapter.embedTexts !== 'function') {
    throw new Error('embeddingAdapter.embedTexts is required')
  }

  const limit = Math.max(1, Number.parseInt(topK, 10) || 5)
  const safeChunks = Array.isArray(chunks) ? chunks : []
  const [queryEmbedding, chunkEmbeddings] = await Promise.all([
    embeddingAdapter.embedQuery(query),
    embeddingAdapter.embedTexts(safeChunks.map((chunk) => chunk.text || '')),
  ])

  return safeChunks
    .map((chunk, index) => {
      const embeddingScore = cosineSimilarity(
        queryEmbedding.embedding,
        chunkEmbeddings[index] && chunkEmbeddings[index].embedding
      )

      return {
        ...chunk,
        embeddingScore,
        embeddingModel: chunkEmbeddings[index] && chunkEmbeddings[index].model,
        source: chunk && chunk.source ? {...chunk.source} : {},
      }
    })
    .filter((chunk) => chunk.embeddingScore > 0)
    .sort((left, right) => {
      if (right.embeddingScore !== left.embeddingScore) {
        return right.embeddingScore - left.embeddingScore
      }

      if ((left.index || 0) !== (right.index || 0)) {
        return (left.index || 0) - (right.index || 0)
      }

      return String(left.id || '').localeCompare(String(right.id || ''))
    })
    .slice(0, limit)
}

module.exports = {
  cosineSimilarity,
  dotProduct,
  rankChunksByEmbedding,
}
