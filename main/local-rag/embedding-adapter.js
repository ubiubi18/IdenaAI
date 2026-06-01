const {sha256Text} = require('./hash')

function normalizeDimensions(value, fallback = 64) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function l2Normalize(vector) {
  const magnitude = Math.sqrt(
    vector.reduce((sum, value) => sum + value * value, 0)
  )

  if (!magnitude) {
    return vector.slice()
  }

  return vector.map((value) => value / magnitude)
}

function deterministicEmbedding(text, dimensions = 64) {
  const size = normalizeDimensions(dimensions)
  const vector = Array.from({length: size}, () => 0)
  const tokens = String(text || '')
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9_-]*/g) || ['']

  tokens.forEach((token) => {
    const hash = sha256Text(token)

    for (let offset = 0; offset < hash.length; offset += 8) {
      const bucket = Number.parseInt(hash.slice(offset, offset + 6), 16) % size
      const sign = Number.parseInt(hash.slice(offset + 6, offset + 8), 16) % 2
      vector[bucket] += sign ? 1 : -1
    }
  })

  return l2Normalize(vector)
}

function createMockQwenEmbeddingAdapter({
  model = 'qwen-embedding-mock',
  dimensions = 64,
} = {}) {
  const normalizedDimensions = normalizeDimensions(dimensions)

  async function embedTexts(texts = []) {
    return texts.map((text) => ({
      model,
      dimensions: normalizedDimensions,
      embedding: deterministicEmbedding(text, normalizedDimensions),
    }))
  }

  async function embedQuery(text) {
    const [result] = await embedTexts([text])
    return result
  }

  return {
    type: 'mock-qwen-embedding-adapter',
    model,
    dimensions: normalizedDimensions,
    embedTexts,
    embedQuery,
  }
}

module.exports = {
  createMockQwenEmbeddingAdapter,
  deterministicEmbedding,
  l2Normalize,
  normalizeDimensions,
}
