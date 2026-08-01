#!/usr/bin/env bash
set -euo pipefail

SOURCE_ROOT="${IDENA_AI_SOURCE_ROOT:-/srv/sharechain/idena-ai/source}"
CONSOLE_SERVICE="${IDENA_AI_CONSOLE_SERVICE:-idena-ai-console.service}"
RESTART_CONSOLE=0

if [[ "${1:-}" == "--restart-console" ]]; then
  RESTART_CONSOLE=1
elif [[ -n "${1:-}" ]]; then
  echo "usage: $0 [--restart-console]" >&2
  exit 2
fi

if [[ "${EUID}" -ne 0 ]]; then
  echo "run this installer as root" >&2
  exit 2
fi

if [[ ! -f "${SOURCE_ROOT}/scripts/idena_ai_provider_credential_broker.py" ]]; then
  echo "credential broker source is missing from ${SOURCE_ROOT}" >&2
  exit 2
fi

install -d -m 0755 /usr/local/libexec/idena-ai
install -m 0755 \
  "${SOURCE_ROOT}/scripts/idena_ai_provider_credential_broker.py" \
  /usr/local/libexec/idena-ai/provider-credential-broker.py
install -d -m 0755 "/etc/systemd/system/${CONSOLE_SERVICE}.d"
install -m 0644 \
  "${SOURCE_ROOT}/deploy/systemd/idena-ai-provider-credential-broker.service" \
  /etc/systemd/system/idena-ai-provider-credential-broker.service
install -m 0644 \
  "${SOURCE_ROOT}/deploy/systemd/idena-ai-console-provider-credential.conf" \
  "/etc/systemd/system/${CONSOLE_SERVICE}.d/20-provider-credential.conf"

systemd-analyze verify \
  /etc/systemd/system/idena-ai-provider-credential-broker.service \
  "${CONSOLE_SERVICE}"
systemctl daemon-reload
systemctl enable --now idena-ai-provider-credential-broker.service

if [[ "${RESTART_CONSOLE}" -eq 1 ]]; then
  systemctl restart "${CONSOLE_SERVICE}"
fi

echo "IdenaAI provider credential broker is installed."
if [[ "${RESTART_CONSOLE}" -eq 0 ]]; then
  echo "The console was not restarted. Restart it only after the current key can be entered again."
fi
