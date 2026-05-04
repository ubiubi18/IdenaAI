# IdenaAI v0.0.4

`IdenaAI` is an experimental desktop fork of `idena-desktop` focused on:

- local and hosted AI integration
- FLIP solving, generation, and benchmarking research
- human-teacher annotation flows
- local runtime and training experiments tied to the desktop app
- validation rehearsal tooling for safer local protocol testing

This repository is the main app-integration line. Version `0.0.4` is a
reference checkpoint for dependency, runtime, local AI, rehearsal, packaging,
and autosolver work. It is research software, not a hardened wallet release and
not a trusted installer distribution.

## First Installation

- [first installation on mac](#first-installation-on-mac)
- [first installation on windows](#first-installation-on-windows)

Use the walkthrough for your operating system only. On Mac, open the Terminal
app. On Windows, open Windows PowerShell or Windows Terminal with a PowerShell
tab. Do not paste Windows PowerShell commands into Mac Terminal, and do not
paste Mac Terminal commands into Windows PowerShell.

For each step, copy only the grey code block under that step. On GitHub you can
usually use the small copy button on the code block; otherwise select the lines
and copy with `Cmd+C` on Mac or `Ctrl+C` on Windows. Paste into the terminal
with `Cmd+V` on Mac or `Ctrl+V` / right-click on Windows, then press `Enter` if
it does not start automatically. Wait until the command finishes and the normal
prompt comes back before moving to the next step. If a password is requested on
Mac, type it even if no characters appear. If an installer window opens, finish
that installer before continuing.

If a command shows an error, stop at that step. Copy the command you ran, the
full error text, your operating system version, and the output from
`npm run doctor` if available, then ask an AI assistant or someone technical to
help debug that exact step.

## First Installation On Mac

These steps assume a fresh macOS machine with no Git, Node, npm, Go, Python, or
Homebrew already prepared. Open Terminal from `Applications -> Utilities` or
with Spotlight search, then run each code block in order. The final `npm start`
command opens IdenaAI inside Electron from the source checkout.

The correct window is the normal macOS Terminal app, usually with a prompt that
ends in `%` or `$`. These are shell commands; do not paste them into a browser,
TextEdit, or the IdenaAI app itself.

Experimental safety warning: there are no warranties. This code can be buggy,
unsafe, or wrong, and autosolve can affect a real validation session. Run it
only on a secure test system with no private data, no valuable wallets, no
valuable identity, and no important assets attached. Ideally test first with a
clean identity and ask elsewhere for an invite if needed. Do not run this on a
computer or profile that holds anything important.

Step 1: install Apple command line tools. A system dialog may open; finish that
installer before continuing.

```bash
xcode-select -p >/dev/null 2>&1 || xcode-select --install
```

Step 2: install Homebrew if it is missing, then load it into the current shell.

```bash
if ! command -v brew >/dev/null 2>&1; then
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

if [ -x /opt/homebrew/bin/brew ]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
elif [ -x /usr/local/bin/brew ]; then
  eval "$(/usr/local/bin/brew shellenv)"
else
  echo "Homebrew was not found after installation. Reopen Terminal and rerun this step."
  exit 1
fi
```

Step 3: install the required developer dependencies without NVM.

```bash
brew update
brew install git node@24 python@3.12 go

NODE24_BIN="$(brew --prefix node@24)/bin"
case ":$PATH:" in
  *":$NODE24_BIN:"*) ;;
  *) echo "export PATH=\"$NODE24_BIN:\$PATH\"" >> ~/.zprofile ;;
esac
export PATH="$NODE24_BIN:$PATH"
```

Step 4: verify Node and npm. Continue only if Node is `v24.15.0` or newer on
the Node 24 line. Node 25+ is intentionally rejected by this repo.

```bash
node -v
npm -v
npm install -g npm@11.12.0
node -e 'const v=process.versions.node.split(".").map(Number); if (v[0] !== 24 || v[1] < 15) { throw new Error(`IdenaAI requires Node v24.15.0 or newer on Node 24, got ${process.versions.node}`) }'
npm -v
git --version
python3 --version
go version
```

Step 5: clone or update the IdenaAI source checkout.

```bash
mkdir -p "$HOME/Documents/idena-benchmark-workspace"
cd "$HOME/Documents/idena-benchmark-workspace"

if [ -d IdenaAI/.git ]; then
  cd IdenaAI
  git pull --ff-only origin main
else
  git clone https://github.com/ubiubi18/IdenaAI.git
  cd IdenaAI
fi
```

Step 6: install app dependencies and prepare the bundled Idena source runtime.

```bash
npm ci
npm run setup:sources
npm run doctor
```

Step 7: optionally start the normal source Electron app as a smoke test. This
uses the source-run practice profile, not the normal real app profile.

```bash
npm start
```

On first startup, the built-in node can take a long time before it finds usable
P2P peers and begins real syncing. Logs such as `Peers are not found` or
handshake timeouts do not always mean it is permanently broken; wait at least
15-30 minutes on a stable network before judging it. Some older bootstrap nodes
appear to be gone, so the first peer connection can be slow.

Step 8: for real-session autosolve from Terminal, close the smoke-test app
first. Then point Electron at the normal real macOS profile and set the explicit
autosolve override:

```bash
cd "$HOME/Documents/idena-benchmark-workspace/IdenaAI"

IDENA_DESKTOP_USER_DATA_DIR="$HOME/Library/Application Support/IdenaAI" \
IDENA_DESKTOP_ALLOW_DEV_SESSION_AUTO=1 \
npm start
```

Step 9: inside the Electron app, configure OpenAI for real-session autosolve.

1. Open `Settings -> AI`.
2. Turn on AI.
3. Choose `Use external API provider`.
4. Set `Main AI provider` to `OpenAI`.
5. Paste your own OpenAI API key with `Set key`.
6. Choose the OpenAI model you intend to pay for, for example `gpt-5.5`, or
   enter your own OpenAI model id.
7. Click `Test connection` and continue only after it succeeds.

OpenAI autosolve can spend API money and sends validation flip content to
OpenAI for model inference. Keep provider spending limits low, do not commit or
share your API key, and do not run this on a real identity until you understand
the cost and privacy tradeoff.

Step 10: still inside the Electron app, check all of these before clicking
`Enable auto-solve next session`:

- the startup log points to `~/Library/Application Support/IdenaAI`, not
  `IdenaAI-runtime`
- the app shows the real identity you intend to validate
- the node is mainnet, synced, and eligible for the next validation
- `Settings -> AI -> Test connection` succeeds with OpenAI
- the IdenaAI window, Terminal, internet connection, and computer stay awake
  through the ceremony
- `Validation -> Enable auto-solve next session` is clicked only after every
  check above is true

This can submit answers on-chain automatically. Wrong answers, missed sessions,
provider costs, node failures, network failures, macOS sleep, or app crashes
are your responsibility. Do not test this first on an identity you care about.

## First Installation On Windows

These steps assume a fresh Windows 10 PC with no Git, Node, npm, Go, Python,
MSYS2, MinGW, NVM, or Visual Studio build tools already prepared. Open Windows
PowerShell from the Start menu, or open Windows Terminal and choose a PowerShell
tab. Do not use `cmd.exe`, Git Bash, or the MSYS2 shell for these steps. Run
each code block in order. The final `npm start` command opens IdenaAI inside
Electron from the source checkout.

The correct window usually shows a prompt like `PS C:\Users\YourName>`. Some
installers may ask for administrator permission in a separate Windows dialog;
approve only if you trust the source checkout and the command you just ran.

Experimental safety warning: there are no warranties. This code can be buggy,
unsafe, or wrong, and autosolve can affect a real validation session. Run it
only on a secure test system with no private data, no valuable wallets, no
valuable identity, and no important assets attached. Ideally test first with a
clean identity and ask elsewhere for an invite if needed. Do not run this on a
computer or profile that holds anything important.

PowerShell copy paste can behave differently across Windows terminals, keyboard
layouts, antivirus tools, and older shells. If a copied block fails or appears
to do nothing, do not keep pasting the whole walkthrough at once. Paste one step
at a time, and if needed one command at a time, so you can see exactly which
dependency is missing and fix that install manually before continuing.
Windows Defender, firewall products, controlled folder access, corporate device
guards, and other security tools can also block downloads, compilers, scripts,
or app startup in ways this README cannot predict for every PC. If that happens,
copy the exact command, the full error output, and the relevant `npm run doctor`
output into an AI assistant or coding agent and ask for a Windows-specific
adjustment instead of guessing.

Step 1: verify `winget`. If this opens Microsoft Store, install App Installer,
close PowerShell, reopen it, and rerun this step.

```powershell
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
  Start-Process "ms-windows-store://pdp/?ProductId=9NBLGGH4NNS1"
  throw "Install App Installer from Microsoft Store, reopen PowerShell, then rerun this step."
}

winget --version
```

Step 2: install Windows 10 prerequisites. The Visual Studio Build Tools
installer may open a separate installer window.

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e --version 24.15.0
winget install --id Python.Python.3.12 -e
winget install --id GoLang.Go -e
winget install --id MSYS2.MSYS2 -e
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

If `winget` cannot find the exact Node `24.15.0` package, run
`winget install --id OpenJS.NodeJS.LTS -e` instead, but continue only if Step 4
shows Node `v24.15.0` or a newer `v24.x` release. Do not use NVM for Windows for
this setup if it fails on your PC.

Step 3: install the MinGW toolchain inside MSYS2 and add the detected
`ucrt64\bin` directory to the user path.

```powershell
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($null -eq $userPath) {
  $userPath = ""
}

if (-not (Test-Path "C:\msys64\ucrt64\bin")) {
  $cleanPath = (($userPath -split ";") | Where-Object { $_ -and $_ -ne "C:\msys64\ucrt64\bin" }) -join ";"
  [Environment]::SetEnvironmentVariable("Path", $cleanPath, "User")
}

function Get-MsysRootCandidates {
  $wingetRoots = @()
  $wingetPackagesDir = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
  if (Test-Path $wingetPackagesDir) {
    $wingetRoots = Get-ChildItem $wingetPackagesDir -Directory -Filter "MSYS2.MSYS2*" -ErrorAction SilentlyContinue |
      ForEach-Object { Join-Path $_.FullName "msys64" }
  }

  @(
    "C:\msys64",
    "$env:LOCALAPPDATA\Programs\msys64",
    "$env:ProgramFiles\msys64",
    "${env:ProgramFiles(x86)}\msys64",
    $wingetRoots
  ) | Where-Object { $_ -and (Test-Path (Join-Path $_ "usr\bin\bash.exe")) }
}

$msysRoot = Get-MsysRootCandidates | Select-Object -First 1
if (-not $msysRoot) {
  winget install --id MSYS2.MSYS2 -e
  $msysRoot = Get-MsysRootCandidates | Select-Object -First 1
}

if (-not $msysRoot) {
  throw "MSYS2 bash.exe was not found. Reopen PowerShell after installing MSYS2, then rerun this step."
}

$msysBash = Join-Path $msysRoot "usr\bin\bash.exe"
$ucrtBin = Join-Path $msysRoot "ucrt64\bin"

& $msysBash -lc "pacman -Sy --needed --noconfirm base-devel mingw-w64-ucrt-x86_64-toolchain"

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($null -eq $userPath) {
  $userPath = ""
}

if ($userPath -notlike "*$ucrtBin*") {
  [Environment]::SetEnvironmentVariable("Path", "$ucrtBin;$userPath", "User")
}

$env:Path = "$ucrtBin;$env:Path"

if (-not (Get-Command gcc -ErrorAction SilentlyContinue)) {
  throw "gcc was not found after installing MSYS2. Close PowerShell, reopen it, and rerun Step 3."
}

Get-Command gcc
gcc --version
```

Step 4: close PowerShell, reopen it, then verify Node and npm. Continue only if
Node is `v24.15.0` or newer on the Node 24 line. Node 25+ is intentionally
rejected by this repo.

```powershell
Get-Command node
node -v
npm -v

$nodeVersion = [version]((node -v).TrimStart("v"))
if ($nodeVersion.Major -ne 24 -or $nodeVersion -lt [version]"24.15.0") {
  throw "IdenaAI requires Node v24.15.0 or newer on Node 24, got v$nodeVersion"
}

npm install -g npm@11.12.0
npm -v

$npmVersion = [version](npm -v)
if ($npmVersion -lt [version]"11.12.0") {
  throw "IdenaAI requires npm 11.12.0 or newer, got $npmVersion"
}

git --version
python --version
go version
Get-Command gcc
gcc --version
git config --global core.longpaths true
```

If `Get-Command node` still points to an NVM folder from an older attempt,
remove NVM for Windows or fix `Path`, then reopen PowerShell and rerun this
step.

Step 5: clone or update the IdenaAI source checkout.

```powershell
cd $env:USERPROFILE\Documents

if (Test-Path .\IdenaAI) {
  cd IdenaAI
  git pull --ff-only origin main
} else {
  git clone https://github.com/ubiubi18/IdenaAI.git
  cd IdenaAI
}
```

Step 6: install app dependencies, prepare the source mirrors, and build the
pinned Idena node from source in PowerShell before Electron opens. `detached
HEAD` messages inside `idena-go`, `idena-wasm`, or `idena-wasm-binding` are
normal because the setup pins exact source commits.

```powershell
npm ci
npm run setup:sources
npm run build:node

$builtNodeVersion = (& .\build\node\current\idena-go.exe --version) -join "`n"
$builtNodeVersion
if ($builtNodeVersion -notmatch "1\.1\.2") {
  throw "The source-built Idena node is missing or not version 1.1.2."
}

npm run doctor
```

Step 7: optionally start the normal source Electron app as a smoke test. This
uses the source-run practice profile, not the normal real app profile. Keep the
`npm run build:node` result in place so `Install node` / `Update node` can copy
the pinned source-built node instead of opening a hidden local `go.exe` build.

```powershell
npm start
```

On first startup, the built-in node can take a long time before it finds usable
P2P peers and begins real syncing. Logs such as `Peers are not found` or
handshake timeouts do not always mean it is permanently broken; wait at least
15-30 minutes on a stable network before judging it. Some older bootstrap nodes
appear to be gone, so the first peer connection can be slow.

Step 8: for real-session autosolve from PowerShell, close the smoke-test app
first. Then point Electron at the normal real Windows profile and set the
explicit autosolve override.

```powershell
cd $env:USERPROFILE\Documents\IdenaAI

$env:IDENA_DESKTOP_USER_DATA_DIR="$env:APPDATA\IdenaAI"
$env:IDENA_DESKTOP_ALLOW_DEV_SESSION_AUTO="1"

npm start
```

The override above only applies to the current PowerShell window. Close that
PowerShell window when you are done with the real-session run.

Step 9: inside the Electron app, configure OpenAI for real-session autosolve.

1. Open `Settings -> AI`.
2. Turn on AI.
3. Choose `Use external API provider`.
4. Set `Main AI provider` to `OpenAI`.
5. Paste your own OpenAI API key with `Set key`.
6. Choose the OpenAI model you intend to pay for, for example `gpt-5.5`, or
   enter your own OpenAI model id.
7. Click `Test connection` and continue only after it succeeds.

OpenAI autosolve can spend API money and sends validation flip content to
OpenAI for model inference. Keep provider spending limits low, do not commit or
share your API key, and do not run this on a real identity until you understand
the cost and privacy tradeoff.

Step 10: still inside the Electron app, check all of these before clicking
`Enable auto-solve next session`:

- the startup log points to `%APPDATA%\IdenaAI`, not `IdenaAI-runtime`
- the app shows the real identity you intend to validate
- the node is mainnet, synced, and eligible for the next validation
- `Settings -> AI -> Test connection` succeeds with OpenAI
- the IdenaAI window, PowerShell, internet connection, and computer stay awake
  through the ceremony
- `Validation -> Enable auto-solve next session` is clicked only after every
  check above is true

This can submit answers on-chain automatically. Wrong answers, missed sessions,
provider costs, node failures, network failures, Windows sleep, or app crashes
are your responsibility. Do not test this first on an identity you care about.

## Use This As A Reference

Do not install or run this blindly. Clone it, inspect it, ask a coding agent or
human reviewer to explain the parts you do not understand, and adapt it to your
own machine and risk model. The intended P2P posture is local responsibility:
you bring your own keys, your own AI provider or local model, your own review,
and your own decision to run.

## Two Autosolver Options

The install commands live in the newer first-install walkthroughs above. Use
those sections as the source of truth:

- [first installation on mac](#first-installation-on-mac)
- [first installation on windows](#first-installation-on-windows)

Keep these modes separate:

- **Real session** means a real Idena validation with a real identity. Mistakes
  can cost your validation or identity. Use only the real-session startup step
  from the Mac or Windows walkthrough, and only after you understand the warning
  there.
- **Rehearsal** means a local practice network on your own computer. Use this
  before touching a real validation. Start the normal source app, open
  `Settings -> Node`, and use `Start and use rehearsal network`.
- **Off-chain flip tests** stay local. Use `Flips -> New`, build or edit draft
  flips, and run the local queue/solver controls before publishing anything.

Profile rule:

- plain `npm start` uses the workspace practice profile under
  `IdenaAI-runtime/IdenaAIDev`
- real-session startup must explicitly point at the real app data folder:
  `~/Library/Application Support/IdenaAI` on macOS or `%APPDATA%\IdenaAI` on
  Windows
- if the startup log points to `IdenaAI-runtime`, you are in the practice
  profile, not the real profile

Packaged app builds are developer/debugging work, not the beginner install path.
For first use, prefer the terminal-first source run described in the Mac or
Windows walkthrough.

Rehearsal and off-chain queue runs stay local and do not submit mainnet answers.
Mainnet validation, reporting, wallet, and identity use remain at your own risk.

## Experimental Warning

Read this part first. `v0.0.4` is not production ready.

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
- do not expect a trusted downloadable app; build and inspect locally
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

## v0.0.4 Repo Status

`v0.0.4` extends the cleaner-runtime development snapshot after the Node 24 LTS
and Electron 41 migration. It adds a release-readiness pass for local-source
usage, packaged macOS runtime behavior, settings navigation, logo fallback,
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

## v0.0.4 Release Notes

This checkpoint had to fix several practical issues before it could be useful as
a reference build:

- packaged settings tabs now navigate correctly in static Electron builds
- the in-app identity mark now has a local fallback instead of showing a broken
  image when an asset path fails
- packaging prepares the pinned `idena-go` runtime from source mirrors for local
  builds because the old upstream release/build path should not be treated as
  repaired
- old `idena-go`, `idena-wasm`, and `idena-wasm-binding` snapshots are no
  longer tracked in the main repo; `npm run setup:sources` clones pinned
  `ubiubi18` mirrors when they are needed
- the large 500-flip rehearsal shards are no longer tracked; use
  `npm run setup:flips` to import larger local FLIP-Challenge data
- packaged app inputs still exclude generated source trees and local rehearsal
  data so Electron packages do not ship those caches
- the README now describes source-first usage instead of implying that users
  should trust a downloaded app
- one-identity rehearsal autosolving remains the default
- the optional 9-ID rehearsal path is documented as a local shared-provider
  capacity test, not as mainnet multi-identity automation

The repository no longer tracks the old source snapshots or the large 500-flip
sample shards. Existing Git history still contains them; fully shrinking
historical clone size would require a fresh repo or a deliberate history
rewrite. New source archives and future checkouts are now based on scripts that
clone/update pinned `ubiubi18` forks and generate/import rehearsal flips
locally.

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
../IdenaAI-runtime/IdenaAIDev/ai-benchmark/
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
../IdenaAI-runtime/IdenaAIDev/
```

For example, if the repository is checked out at:

```text
~/src/IdenaAI/
```

the default source-run `userData` path is:

```text
~/src/IdenaAI-runtime/IdenaAIDev/
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

- the default text and code-review path is Qwen via Ollama:
  `idenaai-qwen36-27b-claude-opus:q4km`
- the source GGUF and local alias setup are documented in
  [docs/local-ai-qwen36-gguf.md](docs/local-ai-qwen36-gguf.md)
- this Qwen path is a practical local-first default, not a final endorsement or
  a guarantee that the model is neutral, complete, or safe
- smaller managed runtimes remain research fallbacks for machines that cannot
  run the Qwen/Ollama target comfortably
- first use asks for an explicit one-time trust approval before installing and starting managed runtime components
- the managed runtime is loopback-only and token-gated
- trusted runtime files and model shards are verified before startup
- RAM estimation and reserve controls are now part of the local-runtime setup flow

Prepared research lanes currently include:

- `rico03/Qwen3.6-27B-Claude-Opus-Reasoning-Distilled-GGUF` as the default
  text/reasoning model through Ollama
- `allenai/Molmo2-O-7B` as the main managed research runtime
- `allenai/Molmo2-4B` as a more compact managed fallback
- `OpenGVLab/InternVL3_5-1B-HF` as the light same-provider alternative
- `OpenGVLab/InternVL3_5-8B-HF` as a heavier experimental alternative

Advanced users can still point the app at their own local-only:

- Ollama runtime
- MLX / MLX-VLM setup
- Transformers-based server
- `vLLM` endpoint

All base models contain cultural, political, linguistic, and dataset bias. Treat
their output with distance, review important answers yourself, and avoid turning
one model's framing into protocol truth. A future P2P direction could be to
train or curate an AI base model toward broader worldwide representation of
diverse ideas, languages, and mindsets, but that is not realistic for this
project today. For now, local AI experiments are enabled and the broader
local-model direction is still being evaluated.

## Session-Auto Validation

`session-auto` is meant to reduce or remove ceremony babysitting, but it is
still experimental and should not be blindly trusted.

Plain `npm start` uses the workspace practice profile and blocks real on-chain
`session-auto` on purpose. For a real session from Terminal, you must explicitly
set `IDENA_DESKTOP_USER_DATA_DIR` to the real app data folder and set
`IDENA_DESKTOP_ALLOW_DEV_SESSION_AUTO=1`. Dev/practice runs can still run the
off-chain solver preview and validation rehearsal network without that override.

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

Use the first-install walkthroughs as the source of truth for startup commands:

- [first installation on mac](#first-installation-on-mac)
- [first installation on windows](#first-installation-on-windows)

Before arming real session-auto:

- close every other IdenaAI app/window
- back up the identity/private key yourself
- start IdenaAI from the real-session step for your operating system
- confirm the selected profile is mainnet, not the rehearsal node
- confirm the identity is eligible for the next validation
- confirm `Settings -> AI -> Test connection` works before the ceremony
- keep the node online, synced, and eligible for the next ceremony
- keep the app open, the computer awake, and the internet connection stable
- stay nearby and watch the ceremony; this is not unattended production software
- keep API spending limits low

OpenAI `gpt-5.5` example:

1. Start IdenaAI with the real-session command from the Mac or Windows
   walkthrough above.
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
12. Keep the IdenaAI window and Terminal running through the ceremony and
    monitor short and long session submissions.

Do not commit API keys, screenshots containing keys, `settings.json`, node data,
or files from `~/Library/Application Support/IdenaAI/`. Keep provider spending
limits low until you have your own successful rehearsal and smoke-test history.
`IDENA_DESKTOP_ALLOW_DEV_SESSION_AUTO=1` is a deliberate override for real
Terminal session-auto. Do not add it casually to normal practice runs.

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

For first installation, use the Mac or Windows walkthrough near the top of this
README. They include the dependency setup, copy-paste guidance, real-profile
startup commands, and Windows source-built node steps.

Developer quick reference after dependencies are already installed:

Clone and start:

```bash
git clone https://github.com/ubiubi18/IdenaAI.git
cd IdenaAI
npm ci
npm run setup:sources
npm run doctor
npm start
```

Optional build:

```bash
npm run setup:sources
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
npm run doctor
npm run audit:privacy
npm run audit:electron
npm run audit:deps
npm test
```

Source mirrors for node/runtime work and macOS packaging:

```bash
npm run setup:sources
npm run update:sources
```

These commands use `scripts/source-manifest.json` and default to pinned
`ubiubi18` mirrors for `idena-go`, `idena-wasm`, and `idena-wasm-binding`. Edit
that manifest if you want to point at your own forks before building or testing
the node/runtime layer. The source directories are generated local caches and
are intentionally ignored by git.

Optional FLIP-Challenge import for local benchmark and rehearsal work:

```bash
npm run setup:flips
npm run setup:flips -- --split test --skip-flips 200 --max-flips 200
```

Generated imports are written under `data/`, which is intentionally ignored by
git. If import fails, paste the full terminal output into a coding agent and ask
it to adapt Python dependencies or network access for your machine.

## User Experience: Terminal-First Local Build

Do not expect a trusted installer or ready-made build to download. Treat this
repo as a reference implementation that you clone, inspect, adapt, and run on
your own machine. If a command fails, copy the full terminal command, the full
error output, your OS/CPU, and `node -v && npm -v` into a coding agent or give it
to someone with real local knowledge of your system. You are responsible for the
changes you make and the risk you accept.

IdenaAI has been tested primarily on macOS Apple Silicon. Windows and Linux are
source-build paths for people who can debug their own local toolchain.

The detailed Mac and Windows setup commands are intentionally maintained once,
near the top of this README:

- [first installation on mac](#first-installation-on-mac)
- [first installation on windows](#first-installation-on-windows)

Use those walkthroughs for first install, normal source startup, and
real-session startup. This keeps the README from carrying multiple competing
copies of the same command sequence.

### Linux

Install Git, Node 24, Python 3, Go, `build-essential` or equivalent, and the
native build dependencies required by Electron/canvas on your distribution. Then
run:

```bash
git clone https://github.com/ubiubi18/IdenaAI.git
cd IdenaAI
npm ci
npm run setup:sources
npm run doctor
npm start
```

For a local Linux package built on your own machine:

```bash
npm run dist:linux
```

Distribution packages and native dependency names differ. If setup fails, paste
the terminal output into a coding agent and let it adjust the commands for your
distribution.

### Autosolver From The Local Electron App

For the safe rehearsal path:

1. Start Electron from the terminal with `npm start`.
2. Open `Settings -> AI`.
3. Turn on AI, choose your backend, set your own API key or local runtime, and
   click `Test connection`.
4. Open `Settings -> Node`.
5. Start `Validation Rehearsal Devnet`.
6. Open validation when the rehearsal network is ready.
7. Run `Run 1 rehearsal autosolve`.
8. Use `Run optional 9-ID parallel rehearsal` only as a local capacity test with
   your own provider key, machine, and cost limits.

For a real identity, read
[Real Session Auto-Solve With OpenAI](#real-session-auto-solve-with-openai)
first. Real-session automation can miss, submit wrong answers, spend API money,
or damage an identity. Do not treat this repo as unattended validation
software.

## User Paths

Use the rehearsal and development paths below after `npm start`. For real
on-chain session automation, use the real-session startup step in the Mac or
Windows first-install walkthrough above.

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

## Source Mirrors and Smaller Checkouts

The old bundled `idena-go`, `idena-wasm`, and `idena-wasm-binding` source trees
are no longer tracked in this repo. They are generated local caches now. Use
scripts when you need them:

```bash
npm run doctor
npm run setup:sources
npm run setup:flips
```

`setup:sources` clones the pinned `ubiubi18` mirrors from
`scripts/source-manifest.json`. `setup:flips` imports FLIP-Challenge data into
`data/`, which is also ignored by git. The repo keeps only the small bundled
demo samples needed for smoke tests and quick rehearsal.

The managed `idena-go` runtime is source-first too:

- packaged apps copy a platform node binary bundled at build time
- source checkouts can build the node locally with `npm run build:node`
- Windows first-install commands run `npm run build:node` before the first
  Electron startup so the in-app `Install node` / `Update node` action can copy
  the pinned source-built node instead of opening a hidden local `go.exe` build
- runtime release lookup defaults to `ubiubi18/idena-go` only and should remain
  a fallback path, not the normal Windows source-run installation path
- override release repos through `IDENAAI_NODE_RELEASE_REPOS` or force remote
  release lookup through `IDENAAI_NODE_PREFER_REMOTE_RELEASE=1` only if you
  intentionally trust the replacement source

Do not assume the official `idena-desktop` app release path is repaired. The
upstream PRs below explain the desktop failure mode and proposed fixes, but they
are not a reliable default app binary source for this repo because they are
still unmerged or draft at the time of this README update:

- [`idena-network/idena-wasm-binding#1`](https://github.com/idena-network/idena-wasm-binding/pull/1):
  open PR adding the Darwin arm64 wasm binding archive
- [`idena-network/idena-go#1158`](https://github.com/idena-network/idena-go/pull/1158):
  draft PR for minimal Apple Silicon compatibility
- [`idena-network/idena-go#1157`](https://github.com/idena-network/idena-go/pull/1157):
  open PR pinning old Windows/macOS release runners, without adding native Apple
  Silicon release support

That is why this repo uses pinned source mirrors and local builds first. Treat
remote binary downloads as an explicit trust decision, not the normal path.

This reduces future checkout/source-archive friction, but it does not erase the
large files from existing Git history. A fully small historical clone would need
a separate history rewrite or a fresh source mirror.

If public release packaging becomes more formal later:

- keep those files under review before every tag
- keep clone/update scripts and local generated caches instead of recommitting
  large bundles
- consider Git LFS or external release artifacts only for data that cannot be
  generated or fetched locally
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
