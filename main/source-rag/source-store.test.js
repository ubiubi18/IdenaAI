const os = require('os')
const path = require('path')
const fs = require('fs-extra')

const {canExportCondensedKnowledgePublicly} = require('./license-policy')
const {createSourceReferenceStore} = require('./source-store')

describe('source-rag source store', () => {
  let tempDir

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'idena-source-rag-'))
  })

  afterEach(async () => {
    await fs.remove(tempDir)
  })

  it('adds and lists persisted source references', async () => {
    const store = createSourceReferenceStore({
      baseDir: tempDir,
      now: () => '2026-01-01T00:00:00.000Z',
    })

    const source = await store.addSource({
      sourceType: 'github-repo',
      canonicalUrl: 'https://github.com/ubiubi18/IdenaAI',
      versionUrl: 'https://github.com/ubiubi18/IdenaAI/tree/main',
      title: 'IdenaAI',
      authors: ['ubiubi18'],
      publisher: 'GitHub',
      platform: 'github',
      license: 'MIT',
      licenseDetectedFrom: 'repository-license',
      accessStatus: 'ok',
    })

    await expect(store.getSource(source.sourceId)).resolves.toEqual(source)
    await expect(store.listSources()).resolves.toEqual([
      expect.objectContaining({
        sourceId: source.sourceId,
        sourceType: 'github-repo',
        canonicalUrl: 'https://github.com/ubiubi18/IdenaAI',
        license: 'MIT',
        publicCondensedKnowledgeAllowed: true,
      }),
    ])
  })

  it('replaces an existing normalized source reference', async () => {
    const store = createSourceReferenceStore({
      baseDir: tempDir,
      now: () => '2026-01-01T00:00:00.000Z',
    })

    const first = await store.addSource({
      sourceType: 'public-docs',
      canonicalUrl: 'https://example.com/docs?b=2&a=1',
      title: 'Old title',
      license: 'MIT',
    })
    const second = await store.addSource({
      sourceType: 'public-docs',
      canonicalUrl: 'https://example.com/docs?a=1&b=2',
      title: 'New title',
      license: 'MIT',
    })

    expect(first.sourceId).toBe(second.sourceId)
    await expect(store.listSources()).resolves.toEqual([
      expect.objectContaining({
        sourceId: first.sourceId,
        title: 'New title',
      }),
    ])
  })

  it('does not let explicit source ids overwrite unrelated canonical sources by default', async () => {
    const store = createSourceReferenceStore({
      baseDir: tempDir,
      now: () => '2026-01-01T00:00:00.000Z',
    })
    const first = await store.addSource({
      sourceType: 'public-docs',
      canonicalUrl: 'https://example.com/a',
      license: 'MIT',
    })
    const second = await store.addSource({
      sourceId: first.sourceId,
      sourceType: 'public-docs',
      canonicalUrl: 'https://example.com/b',
      license: 'MIT',
    })

    expect(second.sourceId).not.toBe(first.sourceId)
    await expect(store.listSources()).resolves.toHaveLength(2)
  })

  it('can preserve validated explicit source ids for trusted imports', async () => {
    const store = createSourceReferenceStore({
      baseDir: tempDir,
      allowExplicitSourceId: true,
      now: () => '2026-01-01T00:00:00.000Z',
    })
    const source = await store.addSource({
      sourceId: 'source:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      sourceType: 'public-docs',
      canonicalUrl: 'https://example.com/imported',
      license: 'MIT',
    })

    expect(source.sourceId).toBe('source:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
  })

  it('serializes concurrent source writes', async () => {
    const store = createSourceReferenceStore({
      baseDir: tempDir,
      now: () => '2026-01-01T00:00:00.000Z',
    })

    await Promise.all(
      Array.from({length: 8}, (_, index) =>
        store.addSource({
          sourceType: 'public-docs',
          canonicalUrl: `https://example.com/docs/${index}`,
          license: 'MIT',
        })
      )
    )

    await expect(store.listSources()).resolves.toHaveLength(8)
  })

  it('does not chmod caller-provided directories by default', async () => {
    if (process.platform === 'win32') {
      return
    }

    const sharedDir = path.join(tempDir, 'shared')
    await fs.ensureDir(sharedDir)
    await fs.chmod(sharedDir, 0o755)
    const store = createSourceReferenceStore({
      baseDir: sharedDir,
      now: () => '2026-01-01T00:00:00.000Z',
    })

    await store.addSource({
      sourceType: 'public-docs',
      canonicalUrl: 'https://example.com/shared-dir',
      license: 'MIT',
    })

    const stats = await fs.stat(sharedDir)
    expect(stats.mode.toString(8).slice(-3)).toBe('755')
  })

  it('writes source store files atomically with private permissions', async () => {
    const store = createSourceReferenceStore({
      baseDir: tempDir,
      now: () => '2026-01-01T00:00:00.000Z',
    })

    await store.addSource({
      sourceType: 'public-docs',
      canonicalUrl: 'https://example.com/private-source',
      license: 'MIT',
    })

    await expect(fs.readdir(path.dirname(store.filePath))).resolves.toEqual(
      expect.not.arrayContaining([
        expect.stringMatching(/^\.source-references/),
      ])
    )

    if (process.platform !== 'win32') {
      const stats = await fs.stat(store.filePath)
      expect(stats.mode.toString(8).slice(-3)).toBe('600')
    }
  })

  it('can encrypt source store files at rest', async () => {
    const store = createSourceReferenceStore({
      baseDir: tempDir,
      encryptionKey: 'source-rag-test-key',
      now: () => '2026-01-01T00:00:00.000Z',
    })

    const source = await store.addSource({
      sourceType: 'public-docs',
      canonicalUrl: 'https://example.com/private-source-ref',
      license: 'MIT',
    })

    const rawStore = await fs.readFile(store.filePath, 'utf8')
    expect(rawStore).toContain('idena-rag-encrypted-store')
    expect(rawStore).not.toContain('private-source-ref')

    const reopened = createSourceReferenceStore({
      baseDir: tempDir,
      encryptionKey: 'source-rag-test-key',
    })
    await expect(reopened.getSource(source.sourceId)).resolves.toEqual(source)
  })

  it('persists unknown-license sources but blocks public condensed knowledge', async () => {
    const store = createSourceReferenceStore({
      baseDir: tempDir,
      now: () => '2026-01-01T00:00:00.000Z',
    })

    const source = await store.addSource({
      sourceType: 'website',
      canonicalUrl: 'https://example.com/article',
      title: 'Unknown license article',
    })

    expect(source).toEqual(
      expect.objectContaining({
        license: 'UNKNOWN',
        reviewRequired: true,
        condensedKnowledgeStorageAllowed: false,
        publicCondensedKnowledgeAllowed: false,
      })
    )
    expect(canExportCondensedKnowledgePublicly(source)).toBe(false)
  })
})
