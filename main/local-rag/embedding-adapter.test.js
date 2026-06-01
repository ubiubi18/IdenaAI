const {
  createMockQwenEmbeddingAdapter,
  deterministicEmbedding,
} = require('./embedding-adapter')

describe('local-rag qwen embedding adapter', () => {
  it('creates deterministic mock embeddings without external models', async () => {
    const adapter = createMockQwenEmbeddingAdapter({
      model: 'qwen-test-embedding',
      dimensions: 8,
    })

    await expect(adapter.embedQuery('private local rag')).resolves.toEqual({
      model: 'qwen-test-embedding',
      dimensions: 8,
      embedding: deterministicEmbedding('private local rag', 8),
    })
    await expect(adapter.embedTexts(['private local rag'])).resolves.toEqual([
      {
        model: 'qwen-test-embedding',
        dimensions: 8,
        embedding: deterministicEmbedding('private local rag', 8),
      },
    ])
  })
})
