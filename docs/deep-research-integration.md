# Research Index Integration

This repository includes a reproducible index so research or coding assistants
can ingest project context with minimal ambiguity.

Generated indexes are local artifacts and are ignored by Git. Generate them
from the checkout you intend to inspect; committed snapshots became stale as
the app evolved. They are navigation aids, not proof of current behavior.

## 1. Generate/refresh the index

```bash
npm run index:deep-research
python3 scripts/build_chatgpt_connector_index.py
```

This writes:

- `docs/deep-research-index.json` (machine-readable master index)
- `docs/chatgpt-connector-index.json` (connector file index)

Run these commands from the repository root. Review the generated metadata and
selected files before sharing them with an external tool.

## 2. Current workflow

- Keep the repository index fresh before large research or implementation runs.
- Check indexed paths and claims against the current source and lockfiles.
- Treat the listed files as the primary handoff set for external tooling.

## 3. Recommended file set to provide to external research tools

Always include:

- `docs/deep-research-index.json`
- `README.md`
- `package.json`
- `docs/flip-format-reference.md`
- `main/ai-providers/bridge.js`
- `renderer/pages/flips/new.js`

The context snapshot, fork plan, and worklog are historical references. Include
them only when the research question needs earlier decisions or command history.

Optional (for dataset + audits):

- `docs/flip-challenge-import.md`
- `docs/flip-consensus-audit.md`
- `scripts/import_flip_challenge.py`
- `scripts/audit_flip_consensus.py`

## 4. Prompt template

Use this starter prompt:

```text
Use a freshly generated docs/deep-research-index.json to locate relevant files.
Start with README.md and verify claims against the current source and lockfiles.
Prioritize files listed under sections.docs, sections.ai_backend, and sections.ai_ui.
When proposing changes, include exact file targets and minimal reversible patches.
Respect research benchmark constraints, cost/latency tracking, and local test-unit flow.
```

## 5. Harmonization rules for future changes

- Keep file paths stable; update index generation if paths move.
- Record major changes in `docs/worklog.md`.
- Keep AI provider behavior centralized in `main/ai-providers/bridge.js`.
- Keep flip-builder UX orchestration centralized in `renderer/pages/flips/new.js`.
- Regenerate local indexes when repository structure changes; do not commit them.
