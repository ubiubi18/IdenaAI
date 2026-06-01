const {retrieveKnowledgeLexical} = require('./retriever')

describe('source-rag retriever', () => {
  it('retrieves knowledge items using text and AI annotation payloads', () => {
    const knowledgeItems = [
      {
        knowledgeId: 'knowledge:a',
        text: 'Local RAG keeps source references.',
      },
      {
        knowledgeId: 'knowledge:b',
        text: 'Validation rehearsal uses deterministic tests.',
      },
    ]
    const annotations = [
      {
        targetId: 'knowledge:b',
        payload: {
          topics: ['qwen', 'annotations'],
        },
      },
    ]

    expect(
      retrieveKnowledgeLexical('qwen annotation', knowledgeItems, {
        annotations,
        topK: 1,
      })
    ).toEqual([
      expect.objectContaining({
        knowledgeId: 'knowledge:b',
        annotationCount: 1,
      }),
    ])
  })
})
