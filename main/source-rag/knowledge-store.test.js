const os = require('os')
const path = require('path')
const fs = require('fs-extra')

const {createKnowledgeItemStore} = require('./knowledge-store')
const {createSourceReference} = require('./source-reference')

describe('source-rag knowledge store', () => {
  let tempDir
  let sourceRef

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'idena-knowledge-rag-'))
    sourceRef = createSourceReference(
      {
        sourceType: 'public-docs',
        canonicalUrl: 'https://example.com/docs',
        title: 'Example docs',
        license: 'MIT',
        licenseDetectedFrom: 'metadata',
        accessStatus: 'ok',
      },
      {
        now: () => '2026-01-01T00:00:00.000Z',
      }
    )
  })

  afterEach(async () => {
    await fs.remove(tempDir)
  })

  function item(text = 'A source-backed knowledge item.') {
    return {
      type: 'summary',
      text,
      sourceIds: [sourceRef.sourceId],
      evidenceAnchors: [
        {
          sourceId: sourceRef.sourceId,
          path: 'p[1]',
        },
      ],
      createdBy: {
        type: 'human',
        id: 'tester',
      },
    }
  }

  it('adds and lists persisted knowledge items', async () => {
    const store = createKnowledgeItemStore({
      baseDir: tempDir,
      now: () => '2026-01-02T00:00:00.000Z',
    })
    const knowledgeItem = await store.addKnowledgeItem(item(), {
      sourceReferences: [sourceRef],
    })

    await expect(
      store.getKnowledgeItem(knowledgeItem.knowledgeId)
    ).resolves.toEqual(knowledgeItem)
    await expect(store.listKnowledgeItems()).resolves.toEqual([
      expect.objectContaining({
        knowledgeId: knowledgeItem.knowledgeId,
        text: 'A source-backed knowledge item.',
        sourceIds: [sourceRef.sourceId],
        createdAt: '2026-01-02T00:00:00.000Z',
      }),
    ])
  })

  it('replaces an existing knowledge item by stable id', async () => {
    const store = createKnowledgeItemStore({
      baseDir: tempDir,
      now: () => '2026-01-02T00:00:00.000Z',
    })
    const first = await store.addKnowledgeItem(item(), {
      sourceReferences: [sourceRef],
    })
    const second = await store.addKnowledgeItem(
      {
        ...item(),
        reviewStatus: 'approved',
      },
      {
        sourceReferences: [sourceRef],
      }
    )

    expect(second.knowledgeId).toBe(first.knowledgeId)
    await expect(store.listKnowledgeItems()).resolves.toEqual([
      expect.objectContaining({
        knowledgeId: first.knowledgeId,
        reviewStatus: 'approved',
      }),
    ])
  })

  it('does not let explicit knowledge ids overwrite unrelated items by default', async () => {
    const store = createKnowledgeItemStore({
      baseDir: tempDir,
      now: () => '2026-01-02T00:00:00.000Z',
    })
    const first = await store.addKnowledgeItem(item('First knowledge item.'), {
      sourceReferences: [sourceRef],
    })
    const second = await store.addKnowledgeItem(
      {
        ...item('Second knowledge item.'),
        knowledgeId: first.knowledgeId,
      },
      {
        sourceReferences: [sourceRef],
      }
    )

    expect(second.knowledgeId).not.toBe(first.knowledgeId)
    await expect(store.listKnowledgeItems()).resolves.toHaveLength(2)
  })

  it('can preserve validated explicit knowledge ids for trusted imports', async () => {
    const store = createKnowledgeItemStore({
      baseDir: tempDir,
      allowExplicitKnowledgeId: true,
      now: () => '2026-01-02T00:00:00.000Z',
    })
    const knowledgeItem = await store.addKnowledgeItem(
      {
        ...item(),
        knowledgeId: 'knowledge:cccccccccccccccccccccccccccccccc',
      },
      {
        sourceReferences: [sourceRef],
      }
    )

    expect(knowledgeItem.knowledgeId).toBe(
      'knowledge:cccccccccccccccccccccccccccccccc'
    )
  })

  it('serializes concurrent knowledge item writes', async () => {
    const store = createKnowledgeItemStore({
      baseDir: tempDir,
      now: () => '2026-01-02T00:00:00.000Z',
    })

    await Promise.all(
      Array.from({length: 8}, (_, index) =>
        store.addKnowledgeItem(item(`Concurrent knowledge item ${index}.`), {
          sourceReferences: [sourceRef],
        })
      )
    )

    await expect(store.listKnowledgeItems()).resolves.toHaveLength(8)
  })

  it('does not chmod caller-provided directories by default', async () => {
    if (process.platform === 'win32') {
      return
    }

    const sharedDir = path.join(tempDir, 'shared')
    await fs.ensureDir(sharedDir)
    await fs.chmod(sharedDir, 0o755)
    const store = createKnowledgeItemStore({
      baseDir: sharedDir,
      now: () => '2026-01-02T00:00:00.000Z',
    })

    await store.addKnowledgeItem(item(), {
      sourceReferences: [sourceRef],
    })

    const stats = await fs.stat(sharedDir)
    expect(stats.mode.toString(8).slice(-3)).toBe('755')
  })

  it('writes knowledge store files atomically with private permissions', async () => {
    const store = createKnowledgeItemStore({
      baseDir: tempDir,
      now: () => '2026-01-02T00:00:00.000Z',
    })

    await store.addKnowledgeItem(item(), {
      sourceReferences: [sourceRef],
    })

    await expect(fs.readdir(path.dirname(store.filePath))).resolves.toEqual(
      expect.not.arrayContaining([expect.stringMatching(/^\.knowledge-items/)])
    )

    if (process.platform !== 'win32') {
      const stats = await fs.stat(store.filePath)
      expect(stats.mode.toString(8).slice(-3)).toBe('600')
    }
  })
})
