# Compatibility Evidence

`stack-lock.json` pins the legacy baseline, reviewed component commits,
toolchains, native artifacts, consumer pins, and every gate required before a
release can claim compatibility. It intentionally remains `candidate` until all
gates have concrete evidence.

## Automated Evidence

`.github/workflows/compatibility.yml` performs two repeatable checks:

- The pinned node and native binding run fixed Wasm receipt and gas vectors on
  Linux x64, Linux arm64, macOS x64, and macOS arm64.
- Two separate GitHub-hosted Linux jobs clone fresh pinned sources and build the
  node with the locked Go and Node toolchains. A third job requires matching
  node binary, native binding, toolchain, platform, and architecture results.

Build reports contain hashes and public GitHub runner metadata only. They do not
copy environment variables, tokens, source trees, or binaries. The report path
requests mode `0600` where supported and must not already exist.

Run the same rebuild check locally with two independent builder IDs and output
files:

```bash
npm run compatibility:build-evidence -- \
  --builder-id local-a \
  --report build/compatibility/local-a.json
npm run compatibility:build-evidence -- \
  --builder-id local-b \
  --report build/compatibility/local-b.json
npm run compatibility:check-build-evidence -- \
  build/compatibility/local-a.json \
  build/compatibility/local-b.json
```

## Promotion Procedure

Promotion requires reviewed JSON reports for every `requiredGates` entry. Store
those reports under `compatibility/reports/`. Each report must identify the same
release, baseline, source commit, and exact component pin set as the lock, and
must include the commands and non-empty structured results used to reach its
conclusion.

Create `compatibility/promotion-evidence.json` with one passed entry per required
gate. Each report descriptor must contain its repository-relative path and
SHA-256 digest. Then set `stack-lock.json` to `promoted` and add a
`promotionEvidence` descriptor containing the fixed manifest path and its
SHA-256 digest. `scripts/check-compatibility-lock.js` rejects missing, stale,
duplicated, path-escaping, symlinked, malformed, or checksum-mismatched evidence.

Do not promote from automated CI alone. The remaining live checks require:

- Legacy-versus-candidate block and RPC differential fixtures.
- Replay of the pinned legacy state snapshot with state-root comparison.
- Sustained legacy/candidate P2P interoperability on an isolated network.

If any component, toolchain, invariant, or fixture changes, create a new release
candidate and rerun every gate. Roll back by restoring the last reviewed
candidate lock; never reuse evidence from another pin set.
