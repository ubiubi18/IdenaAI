const {createIndexCard} = require('./index-card')

describe('local-rag index card', () => {
  it('generates a deterministic draft manifest from chunk hashes', () => {
    const chunks = [
      {
        id: 'chunk-a',
        index: 0,
        contentHash: 'hash-a',
        documentId: 'doc-a',
        text: 'Private text should not be copied into the card.',
      },
      {
        id: 'chunk-b',
        index: 1,
        contentHash: 'hash-b',
        documentId: 'doc-a',
        text: 'More private text.',
      },
    ]
    const card = createIndexCard({
      title: 'IdenaAI local RAG',
      language: 'en',
      topics: ['idena', 'rag', 'idena'],
      chunks,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      license: 'CC-BY-4.0',
      visibility: 'public',
    })

    expect(card).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        type: 'idena-local-rag-index-card',
        collectionId: expect.stringMatching(/^collection:[a-f0-9]{24}$/),
        owner: 'local-owner-placeholder',
        title: 'IdenaAI local RAG',
        language: 'en',
        topics: ['idena', 'rag'],
        chunkCount: 2,
        embeddingModel: 'qwen-embedding-placeholder',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        license: 'CC-BY-4.0',
        visibility: 'public',
      })
    )
    expect(card.contentRoot).toEqual({
      algorithm: 'sha256-json',
      hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(JSON.stringify(card)).not.toContain('Private text')
  })
})
