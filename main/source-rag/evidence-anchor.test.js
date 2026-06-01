const {
  MAX_EVIDENCE_QUOTE_CHARS,
  createEvidenceAnchor,
  hashEvidenceAnchor,
  normalizeEvidenceAnchors,
} = require('./evidence-anchor')

describe('source-rag evidence anchor', () => {
  it('normalizes anchors and derives paragraph hash from short quotes', () => {
    const anchor = createEvidenceAnchor({
      sourceId: 'source:a',
      section: 'Intro',
      quote: 'Source-backed RAG keeps citations attached.',
      anchorConfidence: 1.5,
    })

    expect(anchor).toEqual(
      expect.objectContaining({
        sourceId: 'source:a',
        section: 'Intro',
        quote: 'Source-backed RAG keeps citations attached.',
        quoteCharLength: 43,
        paragraphHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        anchorConfidence: 1,
      })
    )
  })

  it('requires enough anchor detail to reassess a source', () => {
    expect(() =>
      createEvidenceAnchor({
        sourceId: 'source:a',
      })
    ).toThrow('Evidence anchor needs')
  })

  it('enforces quote length limits', () => {
    expect(() =>
      createEvidenceAnchor({
        sourceId: 'source:a',
        quote: 'x'.repeat(MAX_EVIDENCE_QUOTE_CHARS + 1),
      })
    ).toThrow(`Evidence quote exceeds ${MAX_EVIDENCE_QUOTE_CHARS} characters`)
  })

  it('validates source and paragraph hash metadata', () => {
    const contentHash =
      'BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD'

    expect(
      createEvidenceAnchor({
        sourceId: 'source:a',
        paragraphHash: contentHash,
        sourceContentHash: contentHash,
      })
    ).toEqual(
      expect.objectContaining({
        paragraphHash:
          'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
        sourceContentHash:
          'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      })
    )

    expect(() =>
      createEvidenceAnchor({
        sourceId: 'source:a',
        paragraphHash: 'abc',
      })
    ).toThrow('paragraphHash must be a lowercase sha256 hex digest')
  })

  it('returns stable anchor hashes and sorted anchor lists', () => {
    const left = {
      sourceId: 'source:b',
      path: 'p[2]',
      quote: 'Second paragraph.',
    }
    const right = {
      sourceId: 'source:a',
      path: 'p[1]',
      quote: 'First paragraph.',
    }

    expect(hashEvidenceAnchor(left)).toBe(hashEvidenceAnchor(left))
    expect(
      normalizeEvidenceAnchors([left, right]).map((item) => item.path)
    ).toEqual(['p[1]', 'p[2]'])
  })
})
