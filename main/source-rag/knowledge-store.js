const path = require('path')

const {
  readJsonStoreState,
  withFileLock,
  writeJsonStoreStateAtomic,
} = require('../rag-secure-store')
const {createKnowledgeItem} = require('./knowledge-item')

const KNOWLEDGE_STORE_VERSION = 1

function normalizeStoreState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      version: KNOWLEDGE_STORE_VERSION,
      knowledgeItems: [],
    }
  }

  return {
    version: value.version || KNOWLEDGE_STORE_VERSION,
    knowledgeItems: Array.isArray(value.knowledgeItems)
      ? value.knowledgeItems
      : [],
  }
}

function createKnowledgeItemStore({
  baseDir,
  filePath,
  now = () => new Date(),
  allowExplicitKnowledgeId = false,
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
    filePath || path.join(resolvedBaseDir, 'knowledge-items.json')
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

  async function addKnowledgeItem(item, options = {}) {
    return enqueueWrite(() =>
      withFileLock(
        `${resolvedFilePath}.lock`,
        async () => {
          const nextItem = createKnowledgeItem(item, {
            ...options,
            allowExplicitKnowledgeId:
              options.allowExplicitKnowledgeId || allowExplicitKnowledgeId,
            now,
          })
          const state = await loadState()

          state.knowledgeItems = state.knowledgeItems
            .filter((entry) => entry.knowledgeId !== nextItem.knowledgeId)
            .concat(nextItem)
            .sort((left, right) =>
              left.knowledgeId.localeCompare(right.knowledgeId)
            )

          await saveState(state)
          return nextItem
        },
        {
          retryMs: lockRetryMs,
          staleMs: lockStaleMs,
          timeoutMs: lockTimeoutMs,
        }
      )
    )
  }

  async function getKnowledgeItem(knowledgeId) {
    const state = await loadState()
    return (
      state.knowledgeItems.find(
        (item) => item.knowledgeId === String(knowledgeId || '')
      ) || null
    )
  }

  async function listKnowledgeItems() {
    const state = await loadState()
    return state.knowledgeItems.slice()
  }

  return {
    filePath: resolvedFilePath,
    addKnowledgeItem,
    getKnowledgeItem,
    listKnowledgeItems,
  }
}

module.exports = {
  KNOWLEDGE_STORE_VERSION,
  createKnowledgeItemStore,
}
