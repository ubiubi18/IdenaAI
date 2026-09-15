#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

readonly CONFIG_FILE="${IDENA_AUTO_CONFIG:-/etc/idena-auto-transfer.conf}"
readonly PROFILE_DIR="${IDENA_PROFILE_DIR:-/var/lib/idena-ai/profile}"
readonly API_KEY_FILE="${PROFILE_DIR}/node/datadir/api.key"
readonly RUNTIME_FILE="${PROFILE_DIR}/node/runtime.json"
readonly STATE_DIR="${IDENA_AUTO_STATE_DIR:-/var/lib/idena-auto-transfer}"

log() {
  printf '%s\n' "$*"
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command is missing: $1"
}

validate_decimal() {
  python3 - "$1" <<'PY'
from decimal import Decimal, InvalidOperation
import sys
try:
    value = Decimal(sys.argv[1])
except InvalidOperation:
    raise SystemExit(1)
raise SystemExit(0 if value.is_finite() and value >= 0 else 1)
PY
}

decimal_ge() {
  python3 - "$1" "$2" <<'PY'
from decimal import Decimal
import sys
raise SystemExit(0 if Decimal(sys.argv[1]) >= Decimal(sys.argv[2]) else 1)
PY
}

decimal_sum3() {
  python3 - "$1" "$2" "$3" <<'PY'
from decimal import Decimal
import sys
print(format(sum(Decimal(value) for value in sys.argv[1:]), 'f'))
PY
}

load_config() {
  local state_owner_uid

  require_command curl
  require_command flock
  require_command jq
  require_command python3

  [[ -f "$CONFIG_FILE" ]] || fail "configuration is missing"
  [[ "$(stat -c '%U' "$CONFIG_FILE")" == root ]] || fail "configuration must be owned by root"
  [[ -z "$(find "$CONFIG_FILE" -perm /022 -print -quit)" ]] || fail "configuration must not be group/world writable"

  # systemd reads the root-only EnvironmentFile before dropping privileges.
  # Interactive root runs fall back to sourcing the same file directly.
  if [[ -z "${SOURCE_ADDRESS:-}" || -z "${TARGET_ADDRESS:-}" ||
        -z "${BATCH_AMOUNT_IDNA:-}" || -z "${FEE_RESERVE_IDNA:-}" ||
        -z "${TRANSFER_PAYLOAD_HEX:-}" || -z "${STAKE_PAYLOAD_PREFIX_HEX:-}" ]]; then
    # shellcheck disable=SC1090
    source "$CONFIG_FILE"
  fi

  : "${SOURCE_ADDRESS:?SOURCE_ADDRESS is required}"
  : "${TARGET_ADDRESS:?TARGET_ADDRESS is required}"
  : "${BATCH_AMOUNT_IDNA:?BATCH_AMOUNT_IDNA is required}"
  : "${FEE_RESERVE_IDNA:?FEE_RESERVE_IDNA is required}"
  : "${TRANSFER_PAYLOAD_HEX:?TRANSFER_PAYLOAD_HEX is required}"
  : "${STAKE_PAYLOAD_PREFIX_HEX:?STAKE_PAYLOAD_PREFIX_HEX is required}"

  [[ "$SOURCE_ADDRESS" =~ ^0x[[:xdigit:]]{40}$ ]] || fail "invalid configured source address"
  [[ "$TARGET_ADDRESS" =~ ^0x[[:xdigit:]]{40}$ ]] || fail "invalid configured target address"
  [[ "${SOURCE_ADDRESS,,}" != "${TARGET_ADDRESS,,}" ]] || fail "source and target identities must differ"
  validate_decimal "$BATCH_AMOUNT_IDNA" || fail "invalid batch amount"
  validate_decimal "$FEE_RESERVE_IDNA" || fail "invalid fee reserve"
  decimal_ge "$BATCH_AMOUNT_IDNA" "0.000000000000000001" || fail "batch amount must be positive"
  [[ "$TRANSFER_PAYLOAD_HEX" =~ ^0x([[:xdigit:]]{2})+$ ]] || fail "invalid transfer payload"
  [[ "$STAKE_PAYLOAD_PREFIX_HEX" =~ ^0x([[:xdigit:]]{2})+$ ]] || fail "invalid stake payload prefix"

  [[ -s "$API_KEY_FILE" ]] || fail "local node RPC key is unavailable"
  [[ -d "$STATE_DIR" ]] || fail "state directory is missing"
  state_owner_uid="$(stat -c '%u' "$STATE_DIR")"
  if [[ "${MODE:-}" != --status || "$(id -u)" != 0 ]]; then
    [[ "$state_owner_uid" == "$(id -u)" ]] || fail "state directory must be owned by the service user"
  fi
  [[ -z "$(find "$STATE_DIR" -maxdepth 0 -perm /077 -print -quit)" ]] || fail "state directory must not be accessible by group or world"
}

rpc() {
  local method="$1"
  local params="${2:-[]}" api_key port payload

  jq -e . >/dev/null 2>&1 <<<"$params" || fail "invalid local RPC parameter JSON"
  api_key="$(tr -d '\r\n' <"$API_KEY_FILE")"
  [[ -n "$api_key" ]] || fail "local node RPC key is empty"

  port=9129
  if [[ -s "$RUNTIME_FILE" ]]; then
    local candidate
    candidate="$(jq -r '.port // empty' "$RUNTIME_FILE" 2>/dev/null || true)"
    if [[ "$candidate" =~ ^[0-9]+$ ]] && ((candidate >= 1024 && candidate <= 65535)); then
      port="$candidate"
    fi
  fi

  payload="$(jq -cn \
    --arg method "$method" \
    --arg key "$api_key" \
    --argjson params "$params" \
    '{jsonrpc:"2.0",method:$method,params:$params,id:1,key:$key}')"

  printf '%s' "$payload" | curl \
    --fail \
    --silent \
    --show-error \
    --max-time 10 \
    --header 'Content-Type: application/json' \
    --data-binary @- \
    "http://127.0.0.1:${port}/"
}

require_rpc_result() {
  local response="$1" operation="$2" message
  if ! jq -e 'has("result") and (.error == null)' >/dev/null 2>&1 <<<"$response"; then
    message="$(jq -r '.error.message // "unknown RPC error"' <<<"$response" 2>/dev/null || printf 'invalid RPC response')"
    fail "${operation}: ${message}"
  fi
}

node_is_synced() {
  local sync peers
  sync="$(rpc bcn_syncing)" || return 1
  peers="$(rpc net_peers)" || return 1
  jq -e '
    .result != null and
    (.result.syncing == false) and
    ((.result.currentBlock // 0) >= (.result.highestBlock // 0))
  ' >/dev/null 2>&1 <<<"$sync" || return 1
  jq -e '(.result | type == "array") and (.result | length > 0)' >/dev/null 2>&1 <<<"$peers"
}

current_address() {
  local response
  response="$(rpc dna_getCoinbaseAddr)"
  require_rpc_result "$response" "read current identity"
  jq -er '.result' <<<"$response"
}

balance_for() {
  local address="$1" response params
  params="$(jq -cn --arg address "$address" '[$address]')"
  response="$(rpc dna_getBalance "$params")"
  require_rpc_result "$response" "read balance"
  jq -er '.result.balance' <<<"$response"
}

identity_state_for() {
  local address="$1" response params
  params="$(jq -cn --arg address "$address" '[$address]')"
  response="$(rpc dna_identity "$params")"
  require_rpc_result "$response" "read identity"
  jq -er '.result.state' <<<"$response"
}

pending_transactions_for() {
  local address="$1" response params
  params="$(jq -cn --arg address "$address" '[{address:$address,count:100}]')"
  response="$(rpc bcn_pendingTransactions "$params")"
  require_rpc_result "$response" "read pending transactions"
  printf '%s\n' "$response"
}

recent_transactions_for() {
  local address="$1" response params
  params="$(jq -cn --arg address "$address" '[{address:$address,count:100}]')"
  response="$(rpc bcn_transactions "$params")"
  require_rpc_result "$response" "read confirmed transactions"
  printf '%s\n' "$response"
}

transaction_by_hash() {
  local hash="$1" params
  params="$(jq -cn --arg hash "$hash" '[$hash]')"
  rpc bcn_transaction "$params"
}

estimate_transaction() {
  local args="$1" response message
  response="$(rpc bcn_estimateTx "[$args]")"
  if ! jq -e 'has("result") and (.error == null)' >/dev/null 2>&1 <<<"$response"; then
    message="$(jq -r '.error.message // "unknown RPC error"' <<<"$response" 2>/dev/null || printf 'invalid RPC response')"
    if [[ "${message,,}" == *"insufficient funds"* ]]; then
      return 2
    fi
    printf 'ERROR: estimate transaction: %s\n' "$message" >&2
    return 1
  fi
  printf '%s\n' "$response"
}

submit_transaction() {
  local args="$1" response
  response="$(rpc dna_sendTransaction "[$args]")"
  require_rpc_result "$response" "submit transaction"
  jq -er '.result' <<<"$response"
}

atomic_write_json() {
  local path="$1" json="$2" tmp
  jq -e . >/dev/null 2>&1 <<<"$json" || fail "refusing to write invalid state JSON"
  tmp="$(mktemp "${STATE_DIR}/.state.XXXXXX")"
  printf '%s\n' "$json" >"$tmp"
  chmod 0600 "$tmp"
  mv -f "$tmp" "$path"
}

hash_is_pending() {
  local response="$1" hash="$2"
  jq -e --arg hash "${hash,,}" '
    [.result.transactions[]? | select((((.hash // "") | ascii_downcase) == $hash))] | length > 0
  ' >/dev/null 2>&1 <<<"$response"
}

hash_is_confirmed() {
  local response="$1" hash="$2"
  jq -e --arg hash "${hash,,}" '
    .error == null and .result != null and
    ((.result.hash // "" | ascii_downcase) == $hash) and
    ((.result.blockHash // "") | test("^0x[0-9a-fA-F]{64}$")) and
    (.result.blockHash != ("0x" + ("0" * 64)))
  ' >/dev/null 2>&1 <<<"$response"
}

# Reserve a specific transaction position instead of asking the node to append
# another spend behind a manual transfer whose funds have not left the balance.
transaction_slot() {
  local address="$1" pending="$2" balance epoch
  if jq -e --arg from "${address,,}" '
    any(.result.transactions[]?; ((.from // "") | ascii_downcase) == $from)
  ' >/dev/null <<<"$pending"; then
    return 2
  fi
  balance="$(rpc dna_getBalance "[\"$address\"]")"
  require_rpc_result "$balance" "read transaction nonce"
  if ! jq -e '.result.nonce == .result.mempoolNonce' >/dev/null <<<"$balance"; then
    return 2
  fi
  epoch="$(rpc dna_epoch)"
  require_rpc_result "$epoch" "read transaction epoch"
  jq -cn --argjson balance "$balance" --argjson epoch "$epoch" \
    '{nonce:($balance.result.nonce + 1),epoch:$epoch.result.epoch}'
}

# Absence alone never permits a new payment. Only retire a missing transaction
# when its recorded epoch or nonce means it can no longer be accepted on chain.
transaction_is_invalidated() {
  local record="$1" address="$2" epoch balance
  if ! jq -e '(.epoch | type == "number") and (.nonce | type == "number")' >/dev/null <<<"$record"; then
    return 1
  fi
  epoch="$(rpc dna_epoch)"
  require_rpc_result "$epoch" "read transaction epoch"
  balance="$(rpc dna_getBalance "[\"$address\"]")"
  require_rpc_result "$balance" "read confirmed nonce"
  jq -e --argjson epoch "$epoch" --argjson balance "$balance" '
    (.epoch < $epoch.result.epoch) or
    (.epoch == $epoch.result.epoch and .nonce <= $balance.result.nonce)
  ' >/dev/null <<<"$record"
}
