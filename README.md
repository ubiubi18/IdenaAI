# IdenaAI

**An experimental Idena desktop app for AI-assisted flip creation, solving, and validation research.**

IdenaAI is a community fork of [idena-desktop](https://github.com/idena-network/idena-desktop).
It brings the Idena node, hosted and local AI tools, repeatable flip benchmarks,
a private validation rehearsal network, and embedded idena.social into one app.

New to [Idena](https://www.idena.io/)? It is a proof-of-personhood blockchain
whose validation sessions use common-sense picture puzzles called
[flips](https://www.idena.io/flip-challenge). Solving a flip means choosing which
of two picture sequences tells the more logical story. IdenaAI provides tools
to explore how AI performs at creating and solving these puzzles.

> **Research software.** AI decisions and timing can fail, and autosolve can
> submit real answers on-chain. Start with a separate profile and an off-chain
> experiment. The published binaries are unsigned developer artifacts; this
> project does not provide a hardened wallet release or guarantee validation success.

[Get started](#get-started) · [First experiment](#try-a-small-off-chain-benchmark) ·
[AI setup](#choose-an-ai-provider) · [Rehearsal](#rehearse-a-validation-session) ·
[Documentation](#documentation) · [Report an issue](https://github.com/ubiubi18/IdenaAI/issues)

## What you can do

- **Create and solve flips with AI.** Draft picture stories, compare solver
  decisions, and explore optional validation automation.
- **Benchmark models off-chain.** Import labeled flips and inspect answers,
  accuracy, timing, and usage without publishing a transaction.
- **Rehearse validation.** Run a private local network to test the session flow
  before using a real identity.
- **Choose hosted or local inference.** Connect a provider API or a compatible
  local runtime; capture examples and review human annotations for research.
- **Use the Idena desktop and social tools.** Run a managed node built from
  pinned sources or connect an external node, and access idena.social posts
  and encrypted messages from the desktop.

Local training, federated model distribution, and knowledge-index work remain
experimental. Architecture documents describe both implemented pieces and
planned work; they are not a list of finished features.

## Get started

The source workflow below is the entry point for evaluating the current code on
macOS, Windows, or Linux. You need a graphical desktop; a remote server needs a
GUI session such as VNC or RDP to run Electron.

### Requirements

| Requirement          | Version or purpose                                                           |
| -------------------- | ---------------------------------------------------------------------------- |
| Node.js              | `24.18.0` or newer within Node 24; Node 25+ is rejected                      |
| npm                  | `11.16.0` or newer                                                           |
| Git                  | Clone this repository and the pinned node sources                            |
| Python               | `3.11+` for helper pipelines and native dependency builds                    |
| Platform build tools | Required for Electron's native dependencies; see below                       |
| Go                   | Needed for managed-node builds and rehearsal; the builder selects `go1.26.5` |

[`.nvmrc`](.nvmrc) pins Node for version-manager users. Dependency versions and
commands live in [`package.json`](package.json); the exact dependency tree is
recorded in [`package-lock.json`](package-lock.json).

<details>
<summary>Platform setup notes</summary>

- **macOS:** Install Xcode Command Line Tools, Git, Node 24, Python, and Go.
  With Homebrew's `node@24`, ensure that version is on your `PATH`.
- **Windows:** Use PowerShell and a short checkout path. Install Git, Node 24,
  Python, Go, Visual Studio Build Tools, and MSYS2/UCRT64. Ensure UCRT64's `gcc`
  is available on `Path`.
- **Linux:** Install Node 24, Python, Go, a compiler toolchain, and your
  distribution's Electron runtime libraries. Keep Electron's sandbox enabled.
  The [managed Linux deployment notes](docs/unattended-validation.md) explain
  the repository's path-specific AppArmor setup for Ubuntu hosts that restrict
  user namespaces.

</details>

### Install and launch

```bash
git clone https://github.com/ubiubi18/IdenaAI.git
cd IdenaAI
npm ci
npm run setup:sources
npm run doctor
npm start
```

`npm ci` installs the locked dependencies and rebuilds native modules for
Electron. `setup:sources` fetches the exact node and Wasm-binding revisions from
[`scripts/source-manifest.json`](scripts/source-manifest.json). These steps
need internet access and may take time on a fresh machine. Resolve any `NO`
items reported by `doctor` before continuing.

On first launch, wait for the renderer to compile and the Electron window to
open. Keep the terminal running while you use the app.

By default, `npm start` uses `../IdenaAI-runtime/IdenaAIDev` relative to the
checkout, separate from the normal installed-app profile. **A separate profile
is not a private network:** choose rehearsal explicitly before testing a
validation session.

## Choose an AI provider

You can explore the app without an AI API key. To run a solver or generate
stories, configure a hosted provider or a local runtime in **Settings → AI**.

### Hosted provider

1. Enable AI and choose **Use external API provider**.
2. Select your provider and a model available to your account. For image-based
   flip solving, use a model that accepts images.
3. Enter the provider's API key and click **Set key**.
4. Set a local daily budget and click **Test connection**.

The app includes integrations for OpenAI, Anthropic, Gemini, DeepInfra,
OpenRouter, and other providers, plus a custom OpenAI-compatible endpoint.
The **Qwen 3.6 via DeepInfra** preset selects `Qwen/Qwen3.6-35B-A3B`.
Repository defaults are listed in
[`main/ai-providers/constants.js`](main/ai-providers/constants.js); provider
availability and billing depend on your account.

Hosted calls send prompts and relevant images to the selected provider and can
incur charges, including during benchmarks and rehearsal. The app's daily cap
only limits calls from that local profile. Configure spending limits and alerts
with the provider as well.

### Local runtime

Choose **Local AI runtime** and configure a compatible loopback service, such
as Ollama, LM Studio, or a compatible local inference server. Image-based flip
solving requires a vision-capable model and runtime; a text-only model is not
sufficient.

The managed **Install Qwen3.6 35B locally** option downloads about **67 GiB** of
model files before runtime overhead and is intended for machines with substantial
GPU memory. Review the [local AI setup guide](docs/local-ai-qwen36-gguf.md)
before downloading it. Local inference and model training are separate workflows.

## Try a small off-chain benchmark

Start with the bundled five-flip sample to check that your chosen provider or
runtime works before importing a larger dataset:

1. In **Settings → AI**, choose **Open off-chain benchmark**. If the builder is
   waiting for a node, select **Start local builder now**.
2. Expand **Show advanced import**, then choose **Load JSON file** and open
   [`samples/flips/flip-challenge-test-5-decoded-labeled.json`](samples/flips/flip-challenge-test-5-decoded-labeled.json)
   from your checkout.
3. Choose **Run JSON now**.
4. Review the answers against the labels, along with timing and usage.

This benchmark runs without publishing flips or submitting validation answers.
A hosted provider can still charge for inference. Five examples are a setup
check, not evidence of general model accuracy or readiness for a live ceremony.

For larger experiments, see the [dataset import reference](docs/flip-challenge-import.md)
and [Qwen benchmark runbook](docs/qwen-deepinfra-benchmark.md). Older references
to **AI Test Unit** now lead to the central AI settings page.

## Rehearse a validation session

Rehearsal tests the session flow on a private network. It does not require a
valuable mainnet identity.

1. Start the source app with `npm start` and open **Settings → Node**.
2. Select **Start autosolve rehearsal** or **Start and use rehearsal network**.
3. Choose **Remote provider API**, **Local AI runtime**, or **No AI yet**.
4. Follow readiness, seed-flip, and log status, then open validation when the
   rehearsal session is ready.
5. Review the results before changing provider settings or attempting a real session.

**No AI yet** starts the network without enabling the solver. Remote-provider
rehearsal can incur API costs; multiple rehearsal identities increase usage.
A successful rehearsal cannot reproduce every mainnet timing or provider failure.

## Data, privacy, and real validation

App profiles hold identity keys, node data, settings, logs, and research output.
Back up the intended profile before changing how you run the app. Keep keys,
credentials, private datasets, and unredacted logs or screenshots out of Git and
public issue reports.

| Launch method / platform | Default profile                                           |
| ------------------------ | --------------------------------------------------------- |
| `npm start`              | `../IdenaAI-runtime/IdenaAIDev`, relative to the checkout |
| Installed app on macOS   | `~/Library/Application Support/IdenaAI`                   |
| Installed app on Windows | `%APPDATA%\IdenaAI`                                       |
| Installed app on Linux   | `$XDG_CONFIG_HOME/IdenaAI`, usually `~/.config/IdenaAI`   |

`IDENA_DESKTOP_USER_DATA_DIR` overrides the profile path. Startup logs identify
the selected profile. The source runtime refuses startup if real-validation
`session-auto` is already armed, unless explicitly overridden.

<details>
<summary>Advanced: deliberately run a real validation profile from source</summary>

Use only after reviewing the code and testing the flow. Confirm the intended
identity, mainnet connection, synchronization, eligibility, provider readiness,
and budget before arming autosolve. Keep the app and machine awake and avoid
running a rehearsal during the real validation window.

The override below bypasses the source-startup guard. It does not itself enable
AI, load a provider key, or grant on-chain submission consent; configure those
separately in the app.

**macOS**

```bash
IDENA_DESKTOP_USER_DATA_DIR="$HOME/Library/Application Support/IdenaAI" \
IDENA_DESKTOP_ALLOW_DEV_SESSION_AUTO=1 \
npm start
```

**Windows PowerShell**

```powershell
$env:IDENA_DESKTOP_USER_DATA_DIR="$env:APPDATA\IdenaAI"
$env:IDENA_DESKTOP_ALLOW_DEV_SESSION_AUTO="1"
npm start
```

**Linux**

```bash
IDENA_DESKTOP_USER_DATA_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/IdenaAI" \
IDENA_DESKTOP_ALLOW_DEV_SESSION_AUTO=1 \
npm start
```

For managed Linux hosts, see [unattended validation](docs/unattended-validation.md).
That document includes deployment-specific paths and historical model examples;
check them against your host and current settings before use.

</details>

### Embedded idena.social

Open **idena.social → Messages**, add recipients by Idena address, then compose
and review the message before sending. Recipients need discoverable public keys;
the UI also offers manual public-key entry. Sending messages uses the social
contract and incurs normal Idena transaction fees.

The desktop's main process handles private-key operations for the supported
message path; the embedded page receives decrypted message text, not the private
identity key. Legacy messages may require the social app's manual session credentials.

## Source and release status

`main` contains ongoing development; the package version is currently `0.1.0`.
The [published v0.1.0 release](https://github.com/ubiubi18/IdenaAI/releases/tag/v0.1.0)
contains older, unsigned and unnotarized developer artifacts for Linux, macOS,
and Windows. Those binaries do not represent all changes now on `main`.

The successful [v0.1.0 build run](https://github.com/ubiubi18/IdenaAI/actions/runs/29254090708)
used commit `6567d4498973741a48cf7fc22efac631f9afcfa3`. The tag moved during
release bring-up, so use the build commit and GitHub asset digests when checking
provenance. The current release workflow rejects reuse of a published tag.

Both the [compatibility lock](compatibility/stack-lock.json) and
[application release lock](compatibility/application-release-lock.json) remain
`candidate`. Installer creation and tagged releases require approved evidence.
Automated checks alone do not establish live-chain compatibility; see the
[compatibility evidence requirements](compatibility/README.md).

### Nix / NixOS

The repository includes a locked Linux flake for `x86_64-linux` and
`aarch64-linux`. With Nix flakes enabled, run these from the checkout:

```bash
nix run .#idenaai
nix build .#idena-go
nix build .#idena-social-ui
nix develop
```

The app package uses a prebuilt renderer served on loopback and the normal Linux
profile, rather than the `npm start` practice profile. Set
`IDENA_DESKTOP_USER_DATA_DIR` for a separate experiment. Runtime data stays outside
the Nix store, and the same source-runtime session-auto guard applies.

## Development and checks

| Command                 | Purpose                                                 |
| ----------------------- | ------------------------------------------------------- |
| `npm run doctor`        | Inspect source prerequisites and profile defaults       |
| `npm run setup:sources` | Fetch or restore source checkouts to manifest revisions |
| `npm run setup:flips`   | Prepare larger local flip datasets                      |
| `npm run build:node`    | Build the pinned node into `build/node/current/`        |
| `npm run build:social`  | Build and sync the embedded social UI                   |
| `npm run build`         | Build the social UI and desktop renderer                |
| `npm run pack`          | Create an unpacked developer build                      |
| `npm run release:check` | Run release-oriented source, safety, and build checks   |

Source setup creates ignored `idena-go/` and `idena-wasm-binding/` directories
at the repository root. The social UI is tracked under `vendor/idena.social-ui/`;
its origin and integration notes are in
[`UPSTREAM.json`](vendor/idena.social-ui/UPSTREAM.json). Keep generated source
mirrors, model weights, runtime profiles, and build output out of commits.

For contributions, keep changes focused and run the checks relevant to the
behavior you changed. Common code checks are:

```bash
npm run lint -- --quiet
npm test -- --runInBand
npm run audit:privacy
```

For documentation-only edits, review the content, commands, links, and rendered
Markdown. When reporting a bug, include the commit from `git rev-parse HEAD`,
your OS and runtime versions, reproduction steps, and redacted error output.
Use [GitHub Issues](https://github.com/ubiubi18/IdenaAI/issues) or submit a pull request.

## Documentation

| Topic                        | Start here                                                                                                                       |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Local models and hosted Qwen | [AI setup guide](docs/local-ai-qwen36-gguf.md)                                                                                   |
| Larger flip experiments      | [Dataset import](docs/flip-challenge-import.md) · [Benchmark runbook](docs/qwen-deepinfra-benchmark.md)                          |
| Flip data structure          | [Format reference](docs/flip-format-reference.md)                                                                                |
| Release compatibility        | [Evidence and approval requirements](compatibility/README.md)                                                                    |
| Managed Linux operation      | [Unattended validation](docs/unattended-validation.md)                                                                           |
| Local AI and human review    | [Architecture](docs/local-ai-mvp-architecture.md) · [Annotation design](docs/human-teacher-annotation-architecture.md)           |
| Research plans               | [Federated model distribution](docs/federated-model-distribution.md) · [Source-backed knowledge](docs/source-backed-rag-plan.md) |

Research notes and runbooks may include dated measurements, model defaults, and
machine-specific examples. Use the current source and lockfiles for exact versions.

## License and upstream

The desktop fork and community modifications are [MIT-licensed](LICENSE), with
credit to the original Idena contributors. Bundled and downloaded components
have their own licenses, including LGPL components in the node stack. See
[Third-Party Notices](THIRD_PARTY_NOTICES.md) before redistribution.

Model weights, datasets, and provider services require their own license or
terms review. Run `npm run audit:local-ai-model-licenses` when changing the
local model defaults.
