const path = require('path')

const {
  readJsonStoreState,
  withFileLock,
  writeJsonStoreStateAtomic,
} = require('../rag-secure-store')
const {createSourceReference} = require('./source-reference')

const SOURCE_STORE_VERSION = 1

function normalizeStoreState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      version: SOURCE_STORE_VERSION,
      sources: [],
    }
  }

  return {
    version: value.version || SOURCE_STORE_VERSION,
    sources: Array.isArray(value.sources) ? value.sources : [],
  }
}

function createSourceReferenceStore({
  baseDir,
  filePath,
  now = () => new Date(),
  allowExplicitSourceId = false,
  secureFilePermissions = true,
  secureDirectoryPermissions = !baseDir && !filePath,
  encryptionKey = process.env.IDENA_RAG_STORE_KEY,
  lockTimeoutMs,
  lockRetryMs,
  lockStaleMs,
} = {}) {
  const resolvedBaseDir =
    baseDir || path.join(process.cwd(), '.tmp', 'source-rag')
  const resolvedFilePath =
    filePath || path.join(resolvedBaseDir, 'source-references.json')
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

  async function addSource(source) {
    return enqueueWrite(() =>
      withFileLock(
        `${resolvedFilePath}.lock`,
        async () => {
          const nextSource = createSourceReference(source, {
            now,
            allowExplicitSourceId,
          })
          const state = await loadState()

          state.sources = state.sources
            .filter((item) => item.sourceId !== nextSource.sourceId)
            .concat(nextSource)
            .sort((left, right) => left.sourceId.localeCompare(right.sourceId))

          await saveState(state)
          return nextSource
        },
        {
          retryMs: lockRetryMs,
          staleMs: lockStaleMs,
          timeoutMs: lockTimeoutMs,
        }
      )
    )
  }

  async function getSource(sourceId) {
    const state = await loadState()
    return (
      state.sources.find((item) => item.sourceId === String(sourceId || '')) ||
      null
    )
  }

  async function listSources() {
    const state = await loadState()
    return state.sources.slice()
  }

  return {
    filePath: resolvedFilePath,
    addSource,
    getSource,
    listSources,
  }
}

module.exports = {
  SOURCE_STORE_VERSION,
  createSourceReferenceStore,
}
