const QWEN_RAG_PROFILE_LITE_16GB = 'qwen-lite-16gb'
const QWEN_RAG_PROFILE_STANDARD_32GB = 'qwen-standard-32gb'

const QWEN_RAG_PROFILES = {
  [QWEN_RAG_PROFILE_LITE_16GB]: {
    id: QWEN_RAG_PROFILE_LITE_16GB,
    label: 'Qwen Lite 16 GB',
    memoryGiB: 16,
    modelFamily: 'qwen',
    chatModel: 'qwen-lite-placeholder',
    embeddingModel: 'qwen-embedding-lite-placeholder',
    embeddingDimensions: 64,
    chunking: {
      maxChars: 900,
      overlapChars: 90,
    },
    retrieval: {
      topK: 4,
      candidateK: 12,
      lexicalWeight: 0.45,
      embeddingWeight: 0.55,
      rerank: false,
      maxContextChunks: 4,
    },
  },
  [QWEN_RAG_PROFILE_STANDARD_32GB]: {
    id: QWEN_RAG_PROFILE_STANDARD_32GB,
    label: 'Qwen Standard 32 GB',
    memoryGiB: 32,
    modelFamily: 'qwen',
    chatModel: 'qwen-standard-placeholder',
    embeddingModel: 'qwen-embedding-standard-placeholder',
    embeddingDimensions: 128,
    chunking: {
      maxChars: 1400,
      overlapChars: 160,
    },
    retrieval: {
      topK: 6,
      candidateK: 24,
      lexicalWeight: 0.35,
      embeddingWeight: 0.65,
      rerank: true,
      maxContextChunks: 6,
    },
  },
}

function cloneProfile(profile) {
  return JSON.parse(JSON.stringify(profile))
}

function listQwenRagProfiles() {
  return Object.values(QWEN_RAG_PROFILES).map(cloneProfile)
}

function resolveQwenRagProfile(value) {
  const normalized = String(value || '').trim()

  if (QWEN_RAG_PROFILES[normalized]) {
    return cloneProfile(QWEN_RAG_PROFILES[normalized])
  }

  if (normalized === 'lite' || normalized === '16gb' || normalized === '16') {
    return cloneProfile(QWEN_RAG_PROFILES[QWEN_RAG_PROFILE_LITE_16GB])
  }

  if (
    normalized === 'standard' ||
    normalized === '32gb' ||
    normalized === '32'
  ) {
    return cloneProfile(QWEN_RAG_PROFILES[QWEN_RAG_PROFILE_STANDARD_32GB])
  }

  return cloneProfile(QWEN_RAG_PROFILES[QWEN_RAG_PROFILE_LITE_16GB])
}

function resolveQwenRagProfileForMemory(memoryGiB) {
  const parsed = Number.parseFloat(memoryGiB)

  if (Number.isFinite(parsed) && parsed >= 32) {
    return cloneProfile(QWEN_RAG_PROFILES[QWEN_RAG_PROFILE_STANDARD_32GB])
  }

  return cloneProfile(QWEN_RAG_PROFILES[QWEN_RAG_PROFILE_LITE_16GB])
}

module.exports = {
  QWEN_RAG_PROFILE_LITE_16GB,
  QWEN_RAG_PROFILE_STANDARD_32GB,
  QWEN_RAG_PROFILES,
  listQwenRagProfiles,
  resolveQwenRagProfile,
  resolveQwenRagProfileForMemory,
}
