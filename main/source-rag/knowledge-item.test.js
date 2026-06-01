const {createSourceReference} = require('./source-reference')
const {
  createKnowledgeItem,
  deriveKnowledgeLicenseStatus,
  hashKnowledgeItem,
  normalizeKnowledgeType,
} = require('./knowledge-item')

describe('source-rag knowledge item', () => {
  const now = () => '2026-01-01T00:00:00.000Z'

  function source(overrides = {}) {
    return createSourceReference(
      {
        sourceType: 'public-docs',
        canonicalUrl: 'https://example.com/docs',
        title: 'Example docs',
        license: 'MIT',
        licenseDetectedFrom: 'metadata',
        accessStatus: 'ok',
        ...overrides,
      },
      {now}
    )
  }

  function item(overrides = {}) {
    const sourceRef = source()
    return {
      type: 'summary',
      text: 'Source-backed RAG stores condensed knowledge with anchors.',
      sourceIds: [sourceRef.sourceId],
      evidenceAnchors: [
        {
          sourceId: sourceRef.sourceId,
          section: 'Intro',
          quote: 'Source-backed RAG stores condensed knowledge.',
        },
      ],
      createdBy: {
        type: 'human',
        id: 'tester',
      },
      ...overrides,
      sourceReferences: overrides.sourceReferences || [sourceRef],
    }
  }

  it('normalizes knowledge type aliases', () => {
    expect(normalizeKnowledgeType('qa')).toBe('Q&A')
    expect(normalizeKnowledgeType('unknown')).toBe('claim')
  })

  it('creates stable knowledge ids independent of source id order', () => {
    const firstSource = source({
      canonicalUrl: 'https://example.com/a',
    })
    const secondSource = source({
      canonicalUrl: 'https://example.com/b',
    })
    const base = {
      type: 'claim',
      text: 'Two docs support the same claim.',
      evidenceAnchors: [
        {
          sourceId: secondSource.sourceId,
          path: 'p[2]',
        },
        {
          sourceId: firstSource.sourceId,
          path: 'p[1]',
        },
      ],
      sourceReferences: [firstSource, secondSource],
    }

    const first = createKnowledgeItem(
      {
        ...base,
        sourceIds: [firstSource.sourceId, secondSource.sourceId],
      },
      {now}
    )
    const second = createKnowledgeItem(
      {
        ...base,
        sourceIds: [secondSource.sourceId, firstSource.sourceId],
      },
      {now}
    )

    expect(first.knowledgeId).toBe(second.knowledgeId)
    expect(
      hashKnowledgeItem(first, {sourceReferences: [firstSource, secondSource]})
    ).toBe(
      hashKnowledgeItem(second, {sourceReferences: [firstSource, secondSource]})
    )
  })

  it('hashes persisted knowledge items without requiring source references again', () => {
    const sourceRef = source()
    const persisted = createKnowledgeItem(
      item({
        sourceIds: [sourceRef.sourceId],
        sourceReferences: [sourceRef],
        evidenceAnchors: [
          {
            sourceId: sourceRef.sourceId,
            path: 'p[1]',
          },
        ],
      }),
      {now}
    )

    expect(hashKnowledgeItem(persisted)).toBe(hashKnowledgeItem(persisted))
  })

  it('includes persisted security flags in knowledge item hashes', () => {
    const sourceRef = source()
    const persisted = createKnowledgeItem(
      item({
        sourceIds: [sourceRef.sourceId],
        sourceReferences: [sourceRef],
        evidenceAnchors: [
          {
            sourceId: sourceRef.sourceId,
            path: 'p[1]',
          },
        ],
      }),
      {now}
    )

    expect(hashKnowledgeItem(persisted)).not.toBe(
      hashKnowledgeItem({
        ...persisted,
        securityFlags: ['prompt-injection:system-prompt-exfiltration'],
      })
    )
  })

  it('ignores caller-provided knowledge ids by default', () => {
    const sourceRef = source()
    const first = createKnowledgeItem(
      item({
        knowledgeId: 'knowledge:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        sourceIds: [sourceRef.sourceId],
        sourceReferences: [sourceRef],
        evidenceAnchors: [
          {
            sourceId: sourceRef.sourceId,
            path: 'p[1]',
          },
        ],
      }),
      {now}
    )
    const second = createKnowledgeItem(
      item({
        sourceIds: [sourceRef.sourceId],
        sourceReferences: [sourceRef],
        evidenceAnchors: [
          {
            sourceId: sourceRef.sourceId,
            path: 'p[1]',
          },
        ],
      }),
      {now}
    )

    expect(first.knowledgeId).toBe(second.knowledgeId)
    expect(first.knowledgeId).not.toBe(
      'knowledge:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    )
  })

  it('allows validated explicit knowledge ids only when requested', () => {
    const sourceRef = source()
    expect(
      createKnowledgeItem(
        item({
          knowledgeId: 'knowledge:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          sourceIds: [sourceRef.sourceId],
          sourceReferences: [sourceRef],
          evidenceAnchors: [
            {
              sourceId: sourceRef.sourceId,
              path: 'p[1]',
            },
          ],
        }),
        {
          now,
          allowExplicitKnowledgeId: true,
        }
      ).knowledgeId
    ).toBe('knowledge:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')

    expect(() =>
      createKnowledgeItem(
        item({
          knowledgeId: 'knowledge:not-valid',
          sourceIds: [sourceRef.sourceId],
          sourceReferences: [sourceRef],
          evidenceAnchors: [
            {
              sourceId: sourceRef.sourceId,
              path: 'p[1]',
            },
          ],
        }),
        {
          now,
          allowExplicitKnowledgeId: true,
        }
      )
    ).toThrow('knowledgeId must be a knowledge: prefixed lowercase hex id')
  })

  it('inherits license status from linked sources', () => {
    const sourceRef = source({
      license: 'CC-BY-SA-4.0',
    })
    const knowledgeItem = createKnowledgeItem(
      item({
        sourceIds: [sourceRef.sourceId],
        sourceReferences: [sourceRef],
        evidenceAnchors: [
          {
            sourceId: sourceRef.sourceId,
            path: 'p[1]',
          },
        ],
      }),
      {now}
    )

    expect(knowledgeItem.licenseStatus).toEqual(
      expect.objectContaining({
        status: 'ok',
        inheritedFromSourceIds: [sourceRef.sourceId],
        sourceLicenses: ['CC-BY-SA-4.0'],
        publicExportAllowed: true,
      })
    )
  })

  it('rejects condensed knowledge for unknown-license sources by default', () => {
    const sourceRef = source({
      license: '',
      accessStatus: 'ok',
    })

    expect(() =>
      createKnowledgeItem(
        item({
          sourceIds: [sourceRef.sourceId],
          sourceReferences: [sourceRef],
          evidenceAnchors: [
            {
              sourceId: sourceRef.sourceId,
              path: 'p[1]',
            },
          ],
        }),
        {now}
      )
    ).toThrow('Condensed knowledge storage is not allowed')
  })

  it('rejects evidence anchors that are not linked to the item sources', () => {
    expect(() =>
      createKnowledgeItem(
        item({
          evidenceAnchors: [
            {
              sourceId: 'source:other',
              path: 'p[1]',
            },
          ],
        }),
        {now}
      )
    ).toThrow('Evidence anchor sourceId is not linked')
  })

  it('blocks public visibility when license status is not public-exportable', () => {
    const sourceRef = source({
      accessStatus: 'changed',
    })

    expect(() =>
      createKnowledgeItem(
        item({
          visibility: 'public',
          sourceIds: [sourceRef.sourceId],
          sourceReferences: [sourceRef],
          evidenceAnchors: [
            {
              sourceId: sourceRef.sourceId,
              path: 'p[1]',
            },
          ],
        }),
        {now}
      )
    ).toThrow('Knowledge item cannot be public')
  })

  it('blocks public visibility for non-public source URLs', () => {
    const sourceRef = source({
      canonicalUrl: 'http://localhost:3000/private-docs',
    })

    expect(() =>
      createKnowledgeItem(
        item({
          visibility: 'public',
          sourceIds: [sourceRef.sourceId],
          sourceReferences: [sourceRef],
          evidenceAnchors: [
            {
              sourceId: sourceRef.sourceId,
              path: 'p[1]',
            },
          ],
        }),
        {now}
      )
    ).toThrow('Knowledge item cannot be public')
  })

  it('marks missing source references as review-required', () => {
    expect(deriveKnowledgeLicenseStatus(['source:missing'], [])).toEqual(
      expect.objectContaining({
        status: 'review-required',
        publicExportAllowed: false,
        blockReasons: ['source_missing:source:missing'],
      })
    )
  })
})
