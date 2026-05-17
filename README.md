# IdenaAI v0.0.8

IdenaAI is an experimental desktop fork of `idena-desktop` for validation,
FLIP, local AI, and rehearsal research.

It is not a hardened wallet release, not a trusted installer distribution, and
not a guarantee of validation success. Build and inspect it locally. Use it at
your own risk.

## v0.0.8 Focus

This release is mainly a validation-safety and debugging release after the May
2026 live-session audit.

- Remote-provider validation solving uses probability ensemble by default.
- Rehearsal remote-provider autosolve now follows the same probability
  ensemble path as real validation.
- Normal live solving no longer globally swaps left/right sides. Candidate
  order swapping is only allowed inside tracked probability-ensemble runs.
- Long-session submission keeps side choice and grade/report data separate.
  `GradeC` and `Inappropriate` cannot be submitted as side choices.
- The failed long-session mode was removed from default/rehearsal paths.
- Rehearsal lanes use composite flip payloads like the live path.
- Long-session rehearsal can keep low-delta probability results as `skip` for
  audit instead of forcing the old binary side-choice fallback.
- The validation AI cost tracker bug was addressed. Local tracking is better,
  but provider billing remains the user's responsibility.
- `idena.social-ui` is bundled from upstream `v11.3.0` with ad fetching and ad
  panels removed from the desktop bundle.
- Local IPFS inspection commands are available for moderation/audit work.

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
- Node.js `24.15.x`
- npm `11.12.x`
- Git

Install and run:

```bash
git clone https://github.com/ubiubi18/IdenaAI.git
cd IdenaAI
npm install
npm start
```

Useful checks:

```bash
npm run doctor
npm test -- --runInBand
npm run lint -- --quiet
npm run audit:privacy
```

For source-built node work:

```bash
npm run setup:sources
npm run build:node
```

Packaged builds are developer/debugging artifacts. The source run is the
preferred path for research and auditing.

## Real Validation Startup

For a real validation source run on macOS, use the real app profile and allow
session-auto only when you intentionally want it:

```bash
cd "$HOME/Documents/idena-benchmark-workspace/IdenaAI"
IDENA_DESKTOP_USER_DATA_DIR="$HOME/Library/Application Support/IdenaAI" \
IDENA_DESKTOP_ALLOW_DEV_SESSION_AUTO=1 \
npm start
```

Before a real session:

- confirm the app is connected to the real chain, not the rehearsal node
- confirm peer count and node sync
- confirm AI provider, model, API key, and local daily cap
- confirm `probabilityEnsembleEnabled` is on for remote providers
- do not run rehearsal during a real validation window

## Rehearsal First

Use rehearsal before real validation.

1. Open `Settings -> Node`.
2. Turn off `Run built-in node` for a clean local rehearsal.
3. Click `Start autosolve rehearsal`.
4. Choose one setup mode:
   - `Remote provider API`
   - `Local AI runtime`
   - `No AI yet`
5. Watch node readiness, seeded flip counts, and logs on the same settings
   page.
6. Open validation when the rehearsal session is ready.
7. Review the audit/results screen after the run.

Remote-provider rehearsal can run one primary identity plus optional
participant lanes. A 9-ID participant rehearsal can multiply provider cost.
Keep local and provider-side budgets low until you know the behavior.

## Probability Ensemble

The current remote-provider solver does not ask the model for a single rushed
left/right answer. It asks for probability scores for both candidate stories.

Default remote path:

- score Option A and Option B independently
- optionally swap A/B presentation inside tracked probability runs
- map A/B scores back to original left/right before aggregation
- choose the higher side only when the probability separation is meaningful
- keep side choice separate from grade/report metadata

Short-session OpenAI parallel mode may use two probability runs to stay inside
the submit window. The general default is three runs.

The mental model is:

1. First pass: trust only very strong results, around `0.95`.
2. Second pass: accept a clearer re-score around `0.80`.
3. Third/final pass: use the best available probability result when time is
   nearly gone.

This reduces side and position bias. It does not eliminate model error,
provider outages, latency risk, API cost, or validation risk.

## Debugging Notes

The failed long-session audit showed two important failure modes:

- Long-session `answer` was allowed to collide with grade/report values. This
  made `GradeC` / `Inappropriate` capable of replacing a left/right side
  choice. `v0.0.8` guards this path.
- Non-probability long solving used side-swap/remap behavior that did not match
  real submission semantics. `v0.0.8` keeps normal solving in original order
  and limits candidate swapping to tracked probability-ensemble runs.

When debugging a future run, check:

- `probabilityEnsembleEnabled`
- `probabilityEnsemble.runs[*].optionATo` and `optionBTo`
- `rawAnswerBeforeRemap`
- `finalAnswerAfterRemap`
- `sideSwapped`
- submitted long-session `answer`
- submitted long-session `grade`
- provider errors, forced decisions, and skipped low-delta decisions
- the local cost ledger and the provider dashboard

Important invariant:

```text
long-session answer: none | left | right
report/quality grade: separate grade/report field
```

## IPFS Inspection

RPC-backed inspection while the node is reachable:

```bash
npm run ipfs:inspect
```

Offline inspection of the stopped embedded repo:

```bash
npm run ipfs:inspect:offline
```

This is a local moderation/audit aid. It does not prove authorship by itself
and does not make third-party IPFS content safe.

## Local AI

Local AI support is research-grade.

- Local chat/code paths can use Ollama-compatible local models.
- Local AI avoids hosted provider billing but depends on your hardware.
- Local model licenses must be audited before redistribution or bundled use.
- The AGInt / IdenaAI AGInt Core research fork is separate from this main app
  integration line.

## idena.social Bundle

The desktop bundle includes an `idena.social-ui` snapshot for the local desktop
integration. The v0.0.8 line keeps upstream `v11.3.0` functionality relevant to
the desktop/on-chain bridge while removing upstream ad fetching and ad panels
from the bundled app.

## Important Local Data

On macOS the main app profile is usually:

```text
~/Library/Application Support/IdenaAI
```

Important subfolders:

- `node/datadir/`: node database, keys, node API key
- `logs/`: app and node logs
- `ai-benchmark/`: validation and AI telemetry
- `validation-devnet/`: rehearsal node data and logs
- `local-ai/`: local AI configuration and captures

Do not commit these folders or private keys.

## Useful Commands

```bash
npm start
npm run doctor
npm run setup:sources
npm run build:node
npm run build
npm run dist
npm test -- --runInBand
npm run lint -- --quiet
npm run audit:privacy
npm run audit:local-ai-model-licenses
npm run ipfs:inspect
npm run ipfs:inspect:offline
```

## Current Status

What works for research:

- source-run Electron desktop app
- real-chain node connection and validation UI
- private rehearsal devnet
- remote-provider AI solving
- probability-ensemble validation research
- AI cost telemetry and local daily provider guardrail
- local AI experiments
- IPFS inspection helpers

Still experimental:

- unattended real validation
- unattended reporting
- packaged end-user release quality
- local model defaults
- local/federated training workflows
- AGInt research architecture

Do not treat this as a production wallet or a guaranteed validation tool.
