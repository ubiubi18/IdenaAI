# Pi remote console

The stock noVNC `vnc_lite.html` page does not transfer the workstation
clipboard into the Pi's X11 clipboard. Use the repository-owned
`idena-vnc-lite.html` page when text must be pasted into IdenaAI.

Install it on the Pi without replacing the distribution's noVNC files:

```bash
sudo deploy/install-idena-vnc-lite.sh
```

With a local SSH tunnel on port `8766`, open:

```text
http://127.0.0.1:8766/idena-vnc-lite.html?resize=scale
```

For provider credentials:

1. Paste the credential yourself into the masked **Paste key here** control.
2. Select **Send clipboard**. The browser control clears itself immediately.
3. Click the provider API-key field in the remote Linux desktop.
4. Select **Paste into focused field** in the console toolbar. This sends the
   remote Linux **Ctrl+V** sequence without exposing the key to browser
   automation.
5. Save the key in IdenaAI, then select **Clear Pi clipboard**. x11vnc ignores
   an empty clipboard message, so this action securely replaces the Pi
   clipboard with the harmless marker `IDENAAI-CLIPBOARD-CLEARED`.
6. Replace the credential in the workstation clipboard with harmless text.

The custom page does not log or persist clipboard text. Never put a credential
in the URL, shell command, chat, source tree, or automated test.

Run the focused regression test with:

```bash
node --test deploy/novnc/idena-vnc-clipboard.test.mjs
```
