# IdenaAI v0.0.8

IdenaAI is an experimental desktop fork of `idena-desktop` for validation,
FLIP, local AI, and rehearsal research.

It is not a hardened wallet release, not a trusted installer distribution, and
not a guarantee of validation success. Build and inspect it locally. Use it at
your own risk.

## v0.0.8 Changelog

Safety/debugging release after the May 2026 live-session audit.

- Real autosolve now uses the intended probability-ensemble path with guarded
  long-session side choices by default, not only in short session but also in
  long session.
- Cost tracking, ad-free `idena.social-ui`, and local IPFS inspection were
  updated.

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

## First Installation

- [first installation on mac](#first-installation-on-mac)
- [first installation on windows](#first-installation-on-windows)
- [first installation on VPS Linux, not fully tested yet](#first-installation-on-vps-linux-not-fully-tested-yet)

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

The correct window usually shows a PowerShell prompt that starts with `PS` and
ends with `>`. Some installers may ask for administrator permission in a
separate Windows dialog; approve only if you trust the source checkout and the
command you just ran.

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

## First Installation On VPS Linux, Not Fully Tested Yet

This is a proposed route for an Ubuntu 22.04 or 24.04 VPS. It is not fully
tested yet. `IdenaAI` is an Electron desktop app, so a VPS needs a real GUI
session through VNC, RDP, or another remote desktop. Pure SSH/headless mode is
acceptable for dependency smoke tests only, not for a real validation ceremony.

Prefer Mac or Windows for your first real session until the VPS route has its
own successful rehearsal history. If you do use a VPS, use a dedicated server,
encrypt/back up keys yourself, keep API spending limits low, and keep the
remote desktop open while validation is running.

Step 1: install base packages, Node 24, npm 11.12, Go, and Electron runtime
libraries.

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git build-essential python3 python3-pip pkg-config

curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs golang-go
sudo npm install -g npm@11.12.0

if apt-cache show libasound2t64 >/dev/null 2>&1; then
  ASOUND_PACKAGE=libasound2t64
else
  ASOUND_PACKAGE=libasound2
fi

sudo apt-get install -y \
  "$ASOUND_PACKAGE" \
  libgtk-3-0 \
  libnss3 \
  libxss1 \
  libxtst6 \
  libx11-xcb1 \
  libxkbfile1 \
  libsecret-1-dev \
  xdg-utils \
  xvfb \
  xauth

node -v
npm -v
go version
```

Step 2: install a lightweight remote desktop if the VPS image does not already
provide one. Secure VNC with SSH tunneling or your provider firewall; do not
expose a VNC password prompt directly to the public internet.

```bash
sudo apt-get install -y xfce4 xfce4-goodies tigervnc-standalone-server
vncserver
```

Step 3: open a terminal inside the remote desktop session, then clone and start
the source app.

```bash
mkdir -p "$HOME/idena-benchmark-workspace"
cd "$HOME/idena-benchmark-workspace"

git clone https://github.com/ubiubi18/IdenaAI.git
cd IdenaAI

npm ci
npm run setup:sources
npm run doctor
npm start
```

Step 4: for a real Linux profile, close the smoke-test app first, then start
with the Linux app-data folder explicitly selected. This real-session Linux path
is not fully tested yet.

```bash
cd "$HOME/idena-benchmark-workspace/IdenaAI"

IDENA_DESKTOP_USER_DATA_DIR="$HOME/.config/IdenaAI" \
IDENA_DESKTOP_ALLOW_DEV_SESSION_AUTO=1 \
npm start
```

Use `Settings -> Node` for rehearsal first, then `Settings -> AI -> Test
connection`. Do not arm a real Linux VPS validation until rehearsal, provider
testing, remote desktop stability, time sync, networking, and restart behavior
have all been tested on that exact server.

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
