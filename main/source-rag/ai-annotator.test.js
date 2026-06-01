const os = require('os')
const path = require('path')
const fs = require('fs-extra')

const {
  createMockAiKnowledgeAnnotator,
  extractTopics,
  runAiKnowledgeAnnotationJob,
} = require('./ai-annotator')
const {createAnnotationStore} = require('./annotation-store')
const {createKnowledgeItem} = require('./knowledge-item')
const {createSourceReference} = require('./source-reference')

describe('source-rag AI annotator', () => {
  const now = () => '2026-01-01T00:00:00.000Z'
  let tempDir

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'idena-ai-annotator-'))
  })

  afterEach(async () => {
    await fs.remove(tempDir)
  })

  function source() {
    return createSourceReference(
      {
        sourceType: 'public-docs',
        canonicalUrl: 'https://example.com/docs',
        title: 'Example docs',
        license: 'MIT',
        licenseDetectedFrom: 'metadata',
        accessStatus: 'ok',
      },
      {now}
    )
  }

  function knowledgeItem(sourceRef, overrides = {}) {
    return createKnowledgeItem(
      {
        type: 'summary',
        text: 'Source-backed RAG stores condensed knowledge with local AI annotations.',
        sourceIds: [sourceRef.sourceId],
        evidenceAnchors: [
          {
            sourceId: sourceRef.sourceId,
            path: 'p[1]',
          },
        ],
        reviewStatus: 'approved',
        visibility: 'public',
        createdBy: {
          type: 'human',
          id: 'tester',
        },
        ...overrides,
      },
      {
        now,
        sourceReferences: [sourceRef],
      }
    )
  }

  it('extracts deterministic topics from knowledge text', () => {
    expect(extractTopics('Local RAG local annotations source source')).toEqual([
      'local',
      'source',
      'annotations',
      'rag',
    ])
  })

  it('creates deterministic AI annotation candidates', async () => {
    const sourceRef = source()
    const annotator = createMockAiKnowledgeAnnotator({now})
    const annotations = await annotator.annotateKnowledgeItem(
      knowledgeItem(sourceRef),
      {
        sourceReferences: [sourceRef],
      }
    )

    expect(annotations.map((annotation) => annotation.annotationType)).toEqual([
      'summary',
      'topics',
      'Q&A',
      'quality-review',
    ])
    expect(annotations[0]).toEqual(
      expect.objectContaining({
        annotatorType: 'ai',
        provider: 'local-qwen-mock',
        model: 'qwen-lite-16gb-annotation-mock',
      })
    )
  })

  it('runs annotation jobs into an annotation store', async () => {
    const sourceRef = source()
    const item = knowledgeItem(sourceRef)
    const annotationStore = createAnnotationStore({
      baseDir: tempDir,
      now,
    })
    const job = await runAiKnowledgeAnnotationJob({
      knowledgeItems: [item],
      sourceReferences: [sourceRef],
      annotationStore,
      annotator: createMockAiKnowledgeAnnotator({now}),
    })

    expect(job.annotationCount).toBe(4)
    await expect(
      annotationStore.listAnnotations({
        targetId: item.knowledgeId,
      })
    ).resolves.toHaveLength(4)
  })

  it('does not duplicate deterministic annotations on repeated jobs', async () => {
    const sourceRef = source()
    const item = knowledgeItem(sourceRef)
    const annotationStore = createAnnotationStore({
      baseDir: tempDir,
      now,
    })
    const annotator = createMockAiKnowledgeAnnotator({
      now: () => '2026-01-01T00:00:00.000Z',
    })
    const laterAnnotator = createMockAiKnowledgeAnnotator({
      now: () => '2026-01-02T00:00:00.000Z',
    })

    await runAiKnowledgeAnnotationJob({
      knowledgeItems: [item],
      sourceReferences: [sourceRef],
      annotationStore,
      annotator,
    })
    await runAiKnowledgeAnnotationJob({
      knowledgeItems: [item],
      sourceReferences: [sourceRef],
      annotationStore,
      annotator: laterAnnotator,
    })

    await expect(
      annotationStore.listAnnotations({
        targetId: item.knowledgeId,
      })
    ).resolves.toHaveLength(4)
  })
})
