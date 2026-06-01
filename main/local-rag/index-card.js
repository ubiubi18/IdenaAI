const {sha256Json, sha256Text} = require('./hash')

const DEFAULT_OWNER = 'local-owner-placeholder'
const DEFAULT_EMBEDDING_MODEL = 'qwen-embedding-placeholder'

function normalizeString(value, fallback) {
  const normalized = String(value || '').trim()
  return normalized || fallback
}

function normalizeTopics(topics) {
  if (!Array.isArray(topics)) {
    return []
  }

  return Array.from(
    new Set(topics.map((topic) => String(topic || '').trim()).filter(Boolean))
  )
}

function normalizeVisibility(value) {
  return value === 'public' ? 'public' : 'private'
}

function chunkHashRecord(chunk) {
  return {
    id: chunk.id,
    contentHash: chunk.contentHash || sha256Text(chunk.text || ''),
    documentId: chunk.documentId || (chunk.source && chunk.source.documentId),
    index: chunk.index || 0,
  }
}

function createIndexCard({
  collectionId,
  owner = DEFAULT_OWNER,
  title = 'Local RAG collection',
  language = 'und',
  topics = [],
  chunks = [],
  embeddingModel = DEFAULT_EMBEDDING_MODEL,
  createdAt = new Date().toISOString(),
  updatedAt = createdAt,
  license = 'UNSPECIFIED',
  visibility = 'private',
} = {}) {
  const chunkRecords = Array.isArray(chunks) ? chunks.map(chunkHashRecord) : []
  const contentRootHash = sha256Json({
    schemaVersion: 1,
    chunks: chunkRecords,
  })
  const normalizedTitle = normalizeString(title, 'Local RAG collection')
  const normalizedLanguage = normalizeString(language, 'und')
  const normalizedTopics = normalizeTopics(topics)
  const normalizedCollectionId = normalizeString(
    collectionId,
    `collection:${sha256Json({
      contentRootHash,
      language: normalizedLanguage,
      title: normalizedTitle,
      topics: normalizedTopics,
    }).slice(0, 24)}`
  )

  return {
    schemaVersion: 1,
    type: 'idena-local-rag-index-card',
    collectionId: normalizedCollectionId,
    owner: normalizeString(owner, DEFAULT_OWNER),
    title: normalizedTitle,
    language: normalizedLanguage,
    topics: normalizedTopics,
    chunkCount: chunkRecords.length,
    contentRoot: {
      algorithm: 'sha256-json',
      hash: contentRootHash,
    },
    embeddingModel: normalizeString(embeddingModel, DEFAULT_EMBEDDING_MODEL),
    createdAt,
    updatedAt,
    license: normalizeString(license, 'UNSPECIFIED'),
    visibility: normalizeVisibility(visibility),
  }
}

module.exports = {
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_OWNER,
  createIndexCard,
}
