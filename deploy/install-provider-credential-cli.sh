#!/usr/bin/env bash
set -euo pipefail

SOURCE_ROOT="${IDENA_AI_SOURCE_ROOT:-/srv/sharechain/idena-ai/source}"
BROKER_SCRIPT="/usr/local/libexec/idena-ai/provider-credential-broker.py"
COMMAND_PATH="/usr/local/sbin/idena-ai-set-provider-key"

if [[ "${EUID}" -ne 0 ]]; then
  echo "run this installer as root" >&2
  exit 2
fi

if [[ ! -f "${SOURCE_ROOT}/scripts/idena_ai_provider_credential_set.py" ]]; then
  echo "provider credential command is missing from ${SOURCE_ROOT}" >&2
  exit 2
fi

if [[ ! -f "${BROKER_SCRIPT}" ]]; then
  echo "install the provider credential broker first" >&2
  exit 2
fi

install -d -m 0755 /usr/local/libexec/idena-ai
install -m 0755 \
  "${SOURCE_ROOT}/scripts/idena_ai_provider_credential_set.py" \
  "${COMMAND_PATH}"

"${COMMAND_PATH}" --list

echo "IdenaAI provider key command installed at ${COMMAND_PATH}"
