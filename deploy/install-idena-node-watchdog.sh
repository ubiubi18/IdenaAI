#!/usr/bin/env bash
set -euo pipefail

SOURCE_ROOT="${IDENA_AI_SOURCE_ROOT:-/mnt/ssd/idena-ai/source}"
EXPECTED_ADDRESS="${IDENA_AI_WATCHDOG_EXPECTED_ADDRESS:-}"
RESTART_NODE=0
ZERO_ADDRESS=0x0000000000000000000000000000000000000000

usage() {
  echo "usage: $0 --expected-address 0x... [--restart-node]" >&2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --expected-address)
      [[ $# -ge 2 ]] || { usage; exit 2; }
      EXPECTED_ADDRESS="$2"
      shift 2
      ;;
    --restart-node)
      RESTART_NODE=1
      shift
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

if [[ "${EUID}" -ne 0 ]]; then
  echo "run this installer as root" >&2
  exit 2
fi

if [[ ! "${EXPECTED_ADDRESS}" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
  echo "--expected-address must be a 20-byte hex address" >&2
  exit 2
fi
EXPECTED_ADDRESS="${EXPECTED_ADDRESS,,}"
if [[ "${EXPECTED_ADDRESS}" == "${ZERO_ADDRESS}" ]]; then
  echo "--expected-address must not be the zero address" >&2
  exit 2
fi

required_files=(
  scripts/idena_node_watchdog.py
  deploy/systemd/idena-ai-node-watchdog.service
  deploy/systemd/idena-ai-node-watchdog.timer
  deploy/systemd/idena-ai-node-autoonline.conf
)
for relative_path in "${required_files[@]}"; do
  if [[ ! -f "${SOURCE_ROOT}/${relative_path}" ]]; then
    echo "watchdog source is missing: ${SOURCE_ROOT}/${relative_path}" >&2
    exit 2
  fi
done

rpc_key_path=/mnt/ssd/idena/idena-data/api.key
if [[ ! -f "${rpc_key_path}" ]]; then
  echo "active Idena RPC key file is missing" >&2
  exit 2
fi

# Refuse to replace the complete ExecStart unless the live node exactly matches
# the one reviewed for this Pi. The second form makes reinstall idempotent.
main_pid="$(systemctl show idena.service --property=MainPID --value)"
node_was_autoonline="$(python3 - "${main_pid}" <<'PY'
import pathlib
import sys

try:
    pid = int(sys.argv[1])
except ValueError:
    raise SystemExit("refusing to override an unexpected idena.service ExecStart")
if pid <= 0:
    raise SystemExit("idena.service must be running before installation")
try:
    argv = [
        item.decode("utf-8")
        for item in pathlib.Path(f"/proc/{pid}/cmdline").read_bytes().split(b"\0")
        if item
    ]
except (OSError, UnicodeDecodeError):
    raise SystemExit("unable to verify the running idena.service argument vector")
expected = [
    "/usr/local/libexec/idena-node-modern",
    "--config=/mnt/ssd/idena/idena-data/config.json",
    "--datadir=/mnt/ssd/idena/idena-data",
    "--fast",
]
if argv not in (expected, [*expected, "--autoonline"]):
    raise SystemExit("refusing to override an unexpected idena.service ExecStart")
print(int("--autoonline" in argv))
PY
)"

install_tmp_dir="$(mktemp -d /run/idena-ai-watchdog-install.XXXXXX)"
cleanup_install_tmp() {
  if [[ "${install_tmp_dir}" == /run/idena-ai-watchdog-install.* ]]; then
    rm -rf -- "${install_tmp_dir}"
  fi
}
trap cleanup_install_tmp EXIT

preflight_config="${install_tmp_dir}/preflight.json"
python3 - "${preflight_config}" "${EXPECTED_ADDRESS}" <<'PY'
import json
import os
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
payload = {
    "rpcUrl": "http://127.0.0.1:9009",
    "apiKeyFile": "/mnt/ssd/idena/idena-data/api.key",
    "expectedAddress": sys.argv[2],
    "eligibleIdentityStates": ["Human"],
}
descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
    json.dump(payload, handle)
    handle.write("\n")
PY

# This check is intentionally before every persistent mutation. Native
# --autoonline acts on the node coinbase, so both live bindings must match.
preflight_output="${install_tmp_dir}/preflight-output.json"
"${SOURCE_ROOT}/scripts/idena_node_watchdog.py" \
  --config "${preflight_config}" \
  --state "${install_tmp_dir}/preflight-state.json" \
  --status "${install_tmp_dir}/preflight-status.json" \
  --check >"${preflight_output}"
python3 - "${preflight_output}" "${EXPECTED_ADDRESS}" <<'PY'
import json
import pathlib
import sys

expected = sys.argv[2]
try:
    status = json.loads(pathlib.Path(sys.argv[1]).read_text())
except (json.JSONDecodeError, OSError):
    raise SystemExit("watchdog RPC preflight returned invalid output")
bindings = status.get("addressBindings") or {}
identity = status.get("identity") or {}
chain = status.get("chain") or {}
failures = []
if (status.get("service") or {}).get("active") is not True:
    failures.append("service is not active")
if status.get("rpcErrors"):
    failures.append("RPC health check failed")
if bindings.get("coinbaseMatchesExpected") is not True:
    failures.append("coinbase does not match --expected-address")
if bindings.get("identityMatchesExpected") is not True:
    failures.append("identity does not match --expected-address")
if str(identity.get("address", "")).lower() != expected:
    failures.append("identity address is unavailable")
if identity.get("state") != "Human":
    failures.append("identity is not Human")
if identity.get("delegated") is not False:
    failures.append("identity is delegated")
if not isinstance(status.get("peerCount"), int) or status["peerCount"] < 1:
    failures.append("node has no admitted peers")
if chain.get("syncing") is not False or chain.get("wrongTime") is not False:
    failures.append("node is not safely synchronized")
if status.get("epochPeriod") != "None":
    failures.append("validation ceremony is active")
if status.get("pendingOnlineStatusTransactions") != 0:
    failures.append("online-status transaction state is not clear")
if failures:
    raise SystemExit("watchdog RPC preflight refused installation: " + "; ".join(failures))
PY

config_path=/etc/idena-ai/idena-node-watchdog.json
autoonline_dropin=/etc/systemd/system/idena.service.d/50-idena-ai-autoonline.conf
watchdog_script=/usr/local/libexec/idena-ai/node-watchdog.py
watchdog_service=/etc/systemd/system/idena-ai-node-watchdog.service
watchdog_timer=/etc/systemd/system/idena-ai-node-watchdog.timer

if [[ -e "${config_path}" ]]; then
  configured_address="$(python3 - "${config_path}" <<'PY'
import json
import pathlib
import sys

try:
    value = json.loads(pathlib.Path(sys.argv[1]).read_text())["expectedAddress"]
except (OSError, KeyError, TypeError, json.JSONDecodeError):
    raise SystemExit("existing watchdog config is invalid")
print(str(value).lower())
PY
)"
  if [[ "${configured_address}" != "${EXPECTED_ADDRESS}" ]]; then
    echo "existing watchdog config belongs to a different identity" >&2
    exit 2
  fi
fi

if [[ -e "${autoonline_dropin}" ]] && ! cmp -s \
  "${SOURCE_ROOT}/deploy/systemd/idena-ai-node-autoonline.conf" \
  "${autoonline_dropin}"; then
  echo "refusing to overwrite a different ${autoonline_dropin}" >&2
  exit 2
fi

destinations=(
  "${watchdog_script}"
  "${config_path}"
  "${watchdog_service}"
  "${watchdog_timer}"
  "${autoonline_dropin}"
)
for destination in "${destinations[@]}"; do
  if [[ -e "${destination}" ]] && {
    [[ ! -f "${destination}" ]] || [[ -L "${destination}" ]]
  }; then
    echo "refusing to replace non-regular installation target ${destination}" >&2
    exit 2
  fi
done
declare -A destination_labels=(
  ["${watchdog_script}"]=watchdog-script
  ["${config_path}"]=watchdog-config
  ["${watchdog_service}"]=watchdog-service
  ["${watchdog_timer}"]=watchdog-timer
  ["${autoonline_dropin}"]=autoonline-dropin
)
declare -A destination_existed=()
for destination in "${destinations[@]}"; do
  label="${destination_labels[${destination}]}"
  if [[ -e "${destination}" ]]; then
    cp -a -- "${destination}" "${install_tmp_dir}/${label}"
    destination_existed["${destination}"]=1
  else
    destination_existed["${destination}"]=0
  fi
done

timer_was_enabled=0
timer_was_active=0
systemctl is-enabled --quiet idena-ai-node-watchdog.timer 2>/dev/null && timer_was_enabled=1
systemctl is-active --quiet idena-ai-node-watchdog.timer 2>/dev/null && timer_was_active=1
mutation_started=0
install_committed=0
node_restart_attempted=0

rollback_install() {
  local exit_code="$1"
  local rollback_failed=0
  local load_state
  local effective_exec
  set +e
  if [[ "${mutation_started}" -eq 1 && "${install_committed}" -eq 0 ]]; then
    echo "installation failed; restoring the previous Idena watchdog state" >&2
    for unit in idena-ai-node-watchdog.service idena-ai-node-watchdog.timer; do
      load_state="$(systemctl show "${unit}" --property=LoadState --value 2>/dev/null)"
      if [[ -n "${load_state}" && "${load_state}" != "not-found" ]]; then
        if ! systemctl stop "${unit}" >/dev/null 2>&1; then
          echo "rollback failed to stop ${unit}" >&2
          rollback_failed=1
        fi
      fi
    done
    for destination in "${destinations[@]}"; do
      label="${destination_labels[${destination}]}"
      if [[ "${destination_existed[${destination}]}" -eq 1 ]]; then
        if ! cp -a -- "${install_tmp_dir}/${label}" "${destination}"; then
          echo "rollback failed to restore ${destination}" >&2
          rollback_failed=1
        elif ! cmp -s "${install_tmp_dir}/${label}" "${destination}"; then
          echo "rollback verification failed for ${destination}" >&2
          rollback_failed=1
        fi
      else
        if ! rm -f -- "${destination}"; then
          echo "rollback failed to remove ${destination}" >&2
          rollback_failed=1
        elif [[ -e "${destination}" ]]; then
          echo "rollback verification found unexpected ${destination}" >&2
          rollback_failed=1
        fi
      fi
    done
    if ! systemctl daemon-reload >/dev/null 2>&1; then
      echo "rollback failed to reload systemd" >&2
      rollback_failed=1
    fi
    if [[ "${timer_was_enabled}" -eq 1 ]]; then
      systemctl enable idena-ai-node-watchdog.timer >/dev/null 2>&1
      if ! systemctl is-enabled --quiet idena-ai-node-watchdog.timer; then
        echo "rollback failed to restore watchdog timer enablement" >&2
        rollback_failed=1
      fi
    else
      systemctl disable idena-ai-node-watchdog.timer >/dev/null 2>&1
      if systemctl is-enabled --quiet idena-ai-node-watchdog.timer 2>/dev/null; then
        echo "rollback failed to disable the watchdog timer" >&2
        rollback_failed=1
      fi
    fi
    if [[ "${timer_was_active}" -eq 1 ]]; then
      systemctl start idena-ai-node-watchdog.timer >/dev/null 2>&1
      if ! systemctl is-active --quiet idena-ai-node-watchdog.timer; then
        echo "rollback failed to restore the active watchdog timer" >&2
        rollback_failed=1
      fi
    else
      systemctl stop idena-ai-node-watchdog.timer >/dev/null 2>&1
      if systemctl is-active --quiet idena-ai-node-watchdog.timer 2>/dev/null; then
        echo "rollback failed to stop the watchdog timer" >&2
        rollback_failed=1
      fi
    fi
    if [[ "${node_restart_attempted}" -eq 1 ]]; then
      systemctl restart idena.service >/dev/null 2>&1
      if ! systemctl is-active --quiet idena.service; then
        echo "rollback failed to restore the active Idena node" >&2
        rollback_failed=1
      fi
      main_pid="$(systemctl show idena.service --property=MainPID --value 2>/dev/null)"
      if ! python3 - "${main_pid}" "${node_was_autoonline}" <<'PY'
import pathlib
import sys

try:
    pid = int(sys.argv[1])
    should_have_autoonline = bool(int(sys.argv[2]))
    argv = [
        item.decode("utf-8")
        for item in pathlib.Path(f"/proc/{pid}/cmdline").read_bytes().split(b"\0")
        if item
    ]
except (OSError, UnicodeDecodeError, ValueError):
    raise SystemExit(1)
expected = [
    "/usr/local/libexec/idena-node-modern",
    "--config=/mnt/ssd/idena/idena-data/config.json",
    "--datadir=/mnt/ssd/idena/idena-data",
    "--fast",
]
if should_have_autoonline:
    expected.append("--autoonline")
raise SystemExit(0 if argv == expected else 1)
PY
      then
        echo "rollback failed to restore the prior Idena node arguments" >&2
        rollback_failed=1
      fi
    fi
    effective_exec="$(systemctl show idena.service --property=ExecStart --value 2>/dev/null)"
    if [[ "${node_was_autoonline}" -eq 1 ]]; then
      if [[ "${effective_exec}" != *"--autoonline"* ]]; then
        echo "rollback failed to restore the prior auto-online configuration" >&2
        rollback_failed=1
      fi
    elif [[ "${effective_exec}" == *"--autoonline"* ]]; then
      echo "rollback left unexpected auto-online authority configured" >&2
      rollback_failed=1
    fi
  fi
  cleanup_install_tmp
  if [[ "${rollback_failed}" -ne 0 ]]; then
    echo "ROLLBACK FAILED: manual recovery is required" >&2
    exit 3
  fi
  exit "${exit_code}"
}
trap 'rollback_install $?' EXIT

mutation_started=1
install -d -m 0755 /usr/local/libexec/idena-ai
install -m 0755 \
  "${SOURCE_ROOT}/scripts/idena_node_watchdog.py" \
  "${watchdog_script}"
install -d -m 0700 /etc/idena-ai
install -d -m 0755 /etc/systemd/system/idena.service.d

if [[ ! -e "${config_path}" ]]; then
  python3 - "${config_path}" "${EXPECTED_ADDRESS}" <<'PY'
import json
import os
import pathlib
import sys
import tempfile

path = pathlib.Path(sys.argv[1])
payload = {
    "rpcUrl": "http://127.0.0.1:9009",
    "apiKeyFile": "/mnt/ssd/idena/idena-data/api.key",
    "expectedAddress": sys.argv[2],
    "peerLossSeconds": 900,
    "peerZeroSamples": 15,
    "startupGraceSeconds": 1800,
    "restartCooldownSeconds": 3600,
    "onlineFalseSeconds": 900,
    "onlineFalseBlocks": 30,
    "headStaleSeconds": 300,
    "maxBlockLag": 2,
    "recheckSeconds": 5,
    "eligibleIdentityStates": ["Human"],
}
descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
try:
    os.fchmod(descriptor, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary_name, path)
except Exception:
    try:
        os.close(descriptor)
    except OSError:
        pass
    pathlib.Path(temporary_name).unlink(missing_ok=True)
    raise
PY
fi

install -m 0644 \
  "${SOURCE_ROOT}/deploy/systemd/idena-ai-node-watchdog.service" \
  "${watchdog_service}"
install -m 0644 \
  "${SOURCE_ROOT}/deploy/systemd/idena-ai-node-watchdog.timer" \
  "${watchdog_timer}"
install -m 0644 \
  "${SOURCE_ROOT}/deploy/systemd/idena-ai-node-autoonline.conf" \
  "${autoonline_dropin}"

systemctl daemon-reload
systemd-analyze verify \
  "${watchdog_service}" \
  "${watchdog_timer}" \
  idena.service
systemctl enable --now idena-ai-node-watchdog.timer

# Exercise the exact hardened unit, including LoadCredential and its empty
# capability set, while peers are known healthy. This also persists the
# historical healthy-peer arm before the requested node restart.
systemctl start idena-ai-node-watchdog.service

if [[ "${RESTART_NODE}" -eq 1 ]]; then
  node_restart_attempted=1
  systemctl restart idena.service
  main_pid="$(systemctl show idena.service --property=MainPID --value)"
  python3 - "${main_pid}" <<'PY'
import pathlib
import sys

try:
    pid = int(sys.argv[1])
    argv = [
        item.decode("utf-8")
        for item in pathlib.Path(f"/proc/{pid}/cmdline").read_bytes().split(b"\0")
        if item
    ]
except (OSError, UnicodeDecodeError, ValueError):
    raise SystemExit("unable to verify the restarted Idena node")
expected = [
    "/usr/local/libexec/idena-node-modern",
    "--config=/mnt/ssd/idena/idena-data/config.json",
    "--datadir=/mnt/ssd/idena/idena-data",
    "--fast",
    "--autoonline",
]
if argv != expected:
    raise SystemExit("restarted Idena node is missing the exact auto-online arguments")
PY
fi

effective_exec="$(systemctl show idena.service --property=ExecStart --value)"
if [[ "${effective_exec}" != *"--autoonline"* ]]; then
  echo "effective idena.service configuration is missing --autoonline" >&2
  exit 1
fi
systemctl is-enabled --quiet idena-ai-node-watchdog.timer
systemctl is-active --quiet idena-ai-node-watchdog.timer

install_committed=1
echo "Idena node watchdog installed and timer enabled."
if [[ "${RESTART_NODE}" -eq 0 ]]; then
  echo "idena.service was not restarted; --autoonline becomes active at its next restart."
fi
