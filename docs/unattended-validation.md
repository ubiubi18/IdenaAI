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
sudo /srv/sharechain/idena-ai/source/deploy/install-provider-credential-broker.sh
```

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
