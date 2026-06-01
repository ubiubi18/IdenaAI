const path = require('path')

const {
  readJsonStoreState,
  withFileLock,
  writeJsonStoreStateAtomic,
} = require('../rag-secure-store')
const {createAnnotation} = require('./annotation')

const ANNOTATION_STORE_VERSION = 1

function normalizeStoreState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      version: ANNOTATION_STORE_VERSION,
      annotations: [],
    }
  }

  return {
    version: value.version || ANNOTATION_STORE_VERSION,
    annotations: Array.isArray(value.annotations) ? value.annotations : [],
  }
}

function createAnnotationStore({
  baseDir,
  filePath,
  now = () => new Date(),
  secureFilePermissions = true,
  secureDirectoryPermissions = !baseDir && !filePath,
  encryptionKey = process.env.IDENA_RAG_STORE_KEY,
  allowExplicitAnnotationId = false,
  lockTimeoutMs,
  lockRetryMs,
  lockStaleMs,
} = {}) {
  const resolvedBaseDir =
    baseDir || path.join(process.cwd(), '.tmp', 'source-rag')
  const resolvedFilePath =
    filePath || path.join(resolvedBaseDir, 'annotations.json')
  let writeQueue = Promise.resolve()

  async function loadState() {
    return readJsonStoreState(resolvedFilePath, normalizeStoreState, {
      encryptionKey,
    })
  }

  async function saveState(state) {
    return writeJsonStoreStateAtomic(
      resolvedFilePath,
      normalizeStoreState(state),
      {
        encryptionKey,
        secureDirectoryPermissions,
        secureFilePermissions,
      }
    )
  }

  function enqueueWrite(operation) {
    const result = writeQueue.then(operation, operation)
    writeQueue = result.catch(() => {})
    return result
  }

  async function addAnnotation(annotation, options = {}) {
    return enqueueWrite(() =>
      withFileLock(
        `${resolvedFilePath}.lock`,
        async () => {
          const nextAnnotation = createAnnotation(annotation, {
            allowExplicitAnnotationId:
              options.allowExplicitAnnotationId || allowExplicitAnnotationId,
            now: options.now || now,
          })
          const state = await loadState()
          const existing = state.annotations.find(
            (item) => item.annotationId === nextAnnotation.annotationId
          )

          if (existing && options.returnExisting) {
            return existing
          }

          if (existing && !options.allowExisting) {
            throw new Error(
              `Annotation already exists: ${nextAnnotation.annotationId}`
            )
          }

          state.annotations = state.annotations
            .filter((item) => item.annotationId !== nextAnnotation.annotationId)
            .concat(nextAnnotation)
            .sort((left, right) => {
              if (left.createdAt !== right.createdAt) {
                return left.createdAt.localeCompare(right.createdAt)
              }
              return left.annotationId.localeCompare(right.annotationId)
            })

          await saveState(state)
          return nextAnnotation
        },
        {
          retryMs: lockRetryMs,
          staleMs: lockStaleMs,
          timeoutMs: lockTimeoutMs,
        }
      )
    )
  }

  async function listAnnotations(filter = {}) {
    const state = await loadState()
    const targetType = String(filter.targetType || '').trim()
    const targetId = String(filter.targetId || '').trim()

    return state.annotations.filter((annotation) => {
      if (targetType && annotation.targetType !== targetType) {
        return false
      }
      if (targetId && annotation.targetId !== targetId) {
        return false
      }
      return true
    })
  }

  return {
    filePath: resolvedFilePath,
    addAnnotation,
    listAnnotations,
  }
}

module.exports = {
  ANNOTATION_STORE_VERSION,
  createAnnotationStore,
}
