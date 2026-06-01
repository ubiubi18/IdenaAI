const {
  QWEN_RAG_PROFILE_LITE_16GB,
  QWEN_RAG_PROFILE_STANDARD_32GB,
  listQwenRagProfiles,
  resolveQwenRagProfile,
  resolveQwenRagProfileForMemory,
} = require('./qwen-profiles')

describe('local-rag qwen profiles', () => {
  it('resolves 16 GB Lite and 32 GB Standard profiles', () => {
    expect(resolveQwenRagProfile('16gb')).toEqual(
      expect.objectContaining({
        id: QWEN_RAG_PROFILE_LITE_16GB,
        memoryGiB: 16,
        embeddingDimensions: 64,
      })
    )
    expect(resolveQwenRagProfile('32gb')).toEqual(
      expect.objectContaining({
        id: QWEN_RAG_PROFILE_STANDARD_32GB,
        memoryGiB: 32,
        embeddingDimensions: 128,
      })
    )
  })

  it('selects profile from memory budget', () => {
    expect(resolveQwenRagProfileForMemory(16).id).toBe(
      QWEN_RAG_PROFILE_LITE_16GB
    )
    expect(resolveQwenRagProfileForMemory(31).id).toBe(
      QWEN_RAG_PROFILE_LITE_16GB
    )
    expect(resolveQwenRagProfileForMemory(32).id).toBe(
      QWEN_RAG_PROFILE_STANDARD_32GB
    )
  })

  it('returns cloned profile objects', () => {
    const [profile] = listQwenRagProfiles()
    profile.retrieval.topK = 99

    expect(resolveQwenRagProfile('16gb').retrieval.topK).toBe(4)
  })
})
