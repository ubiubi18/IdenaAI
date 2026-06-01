const {
  DEFAULT_MAX_FETCH_BYTES,
  assertRedirectsAllowed,
  assertSourceFetchAllowed,
  assertSourceFetchResponseAllowed,
  getRedirectBlockReasons,
  getSourceFetchBlockReasons,
  getSourceFetchResponseBlockReasons,
  isAllowedContentType,
  normalizeContentType,
  normalizeSourceFetchPolicy,
} = require('./source-fetch-policy')
const {createSourceReference} = require('./source-reference')

describe('source-rag source fetch policy', () => {
  const now = () => '2026-01-01T00:00:00.000Z'

  it('allows public HTTPS source URLs by default', () => {
    expect(getSourceFetchBlockReasons('https://example.com/docs')).toEqual([])
    expect(() =>
      assertSourceFetchAllowed('https://example.com/docs')
    ).not.toThrow()
  })

  it('blocks plain HTTP and non-public hosts before fetching', () => {
    expect(getSourceFetchBlockReasons('http://127.0.0.1:3000/private')).toEqual(
      ['url-risk:fetch-non-public-host', 'url-risk:fetch-plain-http']
    )
    expect(() =>
      assertSourceFetchAllowed('http://127.0.0.1:3000/private')
    ).toThrow('Source fetch blocked')
  })

  it('can allow HTTP only for explicit test policies, but still blocks private hosts', () => {
    expect(
      getSourceFetchBlockReasons('http://example.com/docs', {
        allowHttp: true,
      })
    ).toEqual([])
    expect(
      getSourceFetchBlockReasons('http://localhost:3000/docs', {
        allowHttp: true,
      })
    ).toEqual(['url-risk:fetch-non-public-host'])
  })

  it('blocks sources with fetch-hostile access status', () => {
    const source = createSourceReference(
      {
        sourceType: 'public-docs',
        canonicalUrl: 'https://example.com/private',
        license: 'MIT',
        accessStatus: 'requires-auth',
      },
      {now}
    )

    expect(getSourceFetchBlockReasons(source)).toEqual([
      'source_access_requires-auth',
    ])
  })

  it('validates response metadata before content is accepted', () => {
    expect(normalizeContentType('Text/HTML; charset=utf-8')).toBe('text/html')
    expect(isAllowedContentType('text/html; charset=utf-8')).toBe(true)
    expect(
      getSourceFetchResponseBlockReasons({
        status: 200,
        contentLength: DEFAULT_MAX_FETCH_BYTES + 1,
        contentType: 'application/octet-stream',
      })
    ).toEqual([
      'content_length_exceeds_limit',
      'content_type_not_allowed:application/octet-stream',
    ])
    expect(() =>
      assertSourceFetchResponseAllowed({
        status: 404,
        contentLength: 100,
        contentType: 'text/plain',
      })
    ).toThrow('Source fetch response blocked')
  })

  it('normalizes bounded fetch policy values', () => {
    expect(
      normalizeSourceFetchPolicy({
        allowedContentTypes: ['Text/Plain; charset=utf-8', 'text/plain'],
        maxBytes: 0,
        maxRedirects: -1,
        timeoutMs: 'bad',
      })
    ).toEqual(
      expect.objectContaining({
        allowedContentTypes: ['text/plain'],
        maxBytes: DEFAULT_MAX_FETCH_BYTES,
      })
    )
    expect(normalizeSourceFetchPolicy({maxRedirects: 0}).maxRedirects).toBe(0)
  })

  it('blocks unsafe redirect chains', () => {
    expect(
      getRedirectBlockReasons([
        'https://example.com/next',
        'http://localhost:3000/private',
      ])
    ).toEqual([
      'redirect_1:url-risk:fetch-non-public-host',
      'redirect_1:url-risk:fetch-plain-http',
    ])
    expect(() =>
      assertRedirectsAllowed([
        'https://example.com/a',
        'https://example.com/b',
        'https://example.com/c',
        'https://example.com/d',
      ])
    ).toThrow('Source fetch redirect blocked')
    expect(() =>
      assertRedirectsAllowed(['https://example.com/a'], {
        maxRedirects: 0,
      })
    ).toThrow('Source fetch redirect blocked')
  })
})
