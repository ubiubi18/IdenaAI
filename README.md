# IdenaAI v0.0.3

`IdenaAI` is an experimental desktop fork of `idena-desktop` focused on:

- local and hosted AI integration
- FLIP solving, generation, and benchmarking research
- human-teacher annotation flows
- local runtime and training experiments tied to the desktop app
- validation rehearsal tooling for safer local protocol testing

This repository is the main app-integration line. Version `0.0.3` is a
development snapshot of the recent dependency, runtime, local AI, rehearsal, and
autosolver work. It is research software, not a hardened wallet release.

## Start Here

For a first run, use this order.

1. Install and start the app from source:

```bash
git clone https://github.com/ubiubi18/IdenaAI.git
cd IdenaAI
nvm use
npm ci
npm start
```

2. Choose an AI backend in `Settings -> AI`.

- Hosted API path: turn on AI, choose `Use external API provider`, select
  `OpenAI`, set your API key, choose `gpt-5.5`, then click `Test connection`.
- Local path: turn on AI, use the managed local runtime path, approve the model
  download/trust prompt, and wait until the runtime is ready.

3. Run a safe rehearsal before touching a real ceremony.

- Open `Settings -> Node`.
- In `Validation Rehearsal Devnet`, click `Start and use rehearsal network`.
- Wait for the app to switch to the rehearsal node.
- Use `Open countdown` or `Open validation` when available.
- Click `Run 1 rehearsal autosolve` to dry-run the configured AI backend on one
  rehearsal identity.
- Use `Run optional 9-ID parallel rehearsal` only when you deliberately want a
  local multi-participant capacity test.

4. Try the flip builder and off-chain solver path.

- Open `Flips -> New`.
- Use the AI builder controls if you want generated draft panels.
- Click `Build flips`, review/edit the result, then use `Add current draft flip
  to queue`.
- Use `Run current draft now`, `Run short (6)`, or `Run long (14)` to compare
  solving behavior without publishing anything.

5. Use live validation automation only after rehearsal works and only from the
   packaged app.

- Open `Validation`.
- Use `Enable auto-solve next session` only after reading
  [Real Session Auto-Solve With OpenAI](#real-session-auto-solve-with-openai).
- Keep manual oversight. This is not production-safe unattended automation.

Rehearsal and off-chain queue runs stay local and do not submit mainnet
answers. Mainnet validation, reporting, wallet, and identity use remain at your
own risk.

## Experimental Warning

Read this part first. `v0.0.3` is not production ready.

- no warranties
- not audited
- not externally security-reviewed
- developed through broad, fast-moving, AI-assisted / vibe-coding iterations
- work in progress
- experimental software with breaking changes, wrong behavior, and rough edges
- contains large cross-cutting changes that still need slower human review
- not suitable for valuable identities, funds, unattended automation, or blind trust
- not suitable for unattended on-chain validation or reporting
- do not install or run this if you do not understand what it is doing
- use throwaway or low-value Idena addresses only
- do not attach valuable identities to this fork
- use it only on a secured system you control
- do your own research before trusting anything here
- ask an AI agent or a human reviewer to audit the repo and adapt it to your own needs before relying on it

If you are not comfortable reviewing diffs, debugging broken flows, reading logs,
and accepting the possibility of incorrect results, do not use this build.

Hosted API providers are included for user-controlled benchmarking and
small-scale experimentation with the user's own API key. They are not a
reliability guarantee for synchronized live validation windows. For serious use,
prefer local models so capacity scales with your own hardware.

## v0.0.3 Repo Status

`v0.0.3` extends the cleaner-runtime development snapshot after the Node 24 LTS
and Electron 41 migration. It adds another hardening pass for managed local AI,
validation rehearsal, submit/retry handling, real-session transition timing, and
autosolver/reporting telemetry.

It should be treated as an auditable checkpoint, not a production release:

- production dependency audit is currently clean, but dev tooling and the full
  app surface still need deeper review
- local AI, validation rehearsal, autosolver, and benchmark telemetry paths have
  changed quickly and need more independent testing
- the codebase was advanced through extensive AI-assisted iteration, so reviewers
  should assume mistakes can exist even where tests pass
- no guarantee is made that on-chain validation, reporting, wallet, node,
  identity, or model-runtime flows behave safely under real user stakes

## Latest Changes

This section should stay current and act as a short roadmap of what has already landed.

- Live Metrics:
  local benchmark/session traces are written under `userData/ai-benchmark/`,
  including `session-metrics.jsonl` and local audit output files.
- Validation rehearsal devnet:
  the app now exposes a private multi-node rehearsal network in `Settings -> Node`
  with one shared-profile bootstrap node plus nine local validator identities,
  seeded
  FLIP-Challenge flips, background start, restart/stop controls, and app-only
  rehearsal switching. Parallel lane benchmarking is documented as
  rehearsal-only work in `docs/rehearsal-parallel-lane-benchmark.md` and is not
  a mainnet multi-identity automation feature.
- Rehearsal validation gating:
  the app now waits until the primary rehearsal node has actually been assigned
  validation hashes before allowing the handoff into validation, and the node
  panel shows assigned short/long-session flip counts on that primary node.
- Rehearsal failure handling:
  if a rehearsal run still reaches short session with no visible validation
  flips, the validation screen now exposes an explicit fresh-restart path
  instead of leaving the user in a silent `0 / 0` dead-end.
- Session-auto validation:
  once enabled, the app is now closer to true no-touch ceremony handling, with
  automatic route entry, provider-readiness retries during validation, ceremony-
  aware AI timing checks, and long-session auto-submit fallback when delayed AI
  report review is unavailable or misses its window.
- Fast report deadline mode:
  automatic report review now reserves the final 3 minutes of long session for a
  fast path. If the countdown is already below that threshold, the app skips
  extra keyword waiting, runs report-review requests in parallel, uses short
  provider timeouts, and still falls back to answer submission if review fails.
- Short/long autosolver timing:
  short session can solve all six flips with parallel in-flight provider calls,
  but OpenAI request launches are now paced with a small default delay instead
  of firing every request in the same tick. Long session keeps its slower
  staggered queue so completed answers are applied immediately and slow provider
  calls do not block the rest of the run.
- Validation AI fallback and telemetry:
  uncertain flips now escalate into annotated frame-review and final
  adjudication passes before the solver gives up. If no usable directional lean
  remains, or a provider fails, the app records the forced fallback decision in
  AI benchmark telemetry together with first-pass traces, reasoning, token
  usage, and price estimates where available.
- Rehearsal result review:
  rehearsal runs now expose end-of-session benchmark stats, optional audit/review
  flows, persistent human annotations by flip hash, and validation AI cost
  tracking on the post-session dashboard.
- Early local-results access:
  once long-session reporting starts, the app now exposes local stats and
  benchmark audit immediately instead of forcing the user to wait through the
  full realistic ceremony tail first; those local results pages stay live while
  the countdown continues and can jump back into validation at any time.
- OpenAI short-session fast mode:
  the app now supports an optional short-session-only OpenAI fast lane using
  `service_tier=priority` and `reasoning_effort=none`, with a visible fallback
  notice if the API shape is rejected or Priority is not actually applied. That
  fallback only affects short session; long session stays on the normal plan.
  OpenAI short-session launches default to a 500 ms request-start gap while
  still keeping the six solves mostly parallel.
- Local AI preparations:
  managed runtime trust gating, loopback-only runtime auth, RAM estimation work,
  and pinned manifest verification now cover the active research lanes for
  `Molmo2-O`, `Molmo2-4B`, `InternVL3.5-1B`, and `InternVL3.5-8B`, with the
  lighter `InternVL3.5-1B` lane now validated as a realistic same-provider
  managed-runtime candidate. The default managed install path targets the
  compact `Molmo2-4B` profile, and active managed setup/download jobs can be
  aborted or superseded before switching to another profile. The install flow
  now shows the exact model family, download size, RAM fit, and Hugging Face
  trust warning before users start a managed download.
- Dependency footprint:
  the desktop app now has a dependency-footprint audit, removes the direct
  `jimp` image stack, removes the root `idena-sdk-js` runtime dependency in
  favor of small audited internal helpers, upgrades the Electron runtime to
  `41.3.0`, pins source and CI installs to Node `24.15.0`, and treats new
  runtime npm dependencies as allowlist changes that require explicit review.
- Safety posture:
  none of the above changes make the project production-safe. The repo remains a
  research fork first.

## Current Stage

Current project posture:

- the desktop app is usable for research and controlled local experiments
- AI features remain explicitly experimental
- local AI is still an embryo-stage base-layer effort, not a settled product lane
- no local AI path in this repo should be treated as audited or production-safe
- validation rehearsal support exists to shorten iteration loops, not to guarantee correctness

What works today:

- AI settings and runtime controls inside the app
- provider-based solving, benchmarking, and AI-assisted FLIP generation
- optional short-session-only OpenAI fast mode with a visible fallback back to
  the normal OpenAI plan if the provider API no longer accepts the fast-lane
  request shape
- short-session OpenAI request launch pacing, so six parallel solves are not
  burst-started against the provider API at exactly the same moment
- in-app human-teacher annotation flows and demo/test paths
- local benchmark/session logging for traceability
- managed on-device runtime preparation for current research candidates
- local rehearsal-network controls inside the node settings page
- session-auto validation is now intended to manage ceremony route entry and
  long-session completion without manual babysitting once provider setup is
  genuinely ready
- urgent auto-report is expected to switch into the fast parallel review path
  whenever less than 3 minutes remain in long session
- local FLIP research scripts in `scripts/`

What is still not production-ready:

- packaged end-user release quality
- stable local-model defaults
- unattended on-chain AI automation
- federated-learning / networked training workflows
- polished first-run UX across all local-runtime paths
- a final approved bundled local model strategy

## Live Metrics

The app keeps local benchmark and validation-related metrics so experiments are easier to inspect.

- main local metrics path: `userData/ai-benchmark/`
- key log file: `userData/ai-benchmark/session-metrics.jsonl`
- local audits are written under `userData/ai-benchmark/audits/`
- test-unit queue and run artifacts also live under the same local directory

For source runs from the standard workspace layout, `npm start` resolves
`userData` under the workspace-local runtime directory:

```text
../IdenaAI-runtime/IdenaAI/ai-benchmark/
```

For a packaged macOS app, the same metrics path resolves under:

```text
~/Library/Application Support/IdenaAI/ai-benchmark/
```

Treat these files as experimental diagnostics:

- schemas may still change
- entries may be incomplete during crashes or interrupted runs
- do not build production assumptions on top of them yet

## Runtime and Data Paths

The app separates packaged data from source-run data.

Source runs started with `npm start` use `scripts/start-electron-dev.js`, which
defaults to a workspace-local runtime root next to the checked-out repository:

```text
../IdenaAI-runtime/IdenaAI/
```

For example, if the repository is checked out at:

```text
~/src/IdenaAI/
```

the default source-run `userData` path is:

```text
~/src/IdenaAI-runtime/IdenaAI/
```

Packaged builds default to the OS app-data directory with storage name
`IdenaAI`; on macOS that is usually:

```text
~/Library/Application Support/IdenaAI/
```

You can override the runtime directory explicitly:

```bash
IDENA_DESKTOP_USER_DATA_DIR=/absolute/path/to/idenaai-runtime npm start
```

For real validation, use the packaged IdenaAI app. `npm start` is a source
development runtime with a separate profile, and it refuses to start if that
profile has real on-chain `session-auto` armed unless
`IDENA_DESKTOP_ALLOW_DEV_SESSION_AUTO=1` is set deliberately.

Important subdirectories inside `userData`:

- `node/datadir/`: built-in node database, key material, and node API key
- `logs/`: Electron and app logs
- `ai-benchmark/`: validation and AI benchmark telemetry
- `validation-devnet/`: local rehearsal-network nodes and logs
- `local-ai/`: local AI configuration, captures, and managed-runtime state

## Validation Rehearsal Devnet

The repo now includes an isolated validation rehearsal path inside the desktop app.

What it is:

- a private local multi-node Idena network for rehearsal runs
- seeded with FLIP-Challenge flips for local short-session practice
- separate from mainnet and intended for protocol-flow testing

What you can do from `Settings -> Node`:

- start and use the rehearsal network immediately
- start it in the background without switching the app over yet
- run one rehearsal autosolve lane against the current local devnet status
- optionally run nine parallel rehearsal-only participant lanes against the
  current local devnet status
- restart a fresh rehearsal network
- stop the rehearsal network

Behavior notes:

- the app can connect to the rehearsal node for the current app session only
- that rehearsal connection is transient and should not overwrite your normal saved node settings
- the app exposes live status and rehearsal-network logs in the same settings panel
- the app now waits for assigned validation hashes on the primary rehearsal node
  before switching into validation, instead of handing over as soon as the
  private network merely looks alive
- the node settings screen shows assigned short/long-session flip counts on the
  primary rehearsal node so the handoff state is visible
- if a rehearsal run still enters validation without flips, the validation page
  should now offer a restart path instead of hanging indefinitely in a silent
  `0 / 0` waiting state
- short-session AI results now remain visible briefly after submission so the
  benchmark telemetry can still be inspected before the UI switches into long
  session
- long-session AI telemetry now shows per-flip decision traces, including raw
  skips, reprompt frame-review passes, random fallback votes, and reasoning
  summaries for those decisions
- rehearsal results can be audited afterwards, or skipped in one click and
  revisited later, with annotations stored for later local-training research
- local stats and benchmark annotation can now open during the long-session
  countdown as soon as reporting is available, instead of only after the full
  post-session wait has ended
- those local results and annotation screens now refresh live from persisted
  validation state while the countdown is still running
- the default rehearsal autosolve uses one local identity and the current AI
  provider/model for a local dry run only
- the optional nine-participant rehearsal uses the same AI provider/model,
  staggers provider request starts, records compact per-participant telemetry,
  and does not submit answers or touch mainnet identities
- this is still experimental and can still break in edge cases

## Local AI Preparations

Local AI is deliberately conservative right now.

- there is still no permanently approved bundled local base model
- the managed local runtime is a research path, not a final endorsement
- first use asks for an explicit one-time trust approval before installing and starting managed runtime components
- the managed runtime is loopback-only and token-gated
- trusted runtime files and model shards are verified before startup
- RAM estimation and reserve controls are now part of the local-runtime setup flow

Prepared research lanes currently include:

- `allenai/Molmo2-O-7B` as the main managed research runtime
- `allenai/Molmo2-4B` as a more compact managed fallback
- `OpenGVLab/InternVL3_5-1B-HF` as the light same-provider alternative
- `OpenGVLab/InternVL3_5-8B-HF` as a heavier experimental alternative

Advanced users can still point the app at their own local-only:

- Ollama runtime
- MLX / MLX-VLM setup
- Transformers-based server
- `vLLM` endpoint

In short: local AI experiments are enabled, but the broader local-model direction is still being evaluated.

## Session-Auto Validation

`session-auto` is meant to reduce or remove ceremony babysitting, but it is
still experimental and should not be blindly trusted.

Real on-chain `session-auto` is disabled in dev builds started with
`npm start`; use the installed app for real ceremonies. Dev builds can still run
the off-chain solver preview and validation rehearsal network.

Current intended behavior:

- auto-route into the validation flow when the real ceremony reaches the right phase
- retry provider-readiness checks during the session instead of depending on a
  single lucky startup check
- optionally use an OpenAI-only short-session fast lane with Priority
  processing and reduced reasoning effort, while automatically degrading to the
  normal OpenAI plan if the API shape changes or fast-lane handling is rejected
- keep short-session OpenAI solving parallel, but stagger provider request
  launches by default so the API does not receive every flip request in one
  burst
- refuse late AI runs when too little short- or long-session time remains, with
  short-session automation targeting submission before the final safety buffer
- escalate uncertain flips into annotated frame-review and final adjudication
  passes instead of silently leaving them as skips
- if a flip still cannot be resolved after those passes, apply a forced fallback
  vote and record that fact in telemetry rather than hiding the outcome
- submit long-session answers automatically even when delayed AI report review is
  disabled, unsupported, or fails
- start automatic report review early enough to keep a 3-minute safety window;
  inside that window, use the fast report path with parallel calls, no keyword
  wait loop, no retries, and shorter provider timeouts

Current limitation:

- short session is still the hardest window to hit reliably because image fetch,
  node readiness, and model latency all compete with protocol timing
- you should still assume short-session automation can miss under bad network,
  slow provider, or reconnect-heavy conditions

## Real Session Auto-Solve With OpenAI

Use this path only if you understand the risk. There are no guarantees: the app,
the node, the OpenAI API, the model, the network, or your machine can fail at
the wrong time. The AI can also submit wrong answers. Any missed validation,
wrong submission, reward loss, identity impact, API cost, or other consequence
is your own responsibility.

Required startup for a real identity:

- use the packaged or installed `IdenaAI` app, not `npm start`
- use a real mainnet identity in that packaged app profile
- keep the node online, synced, and eligible for the next ceremony
- keep the app open, the computer awake, and the internet connection stable
- stay nearby and watch the ceremony; this is not unattended production software

Why the packaged app matters: source runs started with `npm start` use the
workspace-local development profile under `../IdenaAI-runtime/IdenaAI/`.
Packaged macOS runs use `~/Library/Application Support/IdenaAI/`. Real
on-chain `session-auto` is intentionally blocked in dev builds so users do not
accidentally arm automation in the wrong profile with no real identity.

Build and start a packaged app locally on macOS:

```bash
nvm use
npm ci
npm run dist:mac:arm64
open "dist/mac-arm64/IdenaAI.app"
```

For Intel or universal macOS builds, use `npm run dist:mac` or
`npm run dist:mac:universal` and open the generated `IdenaAI.app` from `dist/`.
If you downloaded an installed release instead, start that installed app
normally.

OpenAI `gpt-5.5` example:

1. Start the packaged `IdenaAI` app.
2. Make sure the app is using your real mainnet identity and real mainnet node,
   not the validation rehearsal network.
3. Open `Settings -> AI`.
4. Turn on AI.
5. Choose `Use external API provider`.
6. Set `Main AI provider` to `OpenAI`.
7. Paste your OpenAI API key and click `Set key`.
8. Choose `gpt-5.5`, or enter `gpt-5.5` as the custom model id.
9. Click `Test connection` and confirm the configured model works before the
   validation window.
10. Open `Validation`.
11. Click `Enable auto-solve next session`.
12. Keep the packaged app running through the ceremony and monitor short and
    long session submissions.

Do not commit API keys, screenshots containing keys, `settings.json`, node data,
or files from `~/Library/Application Support/IdenaAI/`. Keep provider spending
limits low until you have your own successful rehearsal and smoke-test history.
`IDENA_DESKTOP_ALLOW_DEV_SESSION_AUTO=1` is only a deliberate developer override
for local testing; it is not the recommended real-session path.

## Safety and Privacy

Treat this repository as test software and assume mistakes are possible.

Recommended precautions:

- use a low-value or disposable Idena identity
- do not attach valuable identities, valuable wallets, or long-lived production secrets
- keep provider budgets small
- prefer a separate machine, VM, or OS user profile
- use only a secured system you control
- review AI-generated flips manually before publishing on-chain
- review local runtime downloads and diffs before trusting them
- ask an AI agent to audit your local branch and adjust it to your own threat model

If human annotations are later used for shared training, those contributions may
become part of propagated model artifacts. Only contribute material you have the
right to share.

## Standalone Boundary and Dependency Footprint

The project boundary is intentionally split:

- `idena-go` is the Bitcoin-like standalone protocol layer: one node binary plus
  its data directory, with no npm runtime requirement
- IdenaAI desktop is an optional Electron UX shell for node control, social UI,
  validation rehearsal, and AI research
- local AI models are downloaded only on demand and should not be bundled into
  repo history or release artifacts
- vendored `idena.social-ui` output must not bring its own `node_modules` into
  packaged builds

Dependency policy:

- prefer browser Canvas, built-in `fetch`, Node core modules, and small internal
  helpers before adding runtime npm packages
- keep heavier migrations, such as storage or UI framework replacement, as
  separate reviewed work
- keep future Electron upgrades as separate modernization work. The current
  desktop line pins Electron to `41.3.0` and requires Node `24.15.0+` on Node
  24 LTS; `.nvmrc`, `.node-version`, and CI currently pin Node `24.15.0` for
  reproducible installs and builds
- use `npm run audit:deps` to inspect root runtime deps, production transitive
  package count, largest installed packages, production audit summary, and
  packaged-file risk
- new root runtime dependencies should update
  `scripts/dependency-footprint-baseline.json` only when the extra surface is
  intentional

## Install and Run from Source

Prerequisites:

- `git`
- Node 24 LTS; `.nvmrc` and `.node-version` pin `24.15.0`
- `npm`
- `python3`

With `nvm`:

```bash
nvm install
nvm use
node -v
```

On macOS with Homebrew:

```bash
xcode-select --install
brew install git node@24 python@3
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
node -v
```

Clone and start:

```bash
git clone https://github.com/ubiubi18/IdenaAI.git
cd IdenaAI
nvm use
npm ci
npm start
```

Optional build:

```bash
npm run build
npm run dist
```

For explicit macOS targets on Apple Silicon:

```bash
npm run pack:mac:arm64
npm run pack:mac:universal
```

Useful checks:

```bash
npm run audit:privacy
npm run audit:electron
npm run audit:deps
npm test
```

## User Paths

Use these paths after `npm start`.

### GPT-5.5 API Smoke Test

1. Open `Settings -> AI`.
2. Turn on AI and choose `Use external API provider`.
3. Set `Main AI provider` to `OpenAI`.
4. Paste your OpenAI API key and click `Set key`.
5. Choose `gpt-5.5`, or enter `gpt-5.5` as a custom model id.
6. Click `Test connection`.

If the key does not have access to `gpt-5.5`, the provider bridge records the
fallback and can retry the configured fallback model.

### Managed Local AI

1. Open `Settings -> AI`.
2. Turn on AI.
3. Use the managed local runtime path.
4. Review the RAM/disk warning and Hugging Face trust prompt.
5. Start the preparation and wait until the runtime is ready.

The managed local path is for research. It can take several minutes on first
startup and can fail on low-memory machines.

### Validation Rehearsal

1. Open `Settings -> Node`.
2. In `Validation Rehearsal Devnet`, click `Start and use rehearsal network`.
3. Wait for the private network to run and for the app to switch to the
   rehearsal node.
4. Use `Open countdown` or `Open validation` when those buttons become
   available.
5. Click `Run 1 rehearsal autosolve` to dry-run the current AI provider/model
   against one local rehearsal validator.
6. Optionally click `Run optional 9-ID parallel rehearsal` to test whether the
   same provider key and machine can handle nine local rehearsal participants.

The rehearsal path is local-devnet only. It is meant for benchmark and protocol
flow testing, not for multi-identity mainnet automation.

### Flip Builder And Off-Chain Solving

1. Open `Flips -> New`.
2. Build or edit a draft flip.
3. Click `Build flips` if you want AI-generated panels.
4. Click `Add current draft flip to queue`.
5. Use `Run current draft now`, `Run short (6)`, or `Run long (14)` to compare
   model behavior before publishing.

This path benchmarks the selected provider/model on queued flips. It does not
train the local model and does not publish a flip unless you continue through
the normal submit flow yourself.

### Live Validation Automation

1. First complete a rehearsal run with the same AI settings.
2. Open `Validation`.
3. Click `Enable auto-solve next session`.
4. Keep the app open and watch the session.

Use this only with throwaway or low-value identities. It is still experimental
and should not be treated as unattended production validation.

### Results And Logs

Local run data is written under `userData/ai-benchmark/`.

- `session-metrics.jsonl`: per-session and per-flip AI traces
- `audits/`: local review and benchmark audit output
- post-session validation pages: local stats, costs, fallback traces, and
  rehearsal benchmark summaries where labels are available

## Training Workflow

The local FLIP training stack remains in the repo for research.

It currently supports:

- FLIP-Challenge dataset prep from Hugging Face
- human-teacher annotation import
- local LoRA pilot training experiments
- matrix comparison of baseline vs human-assisted modes
- side-by-side comparison of `best_single` vs `deepfunding`

Important limitation:

- no approved bundled local training base model is currently endorsed by the project

Start here:

- [docs/flip-challenge-local-training.md](docs/flip-challenge-local-training.md)

Related notes:

- [docs/local-ai-mvp-architecture.md](docs/local-ai-mvp-architecture.md)
- [docs/federated-model-distribution.md](docs/federated-model-distribution.md)
- [docs/federated-human-teacher-protocol.md](docs/federated-human-teacher-protocol.md)

## Large bundled artifacts

This repo intentionally carries large static libraries in `idena-wasm-binding/lib/` for reproducible local builds.

It also carries the chunked `samples/flips/flip-challenge-human-teacher-500-balanced.part-*.json` rehearsal sample shards. Those shards keep the local validation rehearsal and benchmark loop reproducible without requiring a network fetch, while staying below GitHub's hard per-file limit.

If public release packaging becomes more formal later:

- keep those files under review before every tag
- consider Git LFS or external release artifacts if the bundle grows further
- make sure `THIRD_PARTY_NOTICES.md` ships with any redistributed binary bundle

## Development History

Very short overview:

- `Phase 1`: desktop fork created to explore AI inside `idena-desktop`
- `Phase 2`: human-teacher annotation and local training research were added
- `Phase 3`: provider benchmarking, solving, and generation were separated from local-model-training semantics
- `Phase 4`: the old local base-model direction was reset and the project returned to embryo stage for local AI while `Molmo2-O` and alternative managed lanes are evaluated
- `Phase 5`: local rehearsal devnet controls, live metrics, and explicit managed-runtime preparation lanes were added to tighten the research loop inside the app
- `Phase 6`: dependency footprint work removed the old direct `jimp` and
  `idena-sdk-js` runtime paths, added dependency audits, and upgraded the
  Electron runtime to `41.3.0`
- `Phase 7`: session-auto validation was hardened with short-session parallel
  solving, long-session staggered solving, AI cost telemetry, report-review
  deadlines, local rehearsal audit, and explicit fallback traces
- `Phase 8`: local AI setup was hardened with a compact 4B default, RAM-fit
  warnings, Hugging Face trust dialogs, abort/switch controls, and
  workspace-local dev data paths
- `Phase 9`: the install and CI runtime was standardized on Node `24.15.0`
  through `.nvmrc`, `.node-version`, package `engines`, preinstall checks, and
  GitHub Actions

## License

MIT. See [LICENSE](LICENSE).
