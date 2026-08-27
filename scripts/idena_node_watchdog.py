#!/usr/bin/env python3
"""Conservative health watchdog for the external Raspberry Pi Idena node.

The watchdog never signs transactions itself.  Mining recovery is owned by the
node's upstream ``--autoonline`` implementation; this process only restarts the
fixed ``idena.service`` unit when a peer-loss or stuck-online condition has been
continuously proven.  RPC failures and malformed responses fail closed.
"""

from __future__ import annotations

import argparse
import copy
import fcntl
import json
import math
import os
import re
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 1
SERVICE_NAME = "idena.service"
RESTART_BUDGET_WINDOW_SECONDS = 6 * 60 * 60
MAX_RESTARTS_PER_WINDOW = 2
DEFAULT_CONFIG_PATH = Path("/etc/idena-ai/idena-node-watchdog.json")
DEFAULT_STATE_PATH = Path("/var/lib/idena-ai-node-watchdog/state.json")
DEFAULT_STATUS_PATH = Path("/var/lib/idena-ai-node-watchdog/status.json")
ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")
API_KEY_FILE_ENV = "IDENA_AI_WATCHDOG_API_KEY_FILE"


class WatchdogError(RuntimeError):
    """An operator-safe watchdog failure."""


class RestartError(WatchdogError):
    """A restart failure with an explicit completion certainty."""

    def __init__(self, message: str, *, outcome_unknown: bool):
        super().__init__(message)
        self.outcome_unknown = outcome_unknown


@dataclass(frozen=True)
class WatchdogConfig:
    rpc_url: str
    api_key_file: Path
    expected_address: str
    peer_loss_seconds: int = 900
    peer_zero_samples: int = 15
    startup_grace_seconds: int = 1800
    restart_cooldown_seconds: int = 3600
    online_false_seconds: int = 900
    online_false_blocks: int = 30
    head_stale_seconds: int = 300
    max_block_lag: int = 2
    recheck_seconds: int = 5
    eligible_identity_states: tuple[str, ...] = ("Human",)


def utc_now_text(epoch_seconds: float | None = None) -> str:
    value = time.time() if epoch_seconds is None else epoch_seconds
    return datetime.fromtimestamp(value, timezone.utc).isoformat().replace(
        "+00:00", "Z"
    )


def require_int(
    value: Any, name: str, *, minimum: int, maximum: int
) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise WatchdogError(f"{name} must be an integer")
    if not minimum <= value <= maximum:
        raise WatchdogError(
            f"{name} must be between {minimum} and {maximum}"
        )
    return value


def validate_loopback_rpc_url(value: Any) -> str:
    if not isinstance(value, str):
        raise WatchdogError("rpcUrl must be a string")
    parsed = urllib.parse.urlsplit(value)
    if (
        parsed.scheme != "http"
        or parsed.hostname not in {"127.0.0.1", "::1"}
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or parsed.path not in {"", "/"}
    ):
        raise WatchdogError(
            "rpcUrl must be loopback-only HTTP without credentials, query, or fragment"
        )
    try:
        port = parsed.port
    except ValueError as error:
        raise WatchdogError("rpcUrl has an invalid port") from error
    if port is None or not 1 <= port <= 65535:
        raise WatchdogError("rpcUrl must include a valid port")
    return value.rstrip("/")


def load_config(path: Path) -> WatchdogConfig:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise WatchdogError(f"watchdog config is missing: {path}") from error
    except (OSError, json.JSONDecodeError) as error:
        raise WatchdogError(f"watchdog config is unreadable: {path}") from error
    if not isinstance(raw, dict):
        raise WatchdogError("watchdog config must be a JSON object")

    allowed_keys = {
        "rpcUrl",
        "apiKeyFile",
        "expectedAddress",
        "peerLossSeconds",
        "peerZeroSamples",
        "startupGraceSeconds",
        "restartCooldownSeconds",
        "onlineFalseSeconds",
        "onlineFalseBlocks",
        "headStaleSeconds",
        "maxBlockLag",
        "recheckSeconds",
        "eligibleIdentityStates",
    }
    unknown_keys = sorted(set(raw) - allowed_keys)
    if unknown_keys:
        raise WatchdogError(
            f"unknown watchdog config field(s): {', '.join(unknown_keys)}"
        )

    key_file_value = os.environ.get(API_KEY_FILE_ENV, raw.get("apiKeyFile"))
    if not isinstance(key_file_value, str) or not key_file_value:
        raise WatchdogError("apiKeyFile must be an absolute path")
    key_file = Path(key_file_value)
    if not key_file.is_absolute():
        raise WatchdogError("apiKeyFile must be an absolute path")

    address = raw.get("expectedAddress")
    if not isinstance(address, str) or not ADDRESS_RE.fullmatch(address):
        raise WatchdogError("expectedAddress must be a 20-byte hex address")
    if address.lower() == "0x" + "0" * 40:
        raise WatchdogError("expectedAddress must not be the zero address")

    states = raw.get("eligibleIdentityStates", ["Human"])
    if (
        not isinstance(states, list)
        or not states
        or any(not isinstance(item, str) or not item for item in states)
    ):
        raise WatchdogError(
            "eligibleIdentityStates must be a non-empty string array"
        )

    return WatchdogConfig(
        rpc_url=validate_loopback_rpc_url(
            raw.get("rpcUrl", "http://127.0.0.1:9009")
        ),
        api_key_file=key_file,
        expected_address=address.lower(),
        peer_loss_seconds=require_int(
            raw.get("peerLossSeconds", 900),
            "peerLossSeconds",
            minimum=900,
            maximum=86400,
        ),
        peer_zero_samples=require_int(
            raw.get("peerZeroSamples", 15),
            "peerZeroSamples",
            minimum=2,
            maximum=1440,
        ),
        startup_grace_seconds=require_int(
            raw.get("startupGraceSeconds", 1800),
            "startupGraceSeconds",
            minimum=900,
            maximum=86400,
        ),
        restart_cooldown_seconds=require_int(
            raw.get("restartCooldownSeconds", 3600),
            "restartCooldownSeconds",
            minimum=1800,
            maximum=604800,
        ),
        online_false_seconds=require_int(
            raw.get("onlineFalseSeconds", 900),
            "onlineFalseSeconds",
            minimum=900,
            maximum=86400,
        ),
        online_false_blocks=require_int(
            raw.get("onlineFalseBlocks", 30),
            "onlineFalseBlocks",
            minimum=2,
            maximum=10000,
        ),
        head_stale_seconds=require_int(
            raw.get("headStaleSeconds", 300),
            "headStaleSeconds",
            minimum=60,
            maximum=3600,
        ),
        max_block_lag=require_int(
            raw.get("maxBlockLag", 2),
            "maxBlockLag",
            minimum=0,
            maximum=100,
        ),
        recheck_seconds=require_int(
            raw.get("recheckSeconds", 5),
            "recheckSeconds",
            minimum=1,
            maximum=30,
        ),
        eligible_identity_states=tuple(states),
    )


def read_api_key(path: Path) -> str:
    try:
        info = path.lstat()
    except OSError as error:
        raise WatchdogError("Idena RPC key file is unavailable") from error
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
        raise WatchdogError("Idena RPC key file must be a regular file")
    if stat.S_IMODE(info.st_mode) & 0o077:
        raise WatchdogError("Idena RPC key file permissions are too broad")
    try:
        raw = path.read_bytes()
    except OSError as error:
        raise WatchdogError("Idena RPC key file is unreadable") from error
    if not 16 <= len(raw) <= 4096:
        raise WatchdogError("Idena RPC key has an invalid format")
    try:
        value = raw.decode("utf-8").strip()
    except UnicodeDecodeError as error:
        raise WatchdogError("Idena RPC key has an invalid format") from error
    if not value or any(character.isspace() for character in value):
        raise WatchdogError("Idena RPC key has an invalid format")
    return value


class RpcClient:
    def __init__(self, url: str, api_key: str, timeout_seconds: int = 8):
        self.url = url
        self.api_key = api_key
        self.timeout_seconds = timeout_seconds

    def call(self, method: str, params: list[Any] | None = None) -> Any:
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "key": self.api_key,
            "method": method,
            "params": params or [],
        }
        request = urllib.request.Request(
            self.url,
            data=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(
                request, timeout=self.timeout_seconds
            ) as response:
                body = response.read(1024 * 1024 + 1)
        except urllib.error.HTTPError as error:
            raise WatchdogError(
                f"RPC {method} returned HTTP {error.code}"
            ) from error
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise WatchdogError(f"RPC {method} is unavailable") from error
        if len(body) > 1024 * 1024:
            raise WatchdogError(f"RPC {method} response is too large")
        try:
            decoded = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise WatchdogError(f"RPC {method} returned invalid JSON") from error
        if not isinstance(decoded, dict):
            raise WatchdogError(f"RPC {method} returned an invalid envelope")
        if decoded.get("error") is not None:
            error_value = decoded["error"]
            code = error_value.get("code") if isinstance(error_value, dict) else None
            suffix = f" ({code})" if isinstance(code, int) else ""
            raise WatchdogError(f"RPC {method} returned an error{suffix}")
        return decoded.get("result")


def run_systemctl_show() -> dict[str, str]:
    try:
        result = subprocess.run(
            [
                "/usr/bin/systemctl",
                "show",
                SERVICE_NAME,
                "--property=ActiveState",
                "--property=MainPID",
                "--property=ActiveEnterTimestampMonotonic",
            ],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise WatchdogError("unable to inspect idena.service") from error
    values: dict[str, str] = {}
    for line in result.stdout.splitlines():
        key, separator, value = line.partition("=")
        if separator:
            values[key] = value
    return values


def service_snapshot(monotonic_seconds: float) -> dict[str, Any]:
    values = run_systemctl_show()
    active = values.get("ActiveState") == "active"
    try:
        main_pid = int(values.get("MainPID", "0"))
        active_since = int(values.get("ActiveEnterTimestampMonotonic", "0")) / 1e6
    except ValueError as error:
        raise WatchdogError("idena.service returned invalid runtime metadata") from error
    uptime = max(0.0, monotonic_seconds - active_since) if active_since else 0.0
    arguments: list[str] = []
    if active and main_pid > 0:
        try:
            raw = Path(f"/proc/{main_pid}/cmdline").read_bytes()
            arguments = [
                item.decode("utf-8", errors="replace")
                for item in raw.split(b"\0")
                if item
            ]
        except OSError:
            arguments = []
    return {
        "active": active,
        "mainPid": main_pid,
        "uptimeSeconds": uptime,
        "invocationId": f"{main_pid}:{int(active_since * 1e6)}",
        "autoOnlineActive": "--autoonline" in arguments,
    }


def restart_idena_service() -> None:
    try:
        subprocess.run(
            ["/usr/bin/systemctl", "restart", SERVICE_NAME],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=330,
        )
    except subprocess.TimeoutExpired as error:
        raise RestartError(
            "idena.service restart outcome is unknown after timeout",
            outcome_unknown=True,
        ) from error
    except subprocess.CalledProcessError as error:
        raise RestartError(
            "idena.service restart returned an uncertain failure",
            outcome_unknown=True,
        ) from error
    except OSError as error:
        raise RestartError(
            "idena.service restart failed", outcome_unknown=False
        ) from error


def get_boot_id() -> str:
    try:
        value = Path("/proc/sys/kernel/random/boot_id").read_text(
            encoding="ascii"
        ).strip()
    except OSError as error:
        raise WatchdogError("unable to read host boot identifier") from error
    if not value:
        raise WatchdogError("host boot identifier is empty")
    return value


def default_state() -> dict[str, Any]:
    return {
        "schema": SCHEMA_VERSION,
        "bootId": "",
        "serviceInvocationId": "",
        "everObservedPeers": False,
        "peerMonitoringArmed": False,
        "zeroPeersSince": None,
        "zeroPeerSamples": 0,
        "peerRestartedForOutage": False,
        "onlineFalseSince": None,
        "onlineFalseStartBlock": None,
        "onlineRestartedForEpisode": False,
        "lastObservedBlock": None,
        "recentBlockAdvances": [],
        "lastRestartEpoch": None,
        "restartHistoryEpochs": [],
        "lastAction": None,
        "lastActionAt": None,
        "lastError": None,
    }


def _valid_nonnegative_number(value: Any) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(float(value))
        and value >= 0
    )


def normalize_state(raw: Any) -> dict[str, Any]:
    if raw is None:
        return default_state()
    if (
        not isinstance(raw, dict)
        or type(raw.get("schema")) is not int
        or raw.get("schema") != SCHEMA_VERSION
    ):
        raise WatchdogError("watchdog state has an unsupported schema")
    state = default_state()
    for key in state:
        if key in raw:
            state[key] = raw[key]

    for key in ("bootId", "serviceInvocationId"):
        if not isinstance(state[key], str):
            raise WatchdogError(f"watchdog state field {key} is invalid")
    for key in (
        "everObservedPeers",
        "peerMonitoringArmed",
        "peerRestartedForOutage",
        "onlineRestartedForEpisode",
    ):
        if not isinstance(state[key], bool):
            raise WatchdogError(f"watchdog state field {key} is invalid")
    if not _valid_nonnegative_int(state["zeroPeerSamples"]):
        raise WatchdogError("watchdog state field zeroPeerSamples is invalid")
    for key in ("zeroPeersSince", "onlineFalseSince", "lastRestartEpoch"):
        value = state[key]
        if value is not None and not _valid_nonnegative_number(value):
            raise WatchdogError(f"watchdog state field {key} is invalid")
    for key in ("onlineFalseStartBlock", "lastObservedBlock"):
        value = state[key]
        if value is not None and not _valid_nonnegative_int(value):
            raise WatchdogError(f"watchdog state field {key} is invalid")
    for key in ("lastAction", "lastActionAt", "lastError"):
        value = state[key]
        if value is not None and not isinstance(value, str):
            raise WatchdogError(f"watchdog state field {key} is invalid")
    for key in ("recentBlockAdvances", "restartHistoryEpochs"):
        values = state[key]
        if not isinstance(values, list) or any(
            not _valid_nonnegative_number(value) for value in values
        ):
            raise WatchdogError(f"watchdog state field {key} is invalid")
    return state


def read_state(path: Path) -> dict[str, Any]:
    try:
        return normalize_state(json.loads(path.read_text(encoding="utf-8")))
    except FileNotFoundError:
        return default_state()
    except (OSError, json.JSONDecodeError) as error:
        raise WatchdogError("watchdog state is unreadable; refusing recovery") from error


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path.parent, 0o700)
    descriptor = -1
    temporary_path: Path | None = None
    try:
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=f".{path.name}.", dir=path.parent
        )
        temporary_path = Path(temporary_name)
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            descriptor = -1
            json.dump(payload, handle, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, path)
        temporary_path = None
        directory_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def safe_rpc_call(
    client: RpcClient, method: str, params: list[Any] | None, errors: list[str]
) -> Any:
    try:
        return client.call(method, params)
    except WatchdogError:
        errors.append(method)
        return None


def collect_snapshot(
    config: WatchdogConfig,
    client: RpcClient,
    monotonic_seconds: float,
) -> dict[str, Any]:
    service = service_snapshot(monotonic_seconds)
    snapshot: dict[str, Any] = {
        "service": service,
        "peers": None,
        "syncing": None,
        "lastBlock": None,
        "coinbase": None,
        "identity": None,
        "epoch": None,
        "pendingTransactions": None,
        "rpcErrors": [],
    }
    if not service["active"]:
        return snapshot

    errors = snapshot["rpcErrors"]
    peers = safe_rpc_call(client, "net_peers", [], errors)
    if isinstance(peers, list):
        snapshot["peers"] = len(peers)
    elif "net_peers" not in errors:
        errors.append("net_peers_schema")

    syncing = safe_rpc_call(client, "bcn_syncing", [], errors)
    if isinstance(syncing, dict):
        snapshot["syncing"] = syncing
    elif "bcn_syncing" not in errors:
        errors.append("bcn_syncing_schema")

    block = safe_rpc_call(client, "bcn_lastBlock", [], errors)
    if isinstance(block, dict):
        snapshot["lastBlock"] = block
    elif "bcn_lastBlock" not in errors:
        errors.append("bcn_lastBlock_schema")

    coinbase = safe_rpc_call(client, "dna_getCoinbaseAddr", [], errors)
    if isinstance(coinbase, str):
        snapshot["coinbase"] = coinbase.lower()
    elif "dna_getCoinbaseAddr" not in errors:
        errors.append("dna_getCoinbaseAddr_schema")

    identity = safe_rpc_call(
        client, "dna_identity", [config.expected_address], errors
    )
    if isinstance(identity, dict):
        snapshot["identity"] = identity
    elif "dna_identity" not in errors:
        errors.append("dna_identity_schema")

    epoch = safe_rpc_call(client, "dna_epoch", [], errors)
    if isinstance(epoch, dict):
        snapshot["epoch"] = epoch
    elif "dna_epoch" not in errors:
        errors.append("dna_epoch_schema")

    pending = safe_rpc_call(
        client,
        "bcn_pendingTransactions",
        [{"address": config.expected_address, "count": 50}],
        errors,
    )
    if isinstance(pending, dict) and "transactions" in pending:
        transactions = pending.get("transactions")
        if transactions is None:
            snapshot["pendingTransactions"] = []
        elif isinstance(transactions, list) and all(
            isinstance(transaction, dict) for transaction in transactions
        ):
            snapshot["pendingTransactions"] = transactions
        else:
            errors.append("bcn_pendingTransactions_schema")
    elif "bcn_pendingTransactions" not in errors:
        errors.append("bcn_pendingTransactions_schema")
    return snapshot


def _valid_nonnegative_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def _restart_cooldown_ready(
    state: dict[str, Any], config: WatchdogConfig, epoch_seconds: float
) -> bool:
    previous = state.get("lastRestartEpoch")
    if not isinstance(previous, (int, float)):
        return True
    elapsed = epoch_seconds - float(previous)
    return elapsed >= config.restart_cooldown_seconds


def prune_restart_history(
    state: dict[str, Any], epoch_seconds: float
) -> list[float]:
    minimum = epoch_seconds - RESTART_BUDGET_WINDOW_SECONDS
    history = sorted(
        float(value)
        for value in state.get("restartHistoryEpochs", [])
        if isinstance(value, (int, float))
        and minimum <= float(value) <= epoch_seconds + 60
    )
    state["restartHistoryEpochs"] = history
    return history


def _restart_budget_ready(state: dict[str, Any], epoch_seconds: float) -> bool:
    return (
        len(prune_restart_history(state, epoch_seconds))
        < MAX_RESTARTS_PER_WINDOW
    )


def update_block_progress(
    state: dict[str, Any], snapshot: dict[str, Any], now: float, stale: int
) -> None:
    block = snapshot.get("lastBlock")
    height = block.get("height") if isinstance(block, dict) else None
    advances = [
        float(value)
        for value in state.get("recentBlockAdvances", [])
        if isinstance(value, (int, float)) and now - float(value) <= stale
    ]
    previous = state.get("lastObservedBlock")
    if _valid_nonnegative_int(height):
        if _valid_nonnegative_int(previous):
            if height > previous:
                advances.append(now)
            elif height < previous:
                advances = []
        state["lastObservedBlock"] = height
    state["recentBlockAdvances"] = advances[-16:]


def online_health_failures(
    state: dict[str, Any],
    snapshot: dict[str, Any],
    config: WatchdogConfig,
    monotonic_seconds: float,
    epoch_seconds: float,
) -> list[str]:
    failures: list[str] = []
    service = snapshot.get("service") or {}
    if service.get("active") is not True:
        failures.append("service_inactive")
    if float(service.get("uptimeSeconds") or 0) < config.startup_grace_seconds:
        failures.append("startup_grace")
    if service.get("autoOnlineActive") is not True:
        failures.append("autoonline_missing")

    peers = snapshot.get("peers")
    if not isinstance(peers, int) or isinstance(peers, bool) or peers < 1:
        failures.append("no_confirmed_peer")

    syncing = snapshot.get("syncing")
    if not isinstance(syncing, dict):
        failures.append("sync_unknown")
    else:
        if syncing.get("syncing") is not False:
            failures.append("syncing")
        if syncing.get("wrongTime") is not False:
            failures.append("wrong_time")
        current = syncing.get("currentBlock")
        highest = syncing.get("highestBlock")
        if not _valid_nonnegative_int(current) or not _valid_nonnegative_int(
            highest
        ):
            failures.append("sync_height_unknown")
        elif highest - current > config.max_block_lag or current > highest:
            failures.append("block_lag")

    block = snapshot.get("lastBlock")
    height = block.get("height") if isinstance(block, dict) else None
    timestamp = block.get("timestamp") if isinstance(block, dict) else None
    if not _valid_nonnegative_int(height) or not isinstance(
        timestamp, (int, float)
    ):
        failures.append("head_unknown")
    else:
        age = epoch_seconds - float(timestamp)
        if age < -60 or age > config.head_stale_seconds:
            failures.append("head_stale")
    recent_advances = state.get("recentBlockAdvances")
    if not isinstance(recent_advances, list) or len(recent_advances) < 2:
        failures.append("head_not_advancing")
    elif monotonic_seconds - float(recent_advances[-1]) > config.head_stale_seconds:
        failures.append("head_not_advancing")

    epoch = snapshot.get("epoch")
    if not isinstance(epoch, dict) or epoch.get("currentPeriod") != "None":
        failures.append("ceremony_period")

    pending_transactions = snapshot.get("pendingTransactions")
    if not isinstance(pending_transactions, list):
        failures.append("pending_transactions_unknown")
    elif any(
        transaction.get("type") == "online"
        for transaction in pending_transactions
        if isinstance(transaction, dict)
    ):
        failures.append("pending_online_status_transaction")

    if snapshot.get("coinbase") != config.expected_address:
        failures.append("coinbase_mismatch")
    identity = snapshot.get("identity")
    if not isinstance(identity, dict):
        failures.append("identity_unknown")
    else:
        address = identity.get("address")
        if not isinstance(address, str) or address.lower() != config.expected_address:
            failures.append("identity_mismatch")
        state_name = identity.get("state")
        if state_name not in config.eligible_identity_states:
            failures.append("identity_ineligible")
        if identity.get("delegatee") is not None:
            failures.append("identity_delegated")
        if identity.get("online") is not False:
            failures.append("identity_not_offline")
    return failures


def evaluate_tick(
    previous_state: dict[str, Any],
    snapshot: dict[str, Any],
    config: WatchdogConfig,
    *,
    boot_id: str,
    monotonic_seconds: float,
    epoch_seconds: float,
) -> tuple[dict[str, Any], str | None, dict[str, Any]]:
    state = copy.deepcopy(normalize_state(previous_state))
    action: str | None = None
    notes: list[str] = []
    service = snapshot.get("service") or {}
    invocation_id = str(service.get("invocationId") or "")
    prune_restart_history(state, epoch_seconds)

    if state.get("bootId") != boot_id:
        state["bootId"] = boot_id
        state["serviceInvocationId"] = invocation_id
        state["peerMonitoringArmed"] = False
        state["zeroPeersSince"] = None
        state["zeroPeerSamples"] = 0
        state["peerRestartedForOutage"] = False
        state["onlineFalseSince"] = None
        state["onlineFalseStartBlock"] = None
        state["lastObservedBlock"] = None
        state["recentBlockAdvances"] = []
        notes.append("new_boot")
    elif state.get("serviceInvocationId") != invocation_id:
        state["serviceInvocationId"] = invocation_id
        state["peerMonitoringArmed"] = False
        state["zeroPeersSince"] = None
        state["zeroPeerSamples"] = 0
        state["onlineFalseSince"] = None
        state["onlineFalseStartBlock"] = None
        state["lastObservedBlock"] = None
        state["recentBlockAdvances"] = []
        notes.append("new_service_invocation")

    update_block_progress(
        state,
        snapshot,
        monotonic_seconds,
        config.head_stale_seconds,
    )

    peers = snapshot.get("peers")
    if isinstance(peers, int) and not isinstance(peers, bool) and peers > 0:
        state["everObservedPeers"] = True
        state["peerMonitoringArmed"] = True
        state["zeroPeersSince"] = None
        state["zeroPeerSamples"] = 0
        state["peerRestartedForOutage"] = False
    elif peers == 0:
        if (
            state.get("peerMonitoringArmed") is not True
            and state.get("everObservedPeers") is True
            and service.get("active") is True
            and float(service.get("uptimeSeconds") or 0)
            >= config.startup_grace_seconds
        ):
            state["peerMonitoringArmed"] = True
            notes.append("peer_monitor_rearmed_after_startup_grace")
        if state.get("peerMonitoringArmed") is True:
            if not isinstance(state.get("zeroPeersSince"), (int, float)):
                state["zeroPeersSince"] = monotonic_seconds
                state["zeroPeerSamples"] = 1
            else:
                state["zeroPeerSamples"] = int(
                    state.get("zeroPeerSamples") or 0
                ) + 1
            elapsed = monotonic_seconds - float(state["zeroPeersSince"])
            peer_action_ready = (
                elapsed >= config.peer_loss_seconds
                and int(state.get("zeroPeerSamples") or 0)
                >= config.peer_zero_samples
                and service.get("active") is True
                and state.get("peerRestartedForOutage") is not True
                and _restart_cooldown_ready(state, config, epoch_seconds)
                and _restart_budget_ready(state, epoch_seconds)
            )
            if peer_action_ready:
                action = "restart_peer_loss"
        else:
            notes.append("peer_monitor_unarmed")
    else:
        state["zeroPeersSince"] = None
        state["zeroPeerSamples"] = 0
        notes.append("peer_state_unknown")

    identity = snapshot.get("identity")
    if isinstance(identity, dict) and identity.get("online") is True:
        state["onlineFalseSince"] = None
        state["onlineFalseStartBlock"] = None
        state["onlineRestartedForEpisode"] = False
    else:
        failures = online_health_failures(
            state,
            snapshot,
            config,
            monotonic_seconds,
            epoch_seconds,
        )
        if failures:
            state["onlineFalseSince"] = None
            state["onlineFalseStartBlock"] = None
            notes.extend(failures)
        else:
            block = snapshot["lastBlock"]
            height = int(block["height"])
            if not isinstance(state.get("onlineFalseSince"), (int, float)):
                state["onlineFalseSince"] = monotonic_seconds
                state["onlineFalseStartBlock"] = height
            elapsed = monotonic_seconds - float(state["onlineFalseSince"])
            start_height = state.get("onlineFalseStartBlock")
            blocks = (
                height - int(start_height)
                if _valid_nonnegative_int(start_height)
                else 0
            )
            online_action_ready = (
                elapsed >= config.online_false_seconds
                and blocks >= config.online_false_blocks
                and state.get("onlineRestartedForEpisode") is not True
                and _restart_cooldown_ready(state, config, epoch_seconds)
                and _restart_budget_ready(state, epoch_seconds)
            )
            if action is None and online_action_ready:
                action = "restart_online_stuck"

    details = {
        "notes": sorted(set(notes)),
        "peerOutageSeconds": (
            max(0, int(monotonic_seconds - float(state["zeroPeersSince"])))
            if isinstance(state.get("zeroPeersSince"), (int, float))
            else 0
        ),
        "onlineFalseHealthySeconds": (
            max(0, int(monotonic_seconds - float(state["onlineFalseSince"])))
            if isinstance(state.get("onlineFalseSince"), (int, float))
            else 0
        ),
    }
    return state, action, details


def recheck_action(
    action: str,
    state: dict[str, Any],
    snapshot: dict[str, Any],
    config: WatchdogConfig,
    monotonic_seconds: float,
    epoch_seconds: float,
) -> bool:
    service = snapshot.get("service") or {}
    if service.get("active") is not True:
        return False
    if service.get("invocationId") != state.get("serviceInvocationId"):
        return False
    if action == "restart_peer_loss":
        return snapshot.get("peers") == 0
    if action == "restart_online_stuck":
        return not online_health_failures(
            state,
            snapshot,
            config,
            monotonic_seconds,
            epoch_seconds,
        )
    return False


def mark_action_started(
    state: dict[str, Any], action: str, epoch_seconds: float
) -> None:
    if action == "restart_peer_loss":
        state["peerRestartedForOutage"] = True
        state["zeroPeersSince"] = None
        state["zeroPeerSamples"] = 0
    elif action == "restart_online_stuck":
        state["onlineRestartedForEpisode"] = True
        state["onlineFalseSince"] = None
        state["onlineFalseStartBlock"] = None
    state["lastRestartEpoch"] = epoch_seconds
    history = prune_restart_history(state, epoch_seconds)
    history.append(epoch_seconds)
    state["restartHistoryEpochs"] = history[-MAX_RESTARTS_PER_WINDOW:]
    state["lastAction"] = action
    state["lastActionAt"] = utc_now_text(epoch_seconds)
    state["lastError"] = None


def mark_action_failed(
    state: dict[str, Any], action: str, error: RestartError
) -> None:
    """Record a failed attempt without guessing after an ambiguous timeout."""
    if not error.outcome_unknown:
        if action == "restart_peer_loss":
            state["peerRestartedForOutage"] = False
        elif action == "restart_online_stuck":
            state["onlineRestartedForEpisode"] = False
    state["lastError"] = str(error)


def build_status(
    state: dict[str, Any],
    snapshot: dict[str, Any],
    action: str | None,
    details: dict[str, Any],
    config: WatchdogConfig,
    epoch_seconds: float,
    *,
    mode: str,
) -> dict[str, Any]:
    service = snapshot.get("service") or {}
    sync = snapshot.get("syncing") or {}
    block = snapshot.get("lastBlock") or {}
    identity = snapshot.get("identity") or {}
    epoch = snapshot.get("epoch") or {}
    pending_transactions = snapshot.get("pendingTransactions")
    pending_online_count = (
        sum(
            transaction.get("type") == "online"
            for transaction in pending_transactions
            if isinstance(transaction, dict)
        )
        if isinstance(pending_transactions, list)
        else None
    )
    identity_address = identity.get("address")
    identity_matches = (
        isinstance(identity_address, str)
        and identity_address.lower() == config.expected_address
    )
    return {
        "schema": SCHEMA_VERSION,
        "generatedAt": utc_now_text(epoch_seconds),
        "mode": mode,
        "proposedAction": action,
        "notes": details.get("notes", []),
        "peerCount": snapshot.get("peers"),
        "everObservedPeers": state.get("everObservedPeers"),
        "peerMonitoringArmed": state.get("peerMonitoringArmed"),
        "peerOutageSeconds": details.get("peerOutageSeconds", 0),
        "zeroPeerSamples": state.get("zeroPeerSamples", 0),
        "onlineFalseHealthySeconds": details.get(
            "onlineFalseHealthySeconds", 0
        ),
        "service": {
            "name": SERVICE_NAME,
            "active": service.get("active"),
            "uptimeSeconds": int(float(service.get("uptimeSeconds") or 0)),
            "autoOnlineActive": service.get("autoOnlineActive"),
        },
        "chain": {
            "syncing": sync.get("syncing"),
            "wrongTime": sync.get("wrongTime"),
            "currentBlock": sync.get("currentBlock"),
            "highestBlock": sync.get("highestBlock"),
            "lastBlockHeight": block.get("height"),
            "lastBlockTimestamp": block.get("timestamp"),
        },
        "identity": {
            "address": identity.get("address"),
            "state": identity.get("state"),
            "online": identity.get("online"),
            "isPool": identity.get("isPool"),
            "delegated": identity.get("delegatee") is not None,
            "penaltySeconds": identity.get("penaltySeconds"),
        },
        "epochPeriod": epoch.get("currentPeriod"),
        "pendingOnlineStatusTransactions": pending_online_count,
        "rpcErrors": snapshot.get("rpcErrors", []),
        "addressBindings": {
            "coinbaseMatchesExpected": (
                snapshot.get("coinbase") == config.expected_address
            ),
            "identityMatchesExpected": identity_matches,
        },
        "lastAction": state.get("lastAction"),
        "lastActionAt": state.get("lastActionAt"),
        "restartBudget": {
            "used": len(state.get("restartHistoryEpochs", [])),
            "maximum": MAX_RESTARTS_PER_WINDOW,
            "windowSeconds": RESTART_BUDGET_WINDOW_SECONDS,
        },
        "lastError": state.get("lastError"),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG_PATH)
    parser.add_argument("--state", type=Path, default=DEFAULT_STATE_PATH)
    parser.add_argument("--status", type=Path, default=DEFAULT_STATUS_PATH)
    parser.add_argument(
        "--check",
        action="store_true",
        help="inspect and print the proposed action without writing or restarting",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        config = load_config(args.config)
        api_key = read_api_key(config.api_key_file)
        client = RpcClient(config.rpc_url, api_key)
        monotonic_seconds = time.monotonic()
        epoch_seconds = time.time()
        boot_id = get_boot_id()

        if args.check:
            state = read_state(args.state)
            snapshot = collect_snapshot(config, client, monotonic_seconds)
            next_state, action, details = evaluate_tick(
                state,
                snapshot,
                config,
                boot_id=boot_id,
                monotonic_seconds=monotonic_seconds,
                epoch_seconds=epoch_seconds,
            )
            print(
                json.dumps(
                    build_status(
                        next_state,
                        snapshot,
                        action,
                        details,
                        config,
                        epoch_seconds,
                        mode="check",
                    ),
                    indent=2,
                    sort_keys=True,
                )
            )
            return 0

        args.state.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(args.state.parent, 0o700)
        lock_path = args.state.parent / "lock"
        with lock_path.open("a+", encoding="utf-8") as lock_handle:
            os.chmod(lock_path, 0o600)
            fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            state = read_state(args.state)
            snapshot = collect_snapshot(config, client, monotonic_seconds)
            next_state, action, details = evaluate_tick(
                state,
                snapshot,
                config,
                boot_id=boot_id,
                monotonic_seconds=monotonic_seconds,
                epoch_seconds=epoch_seconds,
            )

            if action is not None:
                time.sleep(config.recheck_seconds)
                recheck_mono = time.monotonic()
                recheck_epoch = time.time()
                recheck = collect_snapshot(config, client, recheck_mono)
                if not recheck_action(
                    action,
                    next_state,
                    recheck,
                    config,
                    recheck_mono,
                    recheck_epoch,
                ):
                    next_state["zeroPeersSince"] = None
                    next_state["zeroPeerSamples"] = 0
                    next_state["onlineFalseSince"] = None
                    next_state["onlineFalseStartBlock"] = None
                    details["notes"] = sorted(
                        set(details.get("notes", [])) | {"recheck_cancelled"}
                    )
                    action = None
                    snapshot = recheck
                else:
                    mark_action_started(next_state, action, recheck_epoch)
                    atomic_write_json(args.state, next_state)
                    atomic_write_json(
                        args.status,
                        build_status(
                            next_state,
                            recheck,
                            action,
                            details,
                            config,
                            recheck_epoch,
                            mode="restart_started",
                        ),
                    )
                    try:
                        restart_idena_service()
                    except RestartError as error:
                        mark_action_failed(next_state, action, error)
                        atomic_write_json(args.state, next_state)
                        atomic_write_json(
                            args.status,
                            build_status(
                                next_state,
                                recheck,
                                None,
                                details,
                                config,
                                time.time(),
                                mode="restart_failed",
                            ),
                        )
                        raise
                    print(f"Idena watchdog completed action={action}", flush=True)
                    return 0

            atomic_write_json(args.state, next_state)
            atomic_write_json(
                args.status,
                build_status(
                    next_state,
                    snapshot,
                    action,
                    details,
                    config,
                    epoch_seconds,
                    mode="observe",
                ),
            )
            print(
                "Idena watchdog observation "
                f"peers={snapshot.get('peers')} action={action or 'none'}",
                flush=True,
            )
        return 0
    except BlockingIOError:
        print("Idena watchdog invocation already running", flush=True)
        return 0
    except WatchdogError as error:
        print(f"Idena watchdog failed closed: {error}", file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
