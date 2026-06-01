# Source RAG test environment

This is a local-only sandbox for checking the source-backed RAG scaffold without
network calls, model downloads, IPFS, P2P, or onchain publishing.

Run:

```sh
npm run rag:source-env
```

The command resets and writes a demo environment under:

```text
.tmp/source-rag-test-env
```

It creates:

- source references with license metadata
- source-backed knowledge items with evidence anchors
- deterministic mock AI annotations for each knowledge item
- a lexical retrieval run over knowledge plus annotations
- a public export check that blocks unsafe or non-public candidates
- `run-summary.json` with paths and counts

Useful options:

```sh
npm run rag:source-env -- --query="qwen annotations"
npm run rag:source-env -- --base-dir=.tmp/my-source-rag-env
npm run rag:source-env -- --keep
read -s IDENA_RAG_STORE_KEY
export IDENA_RAG_STORE_KEY
npm run rag:source-env -- --encrypt
unset IDENA_RAG_STORE_KEY
```

The AI annotation provider is `local-qwen-mock` by default. It is deterministic
and offline; it exercises the annotation pipeline shape without pretending that
mock output is verified truth.

Safety rules:

- `--base-dir` must stay inside the repo `.tmp` directory.
- `--reset` refuses to delete `.tmp` itself or any path outside `.tmp`.
- encryption keys must be supplied through `IDENA_RAG_STORE_KEY`, not command
  line arguments. Avoid typing the secret inline in shell history.
- `run-summary.json` is written with private file permissions, and is encrypted
  too when `--encrypt` is used.
