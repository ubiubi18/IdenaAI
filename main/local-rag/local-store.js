const path = require('path')

const {
  readJsonStoreState,
  withFileLock,
  writeJsonStoreStateAtomic,
} = require('../rag-secure-store')
const {detectPromptInjectionRisk} = require('../rag-security')
const {chunkText} = require('./chunker')
const {sha256Json, sha256Text} = require('./hash')

const STORE_VERSION = 1

function normalizeId(value, fallback) {
  const normalized = String(value || '').trim()
  return normalized || fallback
}

function normalizeMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    throw new Error('document metadata must be JSON-serializable')
  }
}

function normalizeStoreState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      version: STORE_VERSION,
      documents: [],
      chunks: [],
    }
  }

  return {
    version: value.version || STORE_VERSION,
    documents: Array.isArray(value.documents) ? value.documents : [],
    chunks: Array.isArray(value.chunks) ? value.chunks : [],
  }
}

function createLocalRagStore({
  baseDir,
  filePath,
  chunkOptions = {},
  now = () => new Date().toISOString(),
  secureFilePermissions = true,
  secureDirectoryPermissions = !baseDir && !filePath,
  encryptionKey = process.env.IDENA_RAG_STORE_KEY,
  lockTimeoutMs,
  lockRetryMs,
  lockStaleMs,
} = {}) {
  const resolvedBaseDir =
    baseDir || path.join(process.cwd(), '.tmp', 'local-rag')
  const resolvedFilePath = filePath || path.join(resolvedBaseDir, 'store.json')
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

  async function addDocument(document = {}, options = {}) {
    return enqueueWrite(() =>
      withFileLock(
        `${resolvedFilePath}.lock`,
        async () => {
          const text = String(document.text || '').trim()
          if (!text) {
            throw new Error('document.text is required')
          }

          const documentSecurity = detectPromptInjectionRisk(text)
          const contentHash = sha256Text(text)
          const documentId = normalizeId(
            document.id,
            `doc:${sha256Json({
              contentHash,
              source: document.source || {},
              title: document.title || '',
            }).slice(0, 24)}`
          )
          const title = normalizeId(document.title, documentId)
          const language = normalizeId(document.language, 'und')
          const source = normalizeMetadata(document.source)
          const metadata = normalizeMetadata(document.metadata)
          const timestamp = document.createdAt || now()
          const updatedAt = document.updatedAt || timestamp
          const chunkSource = {
            ...source,
            documentId,
            title,
            language,
          }
          const chunks = chunkText(text, {
            ...chunkOptions,
            ...(options.chunkOptions || {}),
            source: chunkSource,
          }).map((chunk) => ({
            ...chunk,
            documentId,
            securityFlags: detectPromptInjectionRisk(chunk.text).flags,
          }))
          const storedDocument = {
            id: documentId,
            title,
            language,
            source,
            metadata,
            contentHash,
            chunkCount: chunks.length,
            securityFlags: documentSecurity.flags,
            createdAt: timestamp,
            updatedAt,
          }
          const state = await loadState()

          state.documents = state.documents
            .filter((item) => item.id !== documentId)
            .concat(storedDocument)
          state.chunks = state.chunks
            .filter((chunk) => chunk.documentId !== documentId)
            .concat(chunks)

          await saveState(state)

          return {
            document: storedDocument,
            chunks,
          }
        },
        {
          retryMs: lockRetryMs,
          staleMs: lockStaleMs,
          timeoutMs: lockTimeoutMs,
        }
      )
    )
  }

  async function listDocuments() {
    const state = await loadState()
    return state.documents.slice()
  }

  async function listChunks() {
    const state = await loadState()
    return state.chunks.slice()
  }

  return {
    filePath: resolvedFilePath,
    addDocument,
    listDocuments,
    listChunks,
  }
}

module.exports = {
  STORE_VERSION,
  createLocalRagStore,
}
