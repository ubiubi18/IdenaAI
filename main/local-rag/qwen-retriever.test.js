const {
  QWEN_RAG_PROFILE_LITE_16GB,
  QWEN_RAG_PROFILE_STANDARD_32GB,
} = require('./qwen-profiles')
const {
  retrieveQwenHybrid,
  retrieveQwenProfilesInParallel,
} = require('./qwen-retriever')

describe('local-rag qwen hybrid retriever', () => {
  const chunks = [
    {
      id: 'chunk-a',
      index: 0,
      text: 'Private local RAG keeps user documents on the machine.',
      source: {
        title: 'Private RAG',
      },
    },
    {
      id: 'chunk-b',
      index: 1,
      text: 'Validation autosolve uses hosted and local vision providers.',
      source: {
        title: 'Validation',
      },
    },
    {
      id: 'chunk-c',
      index: 2,
      text: 'Qwen Standard can use reranking and larger context on 32 GB RAM.',
      source: {
        title: 'Qwen profiles',
      },
    },
  ]

  function embeddingAdapterFor(chunkId) {
    return {
      async embedQuery() {
        return {
          model: 'mock-qwen',
          embedding: [1, 0],
        }
      },
      async embedTexts(texts) {
        return texts.map((text) => ({
          model: 'mock-qwen',
          embedding: text.includes(chunkId) ? [1, 0] : [0, 1],
        }))
      },
    }
  }

  it('combines lexical and embedding retrieval for the 16 GB profile', async () => {
    const results = await retrieveQwenHybrid(
      'private local documents',
      chunks,
      {
        profile: '16gb',
        topK: 2,
      }
    )

    expect(results[0]).toEqual(
      expect.objectContaining({
        id: 'chunk-a',
        profileId: QWEN_RAG_PROFILE_LITE_16GB,
        retrievalModes: expect.arrayContaining(['lexical', 'embedding']),
      })
    )
  })

  it('uses 32 GB profile metadata and rerank flag', async () => {
    const results = await retrieveQwenHybrid('qwen reranking context', chunks, {
      profile: '32gb',
      topK: 1,
    })

    expect(results[0]).toEqual(
      expect.objectContaining({
        id: 'chunk-c',
        profileId: QWEN_RAG_PROFILE_STANDARD_32GB,
        retrievalProfile: expect.objectContaining({
          memoryGiB: 32,
          rerank: true,
        }),
      })
    )
  })

  it('runs both Qwen profiles through the parallel helper', async () => {
    const results = await retrieveQwenProfilesInParallel(
      'private local rag',
      chunks,
      {
        topK: 1,
      }
    )

    expect(Object.keys(results)).toEqual([
      QWEN_RAG_PROFILE_LITE_16GB,
      QWEN_RAG_PROFILE_STANDARD_32GB,
    ])
    expect(results[QWEN_RAG_PROFILE_LITE_16GB][0].id).toBe('chunk-a')
    expect(results[QWEN_RAG_PROFILE_STANDARD_32GB][0].id).toBe('chunk-a')
  })

  it('accepts injected embedding adapters for deterministic tests', async () => {
    const results = await retrieveQwenHybrid('hosted local provider', chunks, {
      profile: '16gb',
      topK: 1,
      embeddingAdapter: embeddingAdapterFor('Validation'),
    })

    expect(results[0]).toEqual(
      expect.objectContaining({
        id: 'chunk-b',
        embeddingModel: 'mock-qwen',
      })
    )
  })

  it('preserves same-content chunks from different documents', async () => {
    const duplicateTextChunks = [
      {
        id: 'chunk-same-content',
        documentId: 'doc-a',
        index: 0,
        text: 'Same sourced fact appears in two documents.',
        source: {
          documentId: 'doc-a',
          title: 'Document A',
        },
      },
      {
        id: 'chunk-same-content',
        documentId: 'doc-b',
        index: 0,
        text: 'Same sourced fact appears in two documents.',
        source: {
          documentId: 'doc-b',
          title: 'Document B',
        },
      },
    ]
    const results = await retrieveQwenHybrid(
      'same sourced fact',
      duplicateTextChunks,
      {
        profile: '16gb',
        topK: 5,
      }
    )

    expect(results).toHaveLength(2)
    expect(results.map((item) => item.documentId).sort()).toEqual([
      'doc-a',
      'doc-b',
    ])
  })
})
