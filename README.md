# IdenaAI v0.1.0

IdenaAI is an experimental desktop research fork of `idena-desktop`. It brings
AI-assisted flip solving, flip drafting, rehearsal validation networks, provider
cost tracking, and local model runtime experiments into one auditable source
checkout.

This is not a hardened wallet release, not a signed installer distribution, and
not a guarantee of validation success. Use it only after reading the code and
understanding the risk.

## Current Status

`v0.1.0` is a source milestone. There are no supported release binaries in this
repository. The safest way to evaluate the app is to clone the source, install
dependencies, run the checks, and start Electron locally.

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
