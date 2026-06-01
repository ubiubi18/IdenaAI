#!/usr/bin/env node

const path = require('path')
const fs = require('fs-extra')

const {
  createIndexCard,
  createLocalRagStore,
  retrieveQwenProfilesInParallel,
} = require('../main/local-rag')

async function main() {
  const baseDir = path.join(__dirname, '..', '.tmp', 'local-rag-demo')

  await fs.emptyDir(baseDir)

  const store = createLocalRagStore({
    baseDir,
    chunkOptions: {
      maxChars: 220,
      overlapChars: 40,
    },
  })

  await store.addDocument({
    id: 'idenaai-local-rag',
    title: 'IdenaAI local RAG notes',
    language: 'en',
    source: {
      kind: 'demo',
      path: 'demo/idenaai-local-rag.md',
    },
    text:
      'IdenaAI can use local RAG to keep private user documents on the machine. ' +
      'The first milestone uses deterministic chunking and lexical retrieval before any large model is required.',
  })

  await store.addDocument({
    id: 'idenaai-node-profiles',
    title: 'Lite and Standard node profiles',
    language: 'en',
    source: {
      kind: 'demo',
      path: 'demo/node-profiles.md',
    },
    text:
      'A 16 GB Lite node should use small Qwen models, local embeddings, and limited context. ' +
      'A 32 GB Standard node can try larger Qwen models, reranking, and a larger local index.',
  })

  await store.addDocument({
    id: 'idenaai-public-shards',
    title: 'Public shard draft',
    language: 'en',
    source: {
      kind: 'demo',
      path: 'demo/public-shards.md',
    },
    text:
      'Public shards should be opt-in and signed later. ' +
      'A shared routing index should contain metadata, hashes, centroids, and trust data, not private documents.',
  })

  const chunks = await store.listChunks()
  const query = 'private local rag documents qwen'
  const profileResults = await retrieveQwenProfilesInParallel(query, chunks, {
    topK: 3,
  })
  const indexCard = createIndexCard({
    title: 'IdenaAI local RAG demo',
    language: 'en',
    topics: ['idenaai', 'local-rag', 'qwen'],
    chunks,
    license: 'UNSPECIFIED',
    visibility: 'private',
  })

  console.log('Local RAG demo store:', baseDir)
  console.log(`\nQuery: ${query}`)
  console.log('\nParallel Qwen profile retrieval:')

  Object.entries(profileResults).forEach(([profileId, results]) => {
    console.log(`\nProfile: ${profileId}`)
    results.forEach((chunk, index) => {
      console.log(`\n${index + 1}. ${chunk.source.title}`)
      console.log(`   score: ${chunk.score}`)
      console.log(`   modes: ${chunk.retrievalModes.join(', ')}`)
      console.log(`   source: ${JSON.stringify(chunk.source)}`)
      console.log(`   text: ${chunk.text}`)
    })
  })

  console.log('\nDraft index card:')
  console.log(JSON.stringify(indexCard, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
