const os = require('os')
const path = require('path')
const fs = require('fs-extra')

const {createAnnotationStore} = require('./annotation-store')

describe('source-rag annotation store', () => {
  let tempDir

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'idena-annotation-rag-'))
  })

  afterEach(async () => {
    await fs.remove(tempDir)
  })

  it('adds and lists annotations by target', async () => {
    const store = createAnnotationStore({
      baseDir: tempDir,
      now: () => '2026-01-01T00:00:00.000Z',
    })
    const annotation = await store.addAnnotation({
      targetType: 'knowledge',
      targetId: 'knowledge:aaaaaaaaaaaaaaaa',
      annotationType: 'topics',
      annotatorType: 'ai',
      provider: 'local-qwen-mock',
      model: 'qwen-lite-16gb-annotation-mock',
      payload: {
        topics: ['rag', 'source'],
      },
    })

    await expect(
      store.listAnnotations({
        targetType: 'knowledge',
        targetId: 'knowledge:aaaaaaaaaaaaaaaa',
      })
    ).resolves.toEqual([annotation])
  })

  it('rejects duplicate annotation ids unless explicitly allowed', async () => {
    const store = createAnnotationStore({
      baseDir: tempDir,
      now: () => '2026-01-01T00:00:00.000Z',
    })
    const annotation = {
      targetId: 'knowledge:bbbbbbbbbbbbbbbb',
      annotationType: 'summary',
      payload: {
        summary: 'Duplicate candidate.',
      },
    }

    await store.addAnnotation(annotation)
    await expect(store.addAnnotation(annotation)).rejects.toThrow(
      'Annotation already exists'
    )
    await expect(
      store.addAnnotation(annotation, {
        allowExisting: true,
      })
    ).resolves.toEqual(expect.objectContaining({annotationType: 'summary'}))
  })

  it('can return an existing annotation without replacing it', async () => {
    const store = createAnnotationStore({
      baseDir: tempDir,
      now: () => '2026-01-01T00:00:00.000Z',
    })
    const annotation = {
      targetId: 'knowledge:returnexisting',
      annotationType: 'summary',
      payload: {
        summary: 'Return existing candidate.',
      },
    }
    const first = await store.addAnnotation(annotation)
    const second = await store.addAnnotation(
      {
        ...annotation,
        createdAt: '2026-01-02T00:00:00.000Z',
      },
      {
        returnExisting: true,
      }
    )

    expect(second).toEqual(first)
    await expect(store.listAnnotations()).resolves.toHaveLength(1)
  })

  it('does not let explicit annotation ids overwrite unrelated items by default', async () => {
    const store = createAnnotationStore({
      baseDir: tempDir,
      now: () => '2026-01-01T00:00:00.000Z',
    })
    const first = await store.addAnnotation({
      targetId: 'knowledge:aaaaaaaaaaaaaaaa',
      annotationType: 'summary',
      payload: {
        summary: 'First annotation.',
      },
    })
    const second = await store.addAnnotation({
      annotationId: first.annotationId,
      targetId: 'knowledge:bbbbbbbbbbbbbbbb',
      annotationType: 'summary',
      payload: {
        summary: 'Second annotation.',
      },
    })

    expect(second.annotationId).not.toBe(first.annotationId)
    await expect(store.listAnnotations()).resolves.toHaveLength(2)
  })

  it('can preserve validated explicit annotation ids for trusted imports', async () => {
    const store = createAnnotationStore({
      baseDir: tempDir,
      allowExplicitAnnotationId: true,
      now: () => '2026-01-01T00:00:00.000Z',
    })
    const annotation = await store.addAnnotation({
      annotationId: 'annotation:cccccccccccccccccccccccccccccccc',
      targetId: 'knowledge:cccccccccccccccc',
      annotationType: 'summary',
      payload: {
        summary: 'Trusted import.',
      },
    })

    expect(annotation.annotationId).toBe(
      'annotation:cccccccccccccccccccccccccccccccc'
    )
  })
})
