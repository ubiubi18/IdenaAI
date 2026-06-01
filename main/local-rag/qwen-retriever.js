const {createMockQwenEmbeddingAdapter} = require('./embedding-adapter')
const {resolveQwenRagProfile} = require('./qwen-profiles')
const {retrieveLexical} = require('./retriever')
const {rankChunksByEmbedding} = require('./vector-index')

function normalizeScore(value) {
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed)) {
    return 0
  }
  return Math.max(0, Math.min(1, parsed))
}

function chunkResultKey(chunk = {}) {
  const source = chunk.source || {}
  return [
    chunk.documentId || source.documentId || source.path || source.title || '',
    chunk.id || '',
    chunk.index == null ? '' : chunk.index,
  ].join('|')
}

function mergeHybridResults({lexicalResults, embeddingResults, profile, topK}) {
  const byId = new Map()
  const retrieval = profile.retrieval || {}
  const lexicalWeight = normalizeScore(retrieval.lexicalWeight)
  const embeddingWeight = normalizeScore(retrieval.embeddingWeight)

  lexicalResults.forEach((chunk) => {
    byId.set(chunkResultKey(chunk), {
      ...chunk,
      lexicalScore: normalizeScore(chunk.score),
      embeddingScore: 0,
      matchedKeywords: chunk.matchedKeywords || [],
      retrievalModes: ['lexical'],
    })
  })

  embeddingResults.forEach((chunk) => {
    const resultKey = chunkResultKey(chunk)
    const existing = byId.get(resultKey)

    if (existing) {
      byId.set(resultKey, {
        ...existing,
        embeddingScore: normalizeScore(chunk.embeddingScore),
        embeddingModel: chunk.embeddingModel,
        retrievalModes: Array.from(
          new Set(existing.retrievalModes.concat('embedding'))
        ),
      })
      return
    }

    byId.set(resultKey, {
      ...chunk,
      lexicalScore: 0,
      embeddingScore: normalizeScore(chunk.embeddingScore),
      matchedKeywords: [],
      retrievalModes: ['embedding'],
    })
  })

  return Array.from(byId.values())
    .map((chunk) => {
      const hybridScore =
        chunk.lexicalScore * lexicalWeight +
        chunk.embeddingScore * embeddingWeight
      const rerankBoost =
        retrieval.rerank && chunk.retrievalModes.length > 1 ? 0.05 : 0

      return {
        ...chunk,
        score: Math.min(1, hybridScore + rerankBoost),
        profileId: profile.id,
        retrievalProfile: {
          id: profile.id,
          label: profile.label,
          memoryGiB: profile.memoryGiB,
          rerank: Boolean(retrieval.rerank),
        },
      }
    })
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

async function retrieveQwenHybrid(query, chunks = [], options = {}) {
  const profile = resolveQwenRagProfile(options.profile || options.profileId)
  const retrieval = profile.retrieval || {}
  const topK = Math.max(
    1,
    Number.parseInt(options.topK || retrieval.topK || 5, 10) || 5
  )
  const candidateK = Math.max(
    topK,
    Number.parseInt(options.candidateK || retrieval.candidateK || topK, 10) ||
      topK
  )
  const embeddingAdapter =
    options.embeddingAdapter ||
    createMockQwenEmbeddingAdapter({
      model: profile.embeddingModel,
      dimensions: profile.embeddingDimensions,
    })

  const [lexicalResults, embeddingResults] = await Promise.all([
    Promise.resolve(retrieveLexical(query, chunks, {topK: candidateK})),
    rankChunksByEmbedding({
      query,
      chunks,
      embeddingAdapter,
      topK: candidateK,
    }),
  ])

  return mergeHybridResults({
    lexicalResults,
    embeddingResults,
    profile,
    topK,
  })
}

async function retrieveQwenProfilesInParallel(
  query,
  chunks = [],
  options = {}
) {
  const profiles = Array.isArray(options.profiles)
    ? options.profiles
    : ['16gb', '32gb']

  const results = await Promise.all(
    profiles.map((profile) =>
      retrieveQwenHybrid(query, chunks, {
        ...options,
        profile,
        embeddingAdapter: options.embeddingAdapterFactory
          ? options.embeddingAdapterFactory(resolveQwenRagProfile(profile))
          : options.embeddingAdapter,
      })
    )
  )

  return profiles.reduce((acc, profile, index) => {
    const resolved = resolveQwenRagProfile(profile)
    acc[resolved.id] = results[index]
    return acc
  }, {})
}

module.exports = {
  chunkResultKey,
  mergeHybridResults,
  retrieveQwenHybrid,
  retrieveQwenProfilesInParallel,
}
