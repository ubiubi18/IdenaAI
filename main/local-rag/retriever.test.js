const {retrieveLexical} = require('./retriever')

describe('local-rag lexical retriever', () => {
  const chunks = [
    {
      id: 'chunk-a',
      index: 0,
      text: 'Hosted providers solve validation flips.',
      source: {
        documentId: 'doc-hosted',
      },
    },
    {
      id: 'chunk-b',
      index: 1,
      text: 'Private local RAG keeps documents and embeddings on the machine.',
      source: {
        documentId: 'doc-private',
      },
    },
    {
      id: 'chunk-c',
      index: 2,
      text: 'Public shards need signed manifests and source attribution.',
      source: {
        documentId: 'doc-public',
      },
    },
  ]

  it('returns topK chunks by deterministic keyword overlap', () => {
    const results = retrieveLexical('private documents embeddings', chunks, {
      topK: 1,
    })

    expect(results).toHaveLength(1)
    expect(results[0]).toEqual(
      expect.objectContaining({
        id: 'chunk-b',
        score: 1,
        matchedKeywords: ['private', 'documents', 'embeddings'],
        source: {
          documentId: 'doc-private',
        },
      })
    )
  })

  it('excludes chunks without keyword overlap', () => {
    expect(retrieveLexical('reranking qwen', chunks, {topK: 3})).toEqual([])
  })
})
