# IdenaAI v0.1.0

IdenaAI is an experimental desktop fork of `idena-desktop` for validation,
FLIP, local AI, and rehearsal research.

It is not a hardened wallet release, not a trusted installer distribution, and
not a guarantee of validation success. Build and inspect it locally. Use it at
your own risk.

## Current source status

The GitHub `v0.1.0` release contains developer build artifacts for Linux, macOS,
and Windows. They are unsigned, unnotarized, unsupported, and must not be
treated as trusted wallet installers. Tags document source milestones; the
`main` branch tracks the `v0.1.0` source line.

The published `v0.1.0` workflow ran from commit `6567d4498973741a48cf7fc22efac631f9afcfa3`.
That tag was moved during release bring-up, so it is not sufficient as immutable
provenance. Verify the commit and GitHub-provided asset digest. The current
release workflow refuses to reuse an existing published tag.

### Foundation updates in v0.1.0

- The desktop foundation now targets Node `24.18.0` LTS, npm `11.16.0`, Electron
  `43.1.0`, and Next.js `16.2.10` with reproducible install and release checks.
- Managed node builds use exact `idena-go` and `idena-wasm-binding` commits from
  `scripts/source-manifest.json` instead of copied or loosely downloaded
  binaries.
- The source manifest, embedded contract runner, and embedded social UI are
  constrained by `compatibility/stack-lock.json`. This composes the reviewed
  desktop, contract-runner, and social-UI profiles without changing the legacy
  chain's genesis, network ID, gossip protocol, reward rules, or consensus.
- The lock remains a candidate manifest. CI now runs the fixed Wasm receipt and
  gas vectors on Linux and macOS for x64 and arm64 and compares two isolated
  Linux node rebuilds. Live legacy block/RPC, state replay, and mixed-node P2P
  interoperability remain external promotion requirements.
- Tagged releases fail closed while that manifest remains a candidate. An
  approved lock must checksum-bind one reviewed evidence report for every
  required gate; stale, incomplete, or modified evidence is rejected.
- Node RPC keys are stored in user-only files, RPC is bound to loopback by
  default, renderer persistence is restricted, and packaged output is checked
  for private data and unexpected artifacts.
- Full unit, lint, privacy, dependency, Electron-safety, source-integrity, and
  renderer-build gates run before release packaging.
- Release builders run read-only and upload artifacts to a separate publisher;
  the publisher creates one release and includes a `SHA256SUMS` manifest.

### Benefits

- A newer, smaller, and more auditable desktop/node foundation for validation,
  local AI, provider, and knowledge-index research.
- Reproducible source pins make it possible to identify the exact node and Wasm
  runtime under test.
- Local privacy and provider-budget controls reduce accidental exposure and
  unbounded app-side usage.

### Risks and tradeoffs

- This is the AI research repository, not the AI-free clean desktop fork. It has
  a substantially larger attack, privacy, model, and provider surface.
- Autosolve, report review, and story generation can be wrong or late and can
  affect a real validation outcome. Rehearsal tests cannot reproduce all
  mainnet timing and provider failures.
- API calls can incur external costs; local accounting cannot cap a provider
  account. Configure hard provider-side limits and use separate low-value keys.
- Local models, downloaded binaries, indexed knowledge, IPFS content, and
  imported teacher data require independent license and trust review.
- No source hardening can turn an unsigned local build into a production wallet
  release. Keep valuable identities and assets out of experimental profiles.

## v0.1.0 Status

- Added the trusted knowledge-index scaffold while keeping unfinished Knowledge
  RAG UI out of the application.
- Kept storage and trust decisions local to each node; public shard metadata is
  advisory rather than a global trust decision.
- Hardened oracle voting option indexes so stale or non-contiguous UI IDs do not
  produce invalid contract vote indexes.

## v0.0.10 Status

- Hardened short-session fallback behavior and made degraded provider runs
  visible instead of silently producing zero-token results.
- Stopped carrying stale generated bootnodes between managed node starts.
- Moved the managed node RPC key out of process arguments into a `0600` file,
  bound RPC to loopback, and restricted node runtime/configuration files.

## v0.0.9 Validation Changelog

Validation-safety release for the next real on-chain test.

- Short-session autosolve now sends each available flip to the provider as soon
  as it appears, instead of waiting for every assigned flip to finish loading.
- Short-session submission keeps a 10-second safety buffer and uses
  deterministic fallback votes for remaining regular flips at cutoff.
- Probability-ensemble tracking was hardened further across short and long
  validation paths so side/order mapping stays auditable.
- This line is ready for the next on-chain test, but rehearsal cannot prove
  every live-chain timing and provider edge case. IdenaAI remains experimental
  even after the v0.1.0 source line.
- Use at your own risk. Autosolve decisions, hosted provider spending, node
  operation, IPFS data, and validation outcomes remain the user's
  responsibility.

## Own Risk And Cost Responsibility

Running IdenaAI, running a node, validating a real identity, autosolving,
serving or inspecting IPFS data, and using hosted AI providers are all at your
own risk.

Local cost control is not provider-side cost control. IdenaAI can estimate
usage, track local token accounting, warn locally, and stop calls from this app
profile once its local budget cap is reached. It cannot control what OpenAI,
Gemini, Anthropic, OpenRouter, or any other provider bills. Use prepaid keys,
hard provider-side budgets, provider dashboards, and billing alerts.

Do not use valuable identities, unattended validation, or auto top-up provider
billing unless you have audited the code and accepted the risk.

## Quick Start From Source

Requirements:

- macOS, Windows, or Linux
- Node.js `24.18.x` LTS
- npm `11.16.x`
- Git
- Python `3.11+` for optional Python data, inspection, and flip pipelines

This is not a hardened wallet release, not a signed installer distribution, and
not a guarantee of validation success. Use it only after reading the code and
understanding the risk.

## Current Status

`v0.1.0` is a source milestone. Its GitHub release binaries are experimental
developer artifacts, not supported or trusted installers. The safest way to
evaluate the app is to clone the source, verify the exact commit and dependency
locks, run the checks, and start Electron locally.

What works for research:

- Source-run Electron desktop app.
- Built-in Idena node setup from pinned source manifests.
- Private rehearsal validation network.
- AI-assisted validation solving with hosted providers.
- Qwen 3.6 35B-A3B through DeepInfra.
- Managed local Qwen 3.6 35B-A3B install for machines that can run it.
- Local AI capture and human-teacher review workflows.
- Cost telemetry and local daily API guardrails.
- IPFS inspection helpers.

Still experimental:

- Unattended real validation.
- Local/federated model training.
- Packaged end-user release quality.
- Any use with valuable identities, wallets, or provider billing.

## Safety Rules

- Treat IdenaAI as research software.
- Test with rehearsal first, not with a valuable real identity.
- Keep provider API keys out of Git, screenshots, logs, docs, and issue text.
- Use provider-side prepaid credits, hard budget caps, and billing alerts.
- Do not rely on the app's local API cap as a real spending limit.
- Do not run real validation on a sleeping, unstable, or unattended machine.
- Verify the selected profile before arming autosolve.

Autosolve can submit answers on-chain. Wrong answers, missed sessions, provider
costs, node failures, network failures, and app crashes remain your
responsibility.

## Requirements

- Node.js `24.18.x` LTS or newer on the Node 24 line
- npm `11.16.x` or newer
- Git
- Python 3 for helper scripts
- Go when building the bundled Idena node from source
- Platform build tools:
  - macOS: Xcode command line tools
  - Windows: Visual Studio Build Tools and MSYS2/UCRT64
  - Linux: compiler toolchain plus Electron runtime libraries

Node 25+ is intentionally rejected. Use the current Node 24 LTS line.

## Quick Start

```bash
git clone https://github.com/ubiubi18/IdenaAI.git
cd IdenaAI

npm ci
npm run setup:sources
npm run doctor
npm start
```

`npm start` uses a development/practice profile under the workspace runtime
directory. That keeps first-run experiments separate from your normal Idena app
profile.

### Nix / NixOS

The repository includes a locked Linux flake for `x86_64-linux` and
`aarch64-linux`. It builds the pinned Idena node, idena.social UI, Node 24
dependencies, Electron 43 runtime, and IdenaAI renderer without downloading
tools during the build:

```bash
nix run .#idenaai
nix build .#idena-go
nix build .#idena-social-ui
nix develop
```

The default package is a guarded source runtime, not an approved signed
installer. It serves the prebuilt renderer on a random loopback-only port and
keeps the repository's source-runtime safety check: if real validation
session-auto is already armed, startup is refused unless the operator makes the
same explicit override required by the source development runtime.

The flake source contains tracked repository files only, and all tracked dotenv
files are removed before the package is built. Runtime profiles, node data,
identity keys, provider credentials, and logs stay outside the Nix store under
the normal Linux IdenaAI profile (`$XDG_CONFIG_HOME/IdenaAI`, usually
`~/.config/IdenaAI`). Do not put credentials in `flake.nix`, Nix configuration,
the Git tree, or command-line arguments. Override `IDENA_DESKTOP_USER_DATA_DIR`
when a separate test profile is required.

## Encrypted Messages In Embedded idena.social

The embedded `idena.social` view can send and read encrypted direct and group messages
through the identity connected to the desktop node. Open `idena.social`, choose
`Messages`, enter an Idena address, and click `Add Recipient`. Add more recipients
for a group conversation. Once every recipient and public key is resolved, enter
the message and click `Send` to review and submit the on-chain transaction.

The recipient must have a discoverable public key, normally from identity data
or a previous signed transaction. The UI offers a manual public-key fallback
when automatic discovery is not possible. Sending a message uses the current
social contract and costs the normal Idena transaction fees.

In desktop mode, message encryption and verified on-chain decryption run in a
bounded main-process bridge. The private identity key is exported with a random
one-use password, used only in main-process memory, and never sent into the
embedded page. Decryption is limited to successful current-contract
`sendMessage` receipts whose ciphertext, message hash, sender, and participants
match. The displayed plaintext is necessarily available to the social renderer;
the private key is not. Legacy messages outside this verified path can still
require the social app's manual session credentials.

## Fresh Machine Notes

macOS:

```bash
xcode-select -p >/dev/null 2>&1 || xcode-select --install
brew install git node@24 python@3.12 go
npm install -g npm@11.16.0
```

Windows:

- Install Git, Node.js 24 LTS, Python 3.12, Go, MSYS2, and Visual Studio Build
  Tools.
- Use PowerShell, not `cmd.exe` or Git Bash, for the first source setup.
- Ensure `gcc` from MSYS2 UCRT64 is on `Path`.
- Run `git config --global core.longpaths true`.

Linux desktop or VPS:

- Install Node.js 24 LTS, npm 11.16+, Git, Python 3, Go, build tools, and the
  Electron runtime libraries for your distro.
- A VPS needs a real GUI session through VNC, RDP, or another remote desktop.
  Pure SSH/headless mode is only suitable for dependency checks.
- On Ubuntu hosts that restrict unprivileged user namespaces, install the
  reviewed `deploy/apparmor/idena-ai-electron` profile with
  `deploy/install-electron-userns-apparmor.sh`. Do not work around the policy
  with `--no-sandbox` or a setuid Electron helper.

Then use the Quick Start commands above.

## Source Mirrors and Smaller Checkouts

`npm run setup:sources` reads `scripts/source-manifest.json` and prepares
shallow, exact-revision checkouts of the Idena source dependencies. This keeps
the node and Wasm runtime auditable without committing large copied source trees
or prebuilt binaries.

The main Git checkout stays small by keeping upstream source mirrors under the
local `.tmp/` workspace and rebuilding generated artifacts when needed. Do not
commit downloaded model weights, mirrored upstream trees, local runtime caches,
or packaged installers back into the repository.

Useful source commands:

```bash
npm run setup:sources
npm run update:sources
npm run build:node
npm run doctor
```

Compatibility evidence and promotion requirements are documented in
[`compatibility/README.md`](compatibility/README.md). The local evidence scripts
can be run with explicit, non-secret builder identities:

```bash
npm run compatibility:build-evidence -- \
  --builder-id local-a \
  --report build/compatibility/local-a.json
npm run compatibility:check-build-evidence -- \
  build/compatibility/local-a.json \
  build/compatibility/local-b.json
```

## AI Provider Setup

Open `Settings -> AI` in the app.

For hosted Qwen:

1. Turn on AI.
2. Choose `Use external API provider`.
3. Select `Qwen 3.6 via DeepInfra`.
4. Add a DeepInfra API key with `Set key`.
5. Click `Test connection`.

This uses DeepInfra's OpenAI-compatible API for:

```text
Qwen/Qwen3.6-35B-A3B
```

Hosted inference is the practical route for most users. It does not install the
model locally, and it does not train the model. Prompts are sent to the selected
provider and provider billing applies.

The app can estimate cost and stop calls from this local profile after a local
daily cap is reached. Only the provider dashboard can enforce a real account
spending limit.

## Local Qwen 3.6 35B-A3B

Open `Settings -> AI`, choose the Local AI route, then use:

```text
Install Qwen3.6 35B locally
```

The managed local install uses:

```text
Model:    Qwen/Qwen3.6-35B-A3B
Revision: 995ad96eacd98c81ed38be0c5b274b04031597b0
License:  Apache-2.0
Payload:  about 67 GiB before runtime overhead
```

IdenaAI verifies the declared model files and starts a loopback
OpenAI-compatible runtime for the app. This is intended for workstation or
server-class GPU machines. Normal laptops should use DeepInfra or another
hosted provider.

Advanced operators can also run vLLM, SGLang, KTransformers, Docker Model
Runner, Ollama, LM Studio, llama.cpp, or another OpenAI-compatible loopback
server and point IdenaAI at that runtime.

More details:

- [Local AI: Qwen3.6 35B-A3B and 27B GGUF](docs/local-ai-qwen36-gguf.md)
- [Qwen 3.6 DeepInfra flip benchmark](docs/qwen-deepinfra-benchmark.md)

## Rehearsal Before Real Validation

Use rehearsal to test the validation flow without touching mainnet.

1. Start the app with the normal source profile: `npm start`.
2. Open `Settings -> Node`.
3. Turn off `Run built-in node` if you want a clean local rehearsal.
4. Click `Start autosolve rehearsal` or `Start and use rehearsal network`.
5. Choose one AI mode:
   - `Remote provider API`
   - `Local AI runtime`
   - `No AI yet`
6. Watch readiness, seed flips, and logs.
7. Open validation when the rehearsal session is ready.
8. Review the audit/results screen after the run.

Remote-provider rehearsal can still spend API money. Multi-identity rehearsal
multiplies provider calls and cost.

## Real Validation Profile

Plain `npm start` is for the workspace practice profile. For a real validation
source run, explicitly point Electron at the real app data folder and allow
session automation only when you intend it.

macOS:

```bash
IDENA_DESKTOP_USER_DATA_DIR="$HOME/Library/Application Support/IdenaAI" \
IDENA_DESKTOP_ALLOW_DEV_SESSION_AUTO=1 \
npm start
```

Windows PowerShell:

```powershell
$env:IDENA_DESKTOP_USER_DATA_DIR="$env:APPDATA\IdenaAI"
$env:IDENA_DESKTOP_ALLOW_DEV_SESSION_AUTO="1"
npm start
```

Linux:

```bash
IDENA_DESKTOP_USER_DATA_DIR="$HOME/.config/IdenaAI" \
IDENA_DESKTOP_ALLOW_DEV_SESSION_AUTO=1 \
npm start
```

Before arming real autosolve, confirm:

- The startup log points to the real app profile, not `IdenaAI-runtime`.
- The app shows the real identity you intend to validate.
- The node is mainnet, synced, and eligible for the next validation.
- `Settings -> AI -> Test connection` succeeds.
- The IdenaAI window, terminal, internet connection, and computer stay awake.
- No rehearsal network is running during the real validation window.

## Verification

Run the focused checks before making or publishing changes:

```bash
npm run doctor
npm run lint -- --quiet
npm test -- --runInBand
npm run audit:privacy
npm run audit:local-ai-model-licenses
```

Release-oriented checks:

```bash
npm run release:check
npm run audit:metadata
npm run audit:artifacts
npm run audit:deps
npm run audit:electron
```

Build commands:

```bash
npm run build
npm run pack
npm run dist
```

Packaged builds are developer/debugging artifacts unless a signed release is
published separately.

## Useful Commands

```bash
npm start
npm run setup:sources
npm run setup:flips
npm run doctor
npm run build:node
npm run test:qwen-deepinfra
npm run prepare:qwen-flip-draft
npm run ipfs:inspect
npm run ipfs:inspect:offline
```

## Local Data

Common app profile paths:

```text
macOS:   ~/Library/Application Support/IdenaAI
Windows: %APPDATA%\IdenaAI
Linux:   ~/.config/IdenaAI
```

Important subfolders:

- `node/datadir/`: node database, keys, and node API key
- `logs/`: app and node logs
- `ai-benchmark/`: AI test output and validation telemetry
- `validation-devnet/`: rehearsal network data and logs
- `local-ai/`: local model runtime config, captures, and review data

Do not commit these folders, private keys, provider keys, decoded flip queues,
benchmark result JSON, or screenshots that expose secrets.

## Documentation

- [Qwen local and hosted setup](docs/local-ai-qwen36-gguf.md)
- [Qwen DeepInfra benchmark runbook](docs/qwen-deepinfra-benchmark.md)
- [Local AI architecture](docs/local-ai-mvp-architecture.md)
- [Human-teacher annotation architecture](docs/human-teacher-annotation-architecture.md)
- [Federated model distribution](docs/federated-model-distribution.md)
- [Flip Challenge import](docs/flip-challenge-import.md)
- [Flip format reference](docs/flip-format-reference.md)
- [Audit manifest](docs/audit-manifest.md)

## License And Upstream

IdenaAI is a research fork built on top of the Idena desktop codebase and local
source mirrors. Model licenses, provider terms, Idena node terms, and bundled UI
dependencies must be reviewed separately before redistribution or production
use.

Run:

```bash
npm run audit:local-ai-model-licenses
```

before changing downloadable local model defaults.
