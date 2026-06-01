const {cosineSimilarity, rankChunksByEmbedding} = require('./vector-index')

describe('local-rag vector index baseline', () => {
  it('scores cosine similarity', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1)
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0)
  })

  it('ranks chunks with an injected embedding adapter', async () => {
    const adapter = {
      async embedQuery() {
        return {
          model: 'mock',
          embedding: [1, 0],
        }
      },
      async embedTexts() {
        return [
          {
            model: 'mock',
            embedding: [0, 1],
          },
          {
            model: 'mock',
            embedding: [1, 0],
          },
        ]
      },
    }

    await expect(
      rankChunksByEmbedding({
        query: 'qwen',
        chunks: [
          {id: 'chunk-a', index: 0, text: 'unrelated'},
          {id: 'chunk-b', index: 1, text: 'qwen rag'},
        ],
        embeddingAdapter: adapter,
        topK: 1,
      })
    ).resolves.toEqual([
      expect.objectContaining({
        id: 'chunk-b',
        embeddingScore: 1,
      }),
    ])
  })
})
