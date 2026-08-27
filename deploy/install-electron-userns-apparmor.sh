#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

readonly profile_name=idena-ai-electron
readonly profile_target=/etc/apparmor.d/idena-ai-electron
readonly electron_path=/opt/idena-ai/source/node_modules/electron/dist/electron
readonly service_user="${IDENA_AI_SERVICE_USER:-idenaai}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly script_dir
readonly profile_source="${script_dir}/apparmor/idena-ai-electron"

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this installer as root." >&2
  exit 2
fi

for command in aa-status apparmor_parser getent install realpath runuser stat; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "Required command is missing: ${command}" >&2
    exit 3
  fi
done

if ! getent passwd "${service_user}" >/dev/null; then
  echo "The IdenaAI service user does not exist: ${service_user}" >&2
  exit 4
fi
if [[ ! -f ${profile_source} ]]; then
  echo "AppArmor profile is missing from the source checkout." >&2
  exit 4
fi
if [[ ! -x ${electron_path} ]]; then
  echo "The managed Electron binary is missing or not executable." >&2
  exit 4
fi
if [[ $(realpath -e -- "${electron_path}") != "${electron_path}" ]]; then
  echo "The managed Electron path must not resolve through a symlink." >&2
  exit 4
fi
if [[ $(stat -c '%U' -- "${electron_path}") != root ]]; then
  echo "The managed Electron binary must be owned by root." >&2
  exit 4
fi
electron_mode="$(stat -c '%a' -- "${electron_path}")"
readonly electron_mode
if (( (8#${electron_mode} & 8#022) != 0 )); then
  echo "The managed Electron binary must not be group- or world-writable." >&2
  exit 4
fi
if runuser -u "${service_user}" -- test -w "${electron_path}"; then
  echo "The IdenaAI service user must not be able to modify Electron." >&2
  exit 4
fi

# Validate before changing the loaded policy or its persistent source.
apparmor_parser -Q "${profile_source}"

backup="$(mktemp /tmp/idena-ai-electron.apparmor.backup.XXXXXX)"
readonly backup
had_profile=0
if [[ -e ${profile_target} ]]; then
  cp -a -- "${profile_target}" "${backup}"
  had_profile=1
fi

rollback() {
  local rc=$?
  trap - ERR
  if [[ ${had_profile} -eq 1 ]]; then
    install -o root -g root -m 0644 "${backup}" "${profile_target}"
    apparmor_parser -r "${profile_target}" >/dev/null 2>&1 || true
  else
    apparmor_parser -R "${profile_target}" >/dev/null 2>&1 || true
    rm -f -- "${profile_target}"
  fi
  rm -f -- "${backup}"
  exit "${rc}"
}
trap rollback ERR

install -o root -g root -m 0644 "${profile_source}" "${profile_target}"
apparmor_parser -r "${profile_target}"
if ! aa-status 2>/dev/null | grep -Fq "${profile_name}"; then
  echo "The IdenaAI Electron AppArmor profile did not load." >&2
  false
fi

trap - ERR
rm -f -- "${backup}"
echo "Installed and loaded ${profile_name}."
echo "Restart idena-ai-console.service separately after checking session timing."
