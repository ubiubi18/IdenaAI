const {
  createSourceReference,
  detectUrlRiskFlags,
  hashFetchedSourceContent,
  hashSourceReference,
  isNonPublicHostname,
  normalizeSourceType,
  normalizeUrl,
} = require('./source-reference')
const {sha256Json} = require('./hash')

describe('source-rag source reference', () => {
  const now = () => '2026-01-01T00:00:00.000Z'

  it('normalizes canonical URLs and removes tracking parameters', () => {
    expect(
      normalizeUrl(
        'HTTPS://Example.COM:443/docs/Intro?utm_source=x&b=2&a=1#section'
      )
    ).toBe('https://example.com/docs/Intro?a=1&b=2')
  })

  it('rejects source URLs with embedded credentials', () => {
    expect(() => normalizeUrl('https://user:pass@example.com/docs')).toThrow(
      'Source URL must not include embedded credentials'
    )
  })

  it('detects non-public and plain HTTP source URL risks', () => {
    expect(isNonPublicHostname('localhost')).toBe(true)
    expect(isNonPublicHostname('127.0.0.1')).toBe(true)
    expect(isNonPublicHostname('[::1]')).toBe(true)
    expect(isNonPublicHostname('docs.example.com')).toBe(false)
    expect(
      detectUrlRiskFlags('http://localhost:3000/docs', {
        role: 'canonical',
      })
    ).toEqual([
      'url-risk:canonical-plain-http',
      'url-risk:canonical-non-public-host',
    ])
  })

  it('normalizes common source type aliases', () => {
    expect(normalizeSourceType('github')).toBe('github-repo')
    expect(normalizeSourceType('docs')).toBe('public-docs')
    expect(normalizeSourceType('grokpedia')).toBe('grokipedia')
  })

  it('creates stable source ids from normalized canonical URLs', () => {
    const first = createSourceReference(
      {
        sourceType: 'public-docs',
        canonicalUrl:
          'HTTPS://Example.COM/docs/Intro?utm_campaign=ignored&b=2&a=1#top',
        title: 'First title',
        license: 'MIT',
        licenseDetectedFrom: 'metadata',
      },
      {now}
    )
    const second = createSourceReference(
      {
        sourceType: 'public-docs',
        canonicalUrl: 'https://example.com/docs/Intro?a=1&b=2',
        title: 'Changed title',
        license: 'MIT',
        licenseDetectedFrom: 'metadata',
      },
      {now}
    )

    expect(first.sourceId).toBe(second.sourceId)
    expect(first.canonicalUrl).toBe('https://example.com/docs/Intro?a=1&b=2')
    expect(first.retrievedAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('adds URL risk flags to source quality flags', () => {
    const source = createSourceReference(
      {
        sourceType: 'public-docs',
        canonicalUrl: 'http://127.0.0.1:3000/docs',
        versionUrl: 'http://example.com/version',
        license: 'MIT',
        licenseDetectedFrom: 'metadata',
      },
      {now}
    )

    expect(source.sourceQualityFlags).toEqual(
      expect.arrayContaining([
        'url-risk:canonical-non-public-host',
        'url-risk:canonical-plain-http',
        'url-risk:version-plain-http',
      ])
    )
  })

  it('ignores caller-provided source ids by default', () => {
    const first = createSourceReference(
      {
        sourceId: 'source:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        sourceType: 'public-docs',
        canonicalUrl: 'https://example.com/docs',
        license: 'MIT',
      },
      {now}
    )
    const second = createSourceReference(
      {
        sourceType: 'public-docs',
        canonicalUrl: 'https://example.com/docs',
        license: 'MIT',
      },
      {now}
    )

    expect(first.sourceId).toBe(second.sourceId)
    expect(first.sourceId).not.toBe('source:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
  })

  it('allows validated explicit source ids only when requested', () => {
    expect(
      createSourceReference(
        {
          sourceId: 'source:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          sourceType: 'public-docs',
          canonicalUrl: 'https://example.com/docs',
          license: 'MIT',
        },
        {
          now,
          allowExplicitSourceId: true,
        }
      ).sourceId
    ).toBe('source:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')

    expect(() =>
      createSourceReference(
        {
          sourceId: 'source:not-valid',
          sourceType: 'public-docs',
          canonicalUrl: 'https://example.com/docs',
          license: 'MIT',
        },
        {
          now,
          allowExplicitSourceId: true,
        }
      )
    ).toThrow('sourceId must be a source: prefixed lowercase hex id')
  })

  it('uses version URLs as part of source identity', () => {
    const first = createSourceReference(
      {
        sourceType: 'wikipedia',
        canonicalUrl: 'https://en.wikipedia.org/wiki/Idena',
        versionUrl: 'https://en.wikipedia.org/w/index.php?oldid=1&title=Idena',
        license: 'CC-BY-SA-4.0',
      },
      {now}
    )
    const second = createSourceReference(
      {
        sourceType: 'wikipedia',
        canonicalUrl: 'https://en.wikipedia.org/wiki/Idena',
        versionUrl: 'https://en.wikipedia.org/w/index.php?oldid=2&title=Idena',
        license: 'CC-BY-SA-4.0',
      },
      {now}
    )

    expect(first.sourceId).not.toBe(second.sourceId)
  })

  it('hashes fetched source content deterministically', () => {
    expect(hashFetchedSourceContent('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
  })

  it('validates fetched content hash metadata', () => {
    expect(
      createSourceReference(
        {
          sourceType: 'public-docs',
          canonicalUrl: 'https://example.com/verified',
          contentHash:
            'BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD',
          license: 'MIT',
        },
        {now}
      ).contentHash
    ).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')

    expect(() =>
      createSourceReference(
        {
          sourceType: 'public-docs',
          canonicalUrl: 'https://example.com/bad-hash',
          contentHash: 'not-a-sha256',
          license: 'MIT',
        },
        {now}
      )
    ).toThrow('contentHash must be a lowercase sha256 hex digest')
  })

  it('hashes source references without depending on the current clock', () => {
    const source = {
      sourceType: 'public-docs',
      canonicalUrl: 'https://example.com/docs',
      license: 'MIT',
    }

    expect(hashSourceReference(source)).toBe(hashSourceReference(source))
  })

  it('hashes stored imported source references without dropping their source ids', () => {
    const source = createSourceReference(
      {
        sourceId: 'source:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        sourceType: 'public-docs',
        canonicalUrl: 'https://example.com/imported',
        license: 'MIT',
        licenseDetectedFrom: 'manual',
        accessStatus: 'ok',
      },
      {
        now,
        allowExplicitSourceId: true,
      }
    )

    expect(hashSourceReference(source)).toBe(sha256Json(source))
  })
})
