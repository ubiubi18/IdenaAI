# Unattended validation

IdenaAI can keep its graphical console and managed Idena node running under
systemd while the operator's computer is offline. This mode can submit real
validation answers on-chain. It is opt-in and remains subject to the configured
provider budget, identity eligibility, node synchronization, and session
deadlines.

## Credential storage

The OpenAI key is never written to `settings.json`, an environment file, the
repository, a command argument, or the journal.

On a managed Linux host, the main Electron process can send its already-loaded
OpenAI key over a mode `0600` Unix socket to
`idena-ai-provider-credential-broker.service`. The root-owned broker:

1. accepts only the configured service user;
2. verifies that the caller belongs to `idena-ai-console.service`;
3. encrypts the key with `systemd-creds --with-key=host`;
4. verifies an in-memory decrypt round trip;
5. atomically stores only the encrypted blob under
   `/etc/credstore.encrypted`.

The host-bound blob cannot be moved to another machine and decrypted there.
Root compromise or compromise of the running IdenaAI service can still expose
the key. Use a dedicated low-budget API project key and rotate it after the
experiment.

## Install

From the exact reviewed source checkout on the managed host:

```sh
sudo /srv/sharechain/idena-ai/source/deploy/install-electron-userns-apparmor.sh
sudo /srv/sharechain/idena-ai/source/deploy/install-provider-credential-broker.sh
```

Ubuntu hosts that restrict unprivileged user namespaces need the path-specific
AppArmor profile before Electron starts. The installer refuses a symlinked,
service-writable, or non-root-owned Electron binary, validates the profile
before loading it, and rolls the persistent policy back if activation fails.
It grants `userns` only to the fixed managed Electron path. It does not disable
Chromium's sandbox, weaken AppArmor globally, install a setuid sandbox helper,
or restart IdenaAI.

The installer deliberately does not restart IdenaAI. Once the updated app is
running, open **AI settings**, load the key, and select **Keep after restart**.
Then use **Test fast path** to test the exact GPT-5.5 request used by short
session: Priority service tier with low reasoning effort.

After the encrypted status is visible, test restart recovery:

```sh
sudo systemctl restart idena-ai-console.service
systemctl is-active idena-ai-console.service idena-ai-node.service
systemctl is-enabled idena-ai-console.service idena-ai-node.service
```

The UI must still report the provider key ready and the encrypted host
credential present. Never print the credential or decrypt it in a shell.

## Unattended readiness

The deliberately source-run Pi console must also install
`deploy/systemd/idena-ai-console-session-auto.conf` as a service drop-in. It
sets the explicit development-runtime authorization gate but does not enable AI,
select `session-auto`, record on-chain consent, or load a provider key by
itself. Those remain separate UI decisions.

```sh
sudo install -m 0644 \
  deploy/systemd/idena-ai-console-renderer-warmup.conf \
  /etc/systemd/system/idena-ai-console.service.d/30-renderer-warmup.conf
sudo install -m 0644 \
  deploy/systemd/idena-ai-console-session-auto.conf \
  /etc/systemd/system/idena-ai-console.service.d/40-session-auto.conf
sudo systemctl daemon-reload
```

The warmup list includes `/validation` so the Pi compiles that time-critical
route before a ceremony. Restart `idena-ai-console.service` outside a ceremony
to apply these drop-ins and verify that all configured routes report ready.

Before leaving the host unattended, verify in the UI:

- the Idena node is synchronized and the intended identity is loaded;
- the identity is eligible for the upcoming ceremony;
- AI is enabled with run mode **Auto-run each validation session**;
- on-chain auto-submit consent is present;
- the daily API cap is enabled and has room;
- the host credential status is encrypted and available after restart;
- the exact GPT-5.5 fast-path probe succeeds;
- host time synchronization is healthy.

Keep the VNC and node control interfaces loopback-only. Remote access should
use an authenticated SSH or private-overlay tunnel.

No AI model can guarantee a successful validation. Network loss, provider
failure, model mistakes, insufficient balance, identity ineligibility, or a
missed ceremony deadline can still cause validation failure.

## External-node peer and mining recovery

The Raspberry Pi external-node deployment can install a separate, conservative
systemd watchdog. It never signs transactions itself. Instead, the installer
enables the Idena node's upstream `--autoonline` mode, whose own consensus loop
waits for synchronization and peers, refuses to act during validation, checks
identity eligibility, and suppresses duplicate or pending online-status
transactions.

`--autoonline` grants the node continuing authority to submit a fee-bearing
online-status transaction. A deliberate manual **Go offline** action will be
reversed when the native safety gates allow it. Disable the watchdog timer and
remove the auto-online drop-in before intentionally keeping the identity
offline.

Install from the exact reviewed source checkout and explicitly bind the guard
to the intended public identity address. The installer rejects the zero
address, checks the exact running node argument vector, and requires the live
coinbase and identity RPC results to match before it writes the fee-authority
drop-in:

```sh
export IDENA_IDENTITY_ADDRESS=0x0123456789abcdef0123456789abcdef01234567
sudo IDENA_AI_SOURCE_ROOT=/mnt/ssd/idena-ai/source \
  /mnt/ssd/idena-ai/source/deploy/install-idena-node-watchdog.sh \
  --expected-address "${IDENA_IDENTITY_ADDRESS}"
```

Replace the example with the intended identity's exact 40-hex-character public
address. Installation also requires admitted peers, synchronized time and
chain state, a `Human` identity, and the normal non-ceremony period. It is
failure-atomic: installed files, timer state, and the node drop-in are restored
if a later installation step fails.

Add `--restart-node` only when an immediate, scoped `idena.service` restart is
safe. The installer does not restart IdenaAI, Bitcoin Core, P2Pool, the network
manager, or the Pi.

The timer samples once per minute and records private state under
`/var/lib/idena-ai-node-watchdog`:

- Peer recovery records whether this installation has ever observed a real
  peer. A new node invocation must observe a peer again before it is armed. If
  a historically healthy node instead starts with zero peers, the guard waits
  through the full 30-minute startup grace and only then begins a new
  15-minute zero-peer evidence window. A never-healthy fresh installation
  remains unarmed.
- After an armed nonzero-to-zero transition, at least 900 continuous seconds
  and 15 successful `net_peers=[]` samples are required. RPC errors reset the
  evidence window and are never treated as zero peers.
- A second live probe must still report zero peers before exactly
  `idena.service` is restarted.
- Only one restart is allowed for a continuous peer outage, with a global
  one-hour restart cooldown. A fixed safety budget stops all automatic actions
  after two node restarts in six hours until the oldest attempt ages out.
- A healthy but offline identity can trigger one service restart only after 15
  continuous minutes, at least 30 advancing blocks, correct time, normal epoch
  period, the expected Human identity, no delegation, and an active
  `--autoonline` process. Any pending online-status transaction blocks the
  restart instead of being disrupted or duplicated.
- The mining-recovery latch resets only after `dna_identity.online=true` is
  observed. The watchdog never adds its own `dna_becomeOnline` retry loop.

The service has a 30-minute startup grace because first peer discovery on a
small Pi can legitimately take longer than 15 minutes. Once the running node
has been observed healthy, an established peer loss still triggers after the
requested 15-minute interval.

The watchdog receives only the existing node RPC key through systemd's private
`LoadCredential` directory. Its Python process retains no DAC-bypass
capability, and the key is never copied into the repository, configuration,
command line, state file, status file, or journal.

Use the read-only check mode for a secret-safe live snapshot. It does not write
state, restart the node, or submit a transaction:

```sh
sudo /usr/local/libexec/idena-ai/node-watchdog.py --check
```

Inspect the persistent result and recent journal without exposing the RPC key:

```sh
sudo cat /var/lib/idena-ai-node-watchdog/status.json
journalctl -u idena-ai-node-watchdog.service -n 100 --no-pager
systemctl status idena-ai-node-watchdog.timer --no-pager
```

Rollback is intentionally two-step so disabling monitoring does not silently
change on-chain policy:

```sh
sudo systemctl disable --now idena-ai-node-watchdog.timer
sudo systemctl stop idena-ai-node-watchdog.service
sudo rm /etc/systemd/system/idena.service.d/50-idena-ai-autoonline.conf
sudo systemctl daemon-reload
```

The third command removes only the repository-installed auto-online drop-in.
Restart `idena.service` separately, outside a validation session, if the running
process must also drop that authority. Preserve the watchdog state and journal
until the incident has been reviewed.
