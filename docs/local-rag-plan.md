# Local RAG Foundation Plan

This plan starts the IdenaAI local retrieval-augmented generation foundation
without introducing a decentralized network, public publishing pipeline, or
large model dependency. The first milestone is a local-only scaffold that can
ingest small private text collections, chunk them deterministically, retrieve
with a lexical baseline, and draft a future public shard manifest without
publishing anything.

## Goals

- Preserve the existing `main/local-ai` and `main/ai-providers` architecture.
- Keep the first milestone testable without downloading a large Qwen model.
- Make the retrieval layer replaceable by a later local embedding/vector
  adapter.
- Keep user documents private and local by default.
- Leave room for opt-in public signed knowledge shards and a later shared
  decentralized routing index.

## 16 GB Lite Profile

The Lite node target should assume a constrained desktop or VPS environment
where the user also needs memory for the Idena desktop app, node runtime, OS,
and browser or Electron process.

- Model: small local Qwen-class model through an adapter such as Ollama or an
  OpenAI-compatible local endpoint.
- Embeddings: small local embedding model only after the lexical baseline is
  proven useful.
- Store: small local JSON or JSONL chunk store first, then a compact vector
  index if needed.
- Context: limited retrieved chunks, conservative chunk size, and short answer
  prompts.
- Cache: small local cache, bounded by disk and memory settings.
- First milestone: no model download is required; deterministic tests use
  mocked or lexical retrieval.

## 32 GB Standard Profile

The Standard node target can use a larger local model and a deeper retrieval
pipeline while still remaining private by default.

- Model: larger Qwen-class local model through the same adapter boundary.
- Embeddings: higher-quality local embeddings and a larger local vector index.
- Reranking: optional local reranker after lexical/vector candidate retrieval.
- Store: larger chunk cache and index with explicit size limits.
- Context: more retrieved chunks and richer citations where latency allows.
- First milestone compatibility: the same document/chunk/store interfaces
  should support both Lite and Standard profiles.

## Private Local RAG

Private local RAG is the default mode.

- User documents stay on the local machine unless the user explicitly exports
  or publishes something later.
- Local chunks should carry source metadata so answers can cite local source
  titles, paths, or document ids.
- The first store is intentionally simple and inspectable.
- Embeddings can leak information, so future vector stores should be treated as
  private data, not harmless metadata.

## Public Shard Concept

Public shards are a later opt-in capability. A user may choose to publish a
signed shard manifest for selected public or licensed material.

- A shard manifest should describe a public collection without containing
  private source text.
- It should include collection id, owner signature identity, title, language,
  topics, chunk count, content root/hash, embedding model, timestamps, license,
  and visibility.
- Publishing must be explicit and auditable.
- The first milestone only drafts an index card locally; it does not publish or
  sign anything.

## Shared Index Concept

A later shared routing index should help nodes discover useful public shards
without distributing private documents.

- Shared data should be limited to metadata, centroids, hashes, trust data, and
  source attribution data for opt-in public shards.
- Private document text, private chunks, and private embeddings should not be
  shared.
- The index should be a routing aid, not a source of truth.
- Retrieval should still verify shard manifests and source hashes locally.

## Intentionally Not Implemented Yet

- No P2P shared index.
- No IPFS publishing.
- No onchain registry.
- No remote shard retrieval.
- No trust or reputation scoring.
- No validation autosolve integration.
- No UI integration.
- No mandatory Qwen, Ollama, or hosted provider dependency.

## Risk Notes

- Privacy leakage from embeddings: vectors and centroids can reveal information
  about source documents even when raw text is not shared.
- Prompt injection through retrieved documents: local and public sources can
  contain instructions that try to override the user or system prompt.
- Spam or poisoned public shards: public publishing needs signatures, source
  review, abuse controls, and trust scoring before it is useful at scale.
- Licensing and source attribution: published shards must carry license data,
  provenance, and attribution so users can audit what they are retrieving.

## First Milestone Shape

The first implementation should be deliberately small:

- `main/local-rag/chunker.js`: deterministic text chunking with source metadata.
- `main/local-rag/hash.js`: SHA-256 helpers and stable JSON serialization.
- `main/local-rag/local-store.js`: file-backed local document and chunk store.
- `main/local-rag/retriever.js`: lexical top-k retrieval baseline.
- `main/local-rag/qwen-profiles.js`: 16 GB Lite and 32 GB Standard Qwen
  profile settings.
- `main/local-rag/embedding-adapter.js`: adapter boundary with deterministic
  mock Qwen embeddings for tests.
- `main/local-rag/vector-index.js`: small in-memory embedding ranker for local
  experiments.
- `main/local-rag/qwen-retriever.js`: parallel lexical plus embedding retrieval
  path that can run Lite and Standard profiles side by side.
- `main/local-rag/index-card.js`: local draft manifest generation.
- `scripts/local-rag-demo.js`: offline demo using hardcoded sample documents.

This creates a clean local boundary that can later accept Qwen embeddings,
reranking, signed public shards, and shared routing metadata without changing
the initial tests or requiring network access.
