# Source-Backed RAG Knowledge System Plan

This document is planning-only. It does not define runtime behavior, add
dependencies, or implement any storage, retrieval, UI, network, IPFS, onchain,
or decentralized index logic.

## 1. Product Idea

IdenaAI should evolve toward:

local AI + source-backed RAG + AI annotations + human annotations + opt-in
public knowledge shards + later shared decentralized source index.

The core product distinction is that source references are first-class data and
full original document mirroring is not the default. Users add public sources
such as Wikipedia articles, Grokipedia/Grokpedia-style articles, arXiv papers,
public documentation, public repository docs, and other publicly accessible
sources. IdenaAI stores enough provenance, licensing, condensed knowledge,
evidence anchors, annotations, and retrieval indexes to answer locally while
keeping the original source as the auditable authority.

Design principles:

- Full original document mirroring is not the default.
- Source references are first-class records, not incidental metadata attached
  to chunks.
- Condensed knowledge must always link back to one or more source references.
- Evidence anchors must be specific enough to re-check claims later.
- License metadata is mandatory before public export.
- Unknown or unclear licensing defaults to source-reference-only, private, and
  review-required.
- RAG can re-fetch a canonical or versioned source when confidence is low, when
  an item is stale or disputed, or when the answer is high-stakes.
- AI annotations are candidates, not truth.
- Human review and source provenance outrank AI confidence.

The first useful version should work locally with no decentralized networking.
Public shard export and shared source indexing come later and must remain opt-in.

## 2. Data Model

The schemas below are minimal planning targets. They should start as plain JSON
records with deterministic ids and hashes, following the existing repo pattern
of small CommonJS modules, file-backed JSON/JSONL stores, and focused Jest tests.

### SourceReference

```json
{
  "sourceId": "source:sha256(canonicalUrl|versionUrl|title)",
  "sourceType": "wikipedia|grokipedia|arxiv|public-docs|github-repo|website|pdf|other",
  "canonicalUrl": "https://example.org/article",
  "versionUrl": "https://example.org/article?oldid=123",
  "title": "Source title",
  "authors": ["Author One"],
  "publisher": "Wikipedia",
  "platform": "mediawiki|arxiv|github|docs-site|web",
  "retrievedAt": "2026-06-01T00:00:00.000Z",
  "lastCheckedAt": "2026-06-01T00:00:00.000Z",
  "contentHash": "sha256-of-fetched-content-if-fetched",
  "license": "CC-BY-SA-4.0",
  "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
  "licenseDetectedFrom": "api|metadata|page-footer|repository-license|manual|unknown",
  "attributionRequired": true,
  "shareAlikeRequired": true,
  "commercialUseAllowed": true,
  "derivativesAllowed": true,
  "fullTextStorageAllowed": false,
  "condensedKnowledgeStorageAllowed": true,
  "accessStatus": "ok|requires-auth|not-found|blocked|changed|unknown",
  "sourceQualityFlags": [
    "versioned",
    "license-detected",
    "manual-review-required"
  ]
}
```

Notes:

- `sourceId` should be stable for the same canonical source and version.
- `versionUrl` should be preferred when the source platform supports revisions,
  immutable versions, release tags, commit URLs, or paper versions.
- `contentHash` is present only when content was fetched. It is useful for drift
  detection, not proof of license.
- `fullTextStorageAllowed` and `condensedKnowledgeStorageAllowed` are separate.
  Many sources may allow references and summaries but not local full-text
  mirroring or public redistribution.

### KnowledgeItem

```json
{
  "knowledgeId": "knowledge:sha256(type|text|sourceIds|anchors)",
  "type": "summary|claim|definition|relation|Q&A|topic|entity|warning",
  "text": "Condensed source-backed knowledge.",
  "sourceIds": ["source:..."],
  "evidenceAnchors": [
    {
      "sourceId": "source:...",
      "section": "Background",
      "path": "h2[Background] > p[3]",
      "textSelector": "optional text quote selector",
      "paragraphHash": "sha256-of-source-paragraph",
      "quote": "short quote within policy limit",
      "sourceVersion": "oldid=123",
      "sourceContentHash": "sha256-of-fetched-content-if-fetched",
      "anchorConfidence": 0.91
    }
  ],
  "confidence": 0.78,
  "createdBy": {
    "type": "ai|human|heuristic",
    "id": "local-qwen|provider-name|local-human"
  },
  "licenseStatus": {
    "status": "ok|mixed|unknown|review-required|blocked",
    "inheritedFromSourceIds": ["source:..."],
    "publicExportAllowed": false
  },
  "reviewStatus": "draft|ai-candidate|human-reviewed|approved|rejected|disputed",
  "visibility": "private|group|public",
  "createdAt": "2026-06-01T00:00:00.000Z",
  "updatedAt": "2026-06-01T00:00:00.000Z"
}
```

Notes:

- `text` is condensed knowledge, not a full copied document.
- Every item must carry `sourceIds` and evidence anchors unless it is explicitly
  marked as an unsourced warning or private note.
- Public visibility requires license clearance and review.

### EvidenceAnchor

```json
{
  "sourceId": "source:...",
  "section": "Section title",
  "title": "Document or page title",
  "path": "html/body/main/article/h2[2]/p[4]",
  "textSelector": "TextQuoteSelector or other selector",
  "paragraphHash": "sha256-of-normalized-paragraph",
  "quote": "short source quote within configured quote limits",
  "quoteCharLength": 96,
  "sourceVersion": "revision-id|paper-version|commit-sha|release-tag",
  "sourceContentHash": "sha256-of-fetched-content-if-fetched",
  "anchorConfidence": 0.86
}
```

Notes:

- Quotes should be short and bounded. Anchors should work through selectors and
  hashes rather than storing large passages.
- `anchorConfidence` captures how certain the system is that this anchor still
  points at the intended source location.

### Annotation

```json
{
  "annotationId": "annotation:sha256(targetType|targetId|createdAt|payload)",
  "targetType": "source|knowledge|evidenceAnchor|retrievalIndexEntry|shard",
  "targetId": "source:...|knowledge:...",
  "annotationType": "summary|claim-extraction|license-review|quality-review|correction|dispute|trust-score|privacy-flag",
  "annotatorType": "ai|human|heuristic",
  "provider": "local-qwen|openai|anthropic|gemini|heuristic|manual",
  "model": "qwen-placeholder|provider-model",
  "promptVersion": "source-rag-summary-v1",
  "identity": "local-human|future-idena-address",
  "signature": "future-signature-placeholder",
  "payload": {
    "status": "candidate",
    "notes": "Annotation payload depends on annotationType."
  },
  "confidence": 0.74,
  "createdAt": "2026-06-01T00:00:00.000Z",
  "supersedes": ["annotation:older"],
  "retracts": []
}
```

Notes:

- Annotations should be append-only or revisioned. They should not be silently
  overwritten.
- Human and future Idena-signed annotations should be traceable, but private
  local annotations must remain private by default.

### RetrievalIndexEntry

```json
{
  "targetId": "knowledge:...",
  "targetType": "knowledge|source|annotation",
  "keywords": ["idena", "rag", "source"],
  "topics": ["local-ai", "knowledge"],
  "embeddingModel": "qwen-embedding-placeholder",
  "vectorRef": "local-vector-ref-placeholder",
  "sourceLicenseClass": "permissive|copyleft|restricted|unknown|mixed",
  "trustScore": 0.62,
  "reviewScore": 0.8,
  "freshnessScore": 0.7
}
```

Notes:

- The first implementation should use lexical indexes only.
- `embeddingModel` and `vectorRef` are placeholders until local embedding work
  is introduced.
- Public exports should not include private embeddings by default.

### ShardManifest

```json
{
  "collectionId": "collection:sha256(metadata|roots)",
  "owner": "owner-placeholder",
  "title": "Public source-backed knowledge collection",
  "language": "en",
  "topics": ["idena", "rag"],
  "sourceCount": 12,
  "knowledgeItemCount": 84,
  "annotationCount": 140,
  "sourceRoot": "sha256-json-root-of-source-references",
  "knowledgeRoot": "sha256-json-root-of-knowledge-items",
  "annotationRoot": "sha256-json-root-of-annotations",
  "licenseSummary": {
    "classes": ["CC-BY-SA-4.0", "MIT"],
    "unknownCount": 0,
    "publicExportAllowed": true,
    "attributionRequired": true,
    "shareAlikeRequired": true
  },
  "visibility": "private|group|public",
  "signature": "future-signature-placeholder"
}
```

Notes:

- A shard manifest describes an opt-in collection. It should not imply the
  original full documents are mirrored.
- The roots should be deterministic so peers can compare manifests without
  downloading everything.

## 3. License And Source Policy

License handling should be conservative. Public availability is not permission
to republish, remix, or train on content.

### Wikipedia

- Source references and condensed knowledge are allowed only with attribution
  and share-alike handling.
- Store license metadata, including CC BY-SA and any page-specific notices.
- Prefer version URLs or revision IDs when available.
- Preserve attribution requirements in `licenseStatus` and `ShardManifest`.
- Public shards derived from Wikipedia-like sources must carry compatible
  license summaries and attribution paths.

### arXiv

- Do not assume a single license for all papers.
- License must be detected per paper and per version.
- Prefer arXiv version URLs such as `v1`, `v2`, or stable paper ids.
- If license detection is unclear, keep knowledge items private or
  review-required.
- Store bibliographic metadata where available, including title, authors, arXiv
  id, version, and license URL.

### Public Websites And Docs

- Public availability is not enough.
- Detect license or terms where possible through page metadata, docs footer,
  repository metadata, or manual review.
- If unknown, default to source-reference-only and private/review-required.
- Avoid public export of condensed knowledge until license review is complete.
- Store access status and drift checks because docs pages can change without
  stable versions.

### GitHub And Public Repositories

- Source license must be read from repository license metadata, `LICENSE`,
  `COPYING`, package metadata, or GitHub license API if used later.
- Prefer commit URLs or release tags for versioned source references.
- Generated condensed knowledge must retain source attribution.
- Repository docs can have different licenses than code. When unclear, mark
  review-required.

### Unknown Or Unclear Licenses

- Store the source reference only.
- Do not publish condensed knowledge publicly until reviewed.
- Allow local private notes and private retrieval only if the user accepts local
  policy.
- Public shard export must reject unknown-license knowledge items by default.

## 4. AI Annotation Workflow

The annotation pipeline should support multiple annotator classes. Each output
is an annotation candidate unless reviewed and promoted.

### Local Qwen

Local Qwen should be the default privacy-safe worker for:

- First-pass summary.
- Topics and tags.
- Q&A extraction.
- Source-type classification.
- Evidence anchor suggestions.
- Prompt-injection warning draft.
- Privacy-safe local processing for sources the user does not want to send to
  remote providers.

Local Qwen outputs should include model id, runtime backend, prompt version,
source ids, confidence, and failure details.

### Remote Optional Providers

Remote providers should be opt-in and should respect source license and privacy
settings. They can be useful for:

- Claim extraction.
- Contradiction checks.
- Difficult document understanding.
- Quality review.
- Cross-provider disagreement detection.

Remote jobs should use the existing provider bridge pattern where possible, but
they should be separate from validation autosolve. Sending source text to a
remote provider must require explicit user consent or a clearly configured
policy.

### Heuristics

Heuristic annotators should be deterministic and cheap:

- License detection.
- Duplicate detection.
- Prompt-injection warning.
- Source drift checks.
- Stale source checks.
- URL canonicalization.
- Version URL detection.
- Quote length enforcement.

Heuristic annotations should include enough detail to explain what rule fired.

### Human Annotation

Human reviewers should be able to:

- Accept.
- Edit.
- Reject.
- Flag.
- Mark private/public.
- Correct license.
- Add trust score.
- Add dispute note.
- Request re-fetch.
- Mark source as stale or changed.

Human review and source provenance should be stronger than AI confidence in
ranking and export decisions.

### Revision Rule

All annotations should be append-only or revisioned:

- New annotations may supersede older annotations.
- Bad annotations may be retracted.
- Original records should remain auditable.
- Silent overwrite should be avoided except for derived cache/index files that
  can be rebuilt.

## 5. Retrieval Flow

Planned RAG flow:

```text
query
-> retrieve local condensed knowledge first
-> retrieve source references and evidence anchors
-> if low confidence, disputed, high-stakes, or stale:
     re-fetch canonical or versioned source
     compare content hash/version
     update source status
     create new annotation if source changed
-> rerank
-> answer with citations/source links
-> allow user to save corrections as new annotations
```

Baseline ranking inputs:

```text
score =
  semantic score
  + lexical score
  + human review bonus
  + source reputation
  + freshness
  + license confidence
  - prompt-injection risk
  - spam risk
  - contradiction penalty
  - stale source penalty
```

Implementation notes:

- Phase 1 should not require embeddings. Start with deterministic lexical
  retrieval over `KnowledgeItem.text`, `keywords`, `topics`, and source titles.
- Source references and evidence anchors should be returned with every result.
- High-stakes detection can start as a simple heuristic flag and become more
  precise later.
- Answers should cite source titles and canonical/version URLs. If a source is
  stale or disputed, the answer should say so.
- User corrections should become new annotations, not direct overwrites.

## 6. Decentralized Scaling Plan

The decentralized plan should scale through metadata and shard discovery, not
through querying thousands of full private databases.

### Local Node

The local node stores:

- Private source references.
- Private condensed knowledge.
- Local lexical index.
- Local embeddings and vector indexes later.
- Local annotations.
- Private review decisions.

Private data remains local unless the user explicitly exports it.

### Public Shard

A public shard is an opt-in export containing:

- Source references.
- Condensed knowledge.
- Evidence anchors.
- Annotations selected for export.
- Hash roots.
- License metadata.
- Review and visibility metadata.

A public shard should not include:

- Private documents.
- Full document mirrors by default.
- Private embeddings by default.
- Unknown-license condensed knowledge.

### Shared Index

The shared index can later contain:

- Collection cards.
- Topics.
- Centroids later.
- Source roots.
- Knowledge roots.
- Annotation roots.
- License summaries.
- Trust and review stats.
- Availability info.

The shared index should avoid:

- Querying thousands of full databases directly.
- Sharing private embeddings by default.
- Publishing unknown-license content.
- Storing large documents on-chain.
- Treating AI output as verified knowledge.

Onchain storage, if used later, should be limited to compact commitments,
registry pointers, signatures, reputation signals, or dispute/report records.

## 7. Integration Points In Current IdenaAI Repo

Based on the inspected repo areas, future integration should be modular and
separate from validation autosolve.

### Main Process Modules

- `main/local-ai/`
  - Future local annotation workers can reuse local runtime and storage patterns.
  - The existing local AI area already has runtime adapter, manager, storage,
    human-teacher, and review-status concepts.
  - Avoid mixing source-backed knowledge ingestion with FLIP-specific training
    packages.

- `main/ai-providers/`
  - Multi-provider annotation jobs should use provider-adapter patterns from
    this directory.
  - Source RAG prompts should be separate from validation solving prompts.
  - Provider use must remain opt-in and policy-controlled.

- `main/ai-test-unit.js`
  - The queue and JSONL log pattern is useful for future source annotation jobs.
  - A future source annotation queue could mirror the same file-backed style:
    queue JSON plus append-only run logs.

- Possible future `main/local-rag/` or `main/source-rag/`
  - `source-reference.js`
  - `source-store.js`
  - `license-policy.js`
  - `knowledge-item.js`
  - `evidence-anchor.js`
  - `annotation-store.js`
  - `retrieval-index.js`
  - `shard-manifest.js`
  - `source-refresh.js`

If a local RAG scaffold exists, source-backed RAG should either extend it under
a source-specific submodule or graduate to `main/source-rag/` once the domain is
large enough.

### Renderer Modules

- `renderer/pages/settings/ai.js`
  - Later settings can link provider policy, local Qwen profile, remote consent,
    and privacy constraints.
  - Do not add source RAG settings to this large page until there is a clear
    settings boundary.

- Possible future `renderer/pages/settings/rag.js`
  - Source policies.
  - License defaults.
  - Provider consent for annotation jobs.
  - Local Qwen profile and cache limits.

- Possible future `renderer/pages/knowledge/`
  - Source list.
  - Knowledge item review.
  - Evidence anchor inspection.
  - Annotation history.
  - Public shard export review.

- `renderer/screens/validation/ai/`
  - Keep validation autosolve separate.
  - Reuse only general patterns where appropriate, not FLIP-specific payloads.

### Scripts

- `scripts/import_flip_challenge.py`
  - This shows the repo already accepts data import utilities, but source RAG
    should start in JS modules first.
  - A future source import script should not require heavy Python dependencies
    for the MVP.

## 8. MVP Phases

### Phase 0 - Planning Document Only

- Goal: define source-backed RAG shape and repo boundaries.
- Files likely touched: `docs/source-backed-rag-plan.md`.
- Tests needed: none.
- Non-goals: no code, no dependencies, no runtime behavior.
- Risk: overdesigning before the first storage tests exist.

### Phase 1 - Local Source Reference Store And License Metadata Model

- Goal: create deterministic source references and conservative license policy
  records.
- Files likely touched:
  - `main/source-rag/source-reference.js`
  - `main/source-rag/license-policy.js`
  - `main/source-rag/source-store.js`
  - `main/source-rag/index.js`
- Tests needed:
  - stable source ids
  - license fallback behavior
  - unknown license blocks public export
  - canonical URL normalization
- Non-goals:
  - no full document fetcher beyond deterministic test fixtures
  - no UI
  - no embeddings
  - no public export
- Risk: treating public URLs as license clearance.

### Phase 2 - Condensed Knowledge Item Store And Evidence Anchors

- Goal: store knowledge items linked to source references and anchors.
- Files likely touched:
  - `main/source-rag/knowledge-item.js`
  - `main/source-rag/evidence-anchor.js`
  - `main/source-rag/knowledge-store.js`
- Tests needed:
  - stable knowledge item hashes
  - evidence anchor validation
  - quote length limits
  - license inheritance from sources
- Non-goals:
  - no AI generation
  - no remote fetch loop
  - no UI review
- Risk: condensed knowledge that cannot be reconnected to source evidence.

### Phase 3 - Lexical Retrieval Over Condensed Knowledge

- Goal: retrieve source-backed knowledge locally without embeddings.
- Files likely touched:
  - `main/source-rag/retriever.js`
  - `main/source-rag/retrieval-index.js`
- Tests needed:
  - keyword overlap ranking
  - topic weighting
  - source/evidence metadata returned with results
  - disputed or stale penalty handling
- Non-goals:
  - no vector DB
  - no Qwen dependency
  - no UI
- Risk: ranking hides license or review status.

### Phase 4 - AI Annotation Jobs Using Existing Provider Bridge Patterns

- Goal: produce candidate summaries, topics, Q&A, claims, and warnings through
  local Qwen and optional remote providers.
- Files likely touched:
  - `main/source-rag/annotation-job.js`
  - `main/source-rag/annotation-store.js`
  - `main/source-rag/prompts.js`
  - possibly `main/ai-providers/` for generic text annotation adapter hooks
- Tests needed:
  - deterministic mock provider annotations
  - append-only annotation revisions
  - provider consent enforcement
  - prompt version persistence
- Non-goals:
  - no truth claims from AI alone
  - no public export
  - no validation autosolve wiring
- Risk: remote provider calls accidentally receive private or unknown-license
  source text.

### Phase 5 - Human Review UI

- Goal: allow humans to accept, edit, reject, flag, publish, and correct license
  metadata.
- Files likely touched:
  - `renderer/pages/knowledge/index.js`
  - `renderer/pages/knowledge/[knowledgeId].js`
  - `renderer/pages/settings/rag.js`
  - main IPC bridge files for source RAG commands
- Tests needed:
  - review status transitions
  - private/public visibility transitions
  - correction creates annotation revision
  - unknown license cannot become public without explicit review
- Non-goals:
  - no decentralized identity signatures yet
  - no shard publishing yet
- Risk: UI makes AI confidence look like verification.

### Phase 6 - Qwen Embeddings And Local Vector Search

- Goal: add local semantic retrieval as an optional index layer.
- Files likely touched:
  - `main/source-rag/embedding-adapter.js`
  - `main/source-rag/vector-index.js`
  - `main/source-rag/qwen-profile.js`
  - `main/local-ai/runtime-adapter.js` only if a generic runtime hook is needed
- Tests needed:
  - deterministic mock embeddings
  - lexical fallback when embeddings unavailable
  - no network/model requirement in tests
  - vector refs do not leak private content in public export
- Non-goals:
  - no heavy native vector DB dependency
  - no mandatory model download
- Risk: embeddings leak private information if exported or shared.

### Phase 7 - Shard Manifest Export/Import

- Goal: export/import opt-in public source-backed knowledge collections.
- Files likely touched:
  - `main/source-rag/shard-manifest.js`
  - `main/source-rag/shard-export.js`
  - `main/source-rag/shard-import.js`
- Tests needed:
  - deterministic manifest output
  - public export rejects unknown licenses
  - source/knowledge/annotation roots are stable
  - import does not overwrite local private records silently
- Non-goals:
  - no IPFS
  - no P2P shared index
  - no onchain registry
- Risk: accidental export of private or license-unclear knowledge.

### Phase 8 - Shared Decentralized Index Experiment

- Goal: test compact metadata discovery across public shards.
- Files likely touched:
  - `main/source-rag/shared-index-card.js`
  - `main/source-rag/shared-index-client.js`
  - experimental scripts under `scripts/`
- Tests needed:
  - collection card validation
  - license summary filtering
  - trust/review stat aggregation
  - no full document or private embedding export
- Non-goals:
  - no global production network
  - no large document mirroring
  - no direct querying of every peer database
- Risk: spam and poisoned metadata dominate discovery.

### Phase 9 - Idena Identity Signatures, Reputation, And Reporting

- Goal: attach future Idena identity signals to shard ownership, human review,
  disputes, and reports.
- Files likely touched:
  - `main/source-rag/signature.js`
  - `main/source-rag/reputation.js`
  - possible chain/RPC integration modules later
- Tests needed:
  - signature payload stability
  - invalid signature rejection
  - disputed annotation handling
  - report status transitions
- Non-goals:
  - no large documents on-chain
  - no AI output as reputation-proof
  - no irreversible public publishing without user confirmation
- Risk: reputation gets gamed or used to launder low-quality AI output.

## 9. Testing Plan

Initial tests should be fast, deterministic, and network-free.

- Stable source IDs:
  - Same canonical URL and version produce the same `sourceId`.
  - Different version URL or canonical URL produces a different id when policy
    requires version distinction.

- Stable knowledge item hashes:
  - Same type, text, sources, and anchors produce the same `knowledgeId`.
  - Source order is normalized before hashing.

- Source license parsing fallback behavior:
  - Known licenses map to policy flags.
  - Missing license maps to unknown, private, review-required.
  - Manual license override is explicit and auditable.

- No public export for unknown license:
  - Unknown-license sources export references only.
  - Unknown-license condensed knowledge is blocked from public shards.

- Source version/hash drift detection:
  - Same version and same hash remains ok.
  - Changed canonical content updates `accessStatus` and creates drift
    annotation.
  - Missing source marks not-found or blocked without deleting existing records.

- Annotation revision behavior:
  - New annotations can supersede older annotations.
  - Retractions do not delete original annotations.
  - Human annotations outrank AI annotations during review scoring.

- Retrieval ranking baseline:
  - Lexical matches rank above unrelated items.
  - Human-reviewed items receive a bonus.
  - Prompt-injection, stale, disputed, or spam flags reduce rank.
  - Results include source links and evidence anchors.

- Shard manifest deterministic output:
  - Same inputs produce the same roots.
  - Changing a source, knowledge item, or annotation changes the matching root.
  - License summaries are stable and conservative.

- Human review status transitions:
  - Draft to reviewed to approved works.
  - Rejected and disputed states block public export.
  - Private to public requires license clearance.

## 10. Immediate Next Step

Best immediate next Codex implementation prompt:

```text
Implement Phase 1 only for source-backed RAG. Add main/source-rag/ with
source-reference.js, license-policy.js, source-store.js, hash helpers if needed,
and index.js. Use only existing dependencies. Store source references in a
small JSON file-backed store. Add Jest tests for stable source IDs, license
policy fallback behavior, unknown-license public export blocking, and canonical
URL normalization. Do not add UI, AI annotation jobs, embeddings, shard export,
network fetching, IPFS, onchain logic, or decentralized index behavior.
```

Recommended first files to create:

- `main/source-rag/hash.js` or reuse a local stable hash helper if already
  available.
- `main/source-rag/source-reference.js`
- `main/source-rag/license-policy.js`
- `main/source-rag/source-store.js`
- `main/source-rag/index.js`
- `main/source-rag/source-reference.test.js`
- `main/source-rag/license-policy.test.js`
- `main/source-rag/source-store.test.js`

Biggest risk:

- Licensing and provenance errors. The system must not confuse public
  accessibility with permission to publish condensed knowledge or derived
  public shards.

What should not be built yet:

- No UI.
- No validation autosolve wiring.
- No full document mirroring by default.
- No heavy native vector database.
- No mandatory Qwen model download.
- No IPFS publishing.
- No onchain registry.
- No P2P shared index.
- No remote provider annotation jobs without explicit policy and consent.
