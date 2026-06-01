const {chunkText} = require('./chunker')

describe('local-rag chunker', () => {
  it('returns stable chunk ids and preserves source metadata', () => {
    const text = [
      'IdenaAI keeps local RAG private by default.',
      'Documents are chunked before retrieval.',
      '',
      'A later Qwen adapter can replace lexical search.',
    ].join('\n')
    const options = {
      maxChars: 72,
      overlapChars: 0,
      source: {
        documentId: 'doc-a',
        title: 'Local RAG notes',
      },
    }

    const first = chunkText(text, options)
    const second = chunkText(text, options)

    expect(first).toEqual(second)
    expect(first.length).toBeGreaterThan(1)
    expect(first[0]).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^chunk:[a-f0-9]{32}$/),
        source: {
          documentId: 'doc-a',
          title: 'Local RAG notes',
        },
      })
    )
    expect(first.every((chunk) => chunk.text.length <= 72)).toBe(true)
  })

  it('splits long words without exceeding maxChars', () => {
    const chunks = chunkText('abcdefghij', {
      maxChars: 4,
      overlapChars: 0,
    })

    expect(chunks.map((chunk) => chunk.text)).toEqual(['abcd', 'efgh', 'ij'])
  })

  it('honors explicit zero overlap between chunks', () => {
    const chunks = chunkText('Alpha sentence. Beta sentence.', {
      maxChars: 18,
      overlapChars: 0,
    })

    expect(chunks.map((chunk) => chunk.text)).toEqual([
      'Alpha sentence.',
      'Beta sentence.',
    ])
  })
})
