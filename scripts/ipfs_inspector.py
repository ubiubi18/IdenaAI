#!/usr/bin/env python3
"""Inspect Idena node IPFS payloads through the local JSON-RPC API."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple


DEFAULT_INTERNAL_RPC_PORT = 9119
BASE58_BTC_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
PRINTABLE_CONTROLS = {9, 10, 13}


def trim_text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def resolve_default_user_data_dir() -> Path:
    env_value = trim_text(os.environ.get("IDENAAI_USER_DATA_DIR"))
    if env_value:
        return Path(env_value).expanduser()

    system = platform.system().lower()
    if system == "darwin":
        return Path("~/Library/Application Support/IdenaAI").expanduser()
    if system == "windows":
        appdata = os.environ.get("APPDATA")
        if appdata:
            return Path(appdata) / "IdenaAI"
    return Path("~/.config/IdenaAI").expanduser()


def read_json(path: Path, fallback: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return fallback
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Cannot parse JSON at {path}: {exc}") from exc


def safe_int(value: Any, fallback: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return fallback
    return parsed if parsed > 0 else fallback


def resolve_settings_path(args: argparse.Namespace, user_data_dir: Path) -> Path:
    if trim_text(args.settings_path):
        return Path(args.settings_path).expanduser()
    return user_data_dir / "settings.json"


def resolve_rpc_url(args: argparse.Namespace, settings: Dict[str, Any]) -> str:
    if trim_text(args.rpc_url):
        return trim_text(args.rpc_url).rstrip("/")

    if settings.get("useExternalNode"):
        return (trim_text(settings.get("url")) or "http://localhost:9009").rstrip("/")

    port = safe_int(settings.get("internalPort"), DEFAULT_INTERNAL_RPC_PORT)
    return f"http://127.0.0.1:{port}"


def resolve_rpc_key(
    args: argparse.Namespace, settings: Dict[str, Any], user_data_dir: Path
) -> Tuple[str, str]:
    if trim_text(args.rpc_key):
        return trim_text(args.rpc_key), "--rpc-key"

    if settings.get("useExternalNode"):
        key = trim_text(settings.get("externalApiKey"))
        return key, "settings.externalApiKey" if key else ""

    key = trim_text(settings.get("internalApiKey"))
    if key:
        return key, "settings.internalApiKey"

    api_key_path = user_data_dir / "node" / "datadir" / "api.key"
    if api_key_path.exists():
        key = trim_text(api_key_path.read_text(encoding="utf-8"))
        return key, str(api_key_path)

    return "", ""


class RpcClient:
    def __init__(self, url: str, api_key: str = "", timeout: int = 30):
        self.url = url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

    def call(self, method: str, params: Optional[List[Any]] = None) -> Any:
        payload: Dict[str, Any] = {
            "method": method,
            "params": params or [],
            "id": 1,
        }
        if self.api_key:
            payload["key"] = self.api_key

        request = urllib.request.Request(
            self.url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            method="POST",
        )

        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                body = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            error_body = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(
                f"RPC {method} failed with HTTP {exc.code}: {error_body[:300]}"
            ) from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Cannot reach RPC at {self.url}: {exc.reason}") from exc

        rpc_error = body.get("error")
        if rpc_error:
            if isinstance(rpc_error, dict):
                raise RuntimeError(rpc_error.get("message") or str(rpc_error))
            raise RuntimeError(str(rpc_error))

        return body.get("result")


def clean_cid(value: str) -> str:
    text = trim_text(value)
    if text.startswith("_flip_"):
        text = text[len("_flip_") :]
    if text.startswith("ipfs://"):
        text = text[len("ipfs://") :]
    if "/ipfs/" in text:
        text = text.split("/ipfs/", 1)[1]
    return re.split(r"[/?#]", text, maxsplit=1)[0].strip()


def decode_rpc_hex(value: Any) -> bytes:
    if isinstance(value, bytes):
        return value
    if isinstance(value, list):
        return bytes(value)
    if not isinstance(value, str):
        raise ValueError(f"Expected hex string from ipfs_get, got {type(value).__name__}")

    text = value.strip()
    if text.startswith(("0x", "0X")):
        text = text[2:]
    if len(text) % 2:
        text = "0" + text
    return bytes.fromhex(text)


def base58_btc_encode(data: bytes) -> str:
    if not data:
        return ""

    leading_zeroes = len(data) - len(data.lstrip(b"\x00"))
    number = int.from_bytes(data, "big")
    encoded = ""
    while number:
        number, remainder = divmod(number, 58)
        encoded = BASE58_BTC_ALPHABET[remainder] + encoded

    return "1" * leading_zeroes + (encoded or "1")


def cid_bytes_to_string(data: bytes) -> str:
    # CIDv0 is the raw sha2-256 multihash and is displayed as base58btc.
    if len(data) == 34 and data.startswith(b"\x12\x20"):
        return base58_btc_encode(data)

    # CIDv1 byte representation is commonly displayed as multibase base32.
    return "b" + base64.b32encode(data).decode("ascii").lower().rstrip("=")


def read_varint(data: bytes, offset: int) -> Tuple[int, int]:
    result = 0
    shift = 0
    while offset < len(data):
        byte = data[offset]
        offset += 1
        result |= (byte & 0x7F) << shift
        if byte < 0x80:
            return result, offset
        shift += 7
        if shift > 63:
            raise ValueError("varint is too large")
    raise ValueError("unexpected end of varint")


def skip_protobuf_field(data: bytes, offset: int, wire_type: int) -> int:
    if wire_type == 0:
        _, offset = read_varint(data, offset)
        return offset
    if wire_type == 1:
        return offset + 8
    if wire_type == 2:
        length, offset = read_varint(data, offset)
        return offset + length
    if wire_type == 5:
        return offset + 4
    raise ValueError(f"unsupported protobuf wire type {wire_type}")


def parse_store_to_ipfs_payload(payload_hex: Any) -> Dict[str, Any]:
    data = decode_rpc_hex(payload_hex)
    offset = 0
    cid_bytes = b""
    declared_size: Optional[int] = None

    while offset < len(data):
        tag, offset = read_varint(data, offset)
        field_number = tag >> 3
        wire_type = tag & 0x07

        if field_number == 1 and wire_type == 2:
            length, offset = read_varint(data, offset)
            cid_bytes = data[offset : offset + length]
            offset += length
        elif field_number == 2 and wire_type == 0:
            declared_size, offset = read_varint(data, offset)
        else:
            offset = skip_protobuf_field(data, offset, wire_type)

    return {
        "cid": cid_bytes_to_string(cid_bytes) if cid_bytes else "",
        "cidBytesHex": cid_bytes.hex(),
        "declaredBytes": declared_size,
    }


def text_preview(text: str, max_chars: int) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    if len(text) <= max_chars:
        return text
    return text[:max_chars].rstrip() + "\n..."


def is_mostly_printable(text: str) -> bool:
    if not text:
        return True
    printable = 0
    for char in text:
        code = ord(char)
        if code >= 32 or code in PRINTABLE_CONTROLS:
            printable += 1
    return printable / len(text) >= 0.92


def detect_payload(data: bytes, preview_chars: int) -> Dict[str, Any]:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return {"kind": "image/png", "hexPreview": data[:64].hex()}
    if data.startswith(b"\xff\xd8\xff"):
        return {"kind": "image/jpeg", "hexPreview": data[:64].hex()}
    if data.startswith(b"GIF87a") or data.startswith(b"GIF89a"):
        return {"kind": "image/gif", "hexPreview": data[:64].hex()}
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return {"kind": "image/webp", "hexPreview": data[:64].hex()}

    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return {"kind": "binary", "hexPreview": data[:64].hex()}

    stripped = text.lstrip()
    if stripped.startswith("<svg"):
        return {
            "kind": "image/svg+xml",
            "preview": text_preview(text, preview_chars),
        }
    if stripped.startswith("data:"):
        header = stripped.split(",", 1)[0]
        return {
            "kind": "data-url",
            "preview": text_preview(header, preview_chars),
        }
    if is_mostly_printable(text):
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            return {"kind": "text/plain", "preview": text_preview(text, preview_chars)}
        return {
            "kind": "json",
            "preview": text_preview(
                json.dumps(parsed, ensure_ascii=False, indent=2), preview_chars
            ),
        }

    return {"kind": "binary", "hexPreview": data[:64].hex()}


def summarize_payload(cid: str, data: bytes, preview_chars: int) -> Dict[str, Any]:
    detected = detect_payload(data, preview_chars)
    return {
        "cid": cid,
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        **detected,
    }


def print_payload_summary(summary: Dict[str, Any]) -> None:
    print(f"CID: {summary['cid']}")
    print(f"Bytes: {summary['bytes']}")
    print(f"Kind: {summary['kind']}")
    print(f"SHA-256: {summary['sha256']}")
    if "preview" in summary:
        print("\nPreview:")
        print(summary["preview"])
    else:
        print(f"Hex preview: {summary.get('hexPreview', '')}")


def shorten(value: Any, width: int) -> str:
    text = trim_text(value) or str(value or "")
    if len(text) <= width:
        return text
    return text[: max(0, width - 3)] + "..."


def make_client(args: argparse.Namespace) -> Tuple[RpcClient, Dict[str, Any]]:
    user_data_dir = (
        Path(args.user_data_dir).expanduser()
        if trim_text(args.user_data_dir)
        else resolve_default_user_data_dir()
    )
    settings_path = resolve_settings_path(args, user_data_dir)
    settings = read_json(settings_path, {})
    if not isinstance(settings, dict):
        settings = {}

    rpc_url = resolve_rpc_url(args, settings)
    rpc_key, key_source = resolve_rpc_key(args, settings, user_data_dir)
    client = RpcClient(rpc_url, rpc_key, timeout=args.timeout)
    context = {
        "userDataDir": str(user_data_dir),
        "settingsPath": str(settings_path),
        "rpcUrl": rpc_url,
        "hasRpcKey": bool(rpc_key),
        "rpcKeySource": key_source,
    }
    return client, context


def get_ipfs_repo_path(user_data_dir: Path) -> Path:
    return user_data_dir / "node" / "datadir" / "ipfs"


def dir_size_bytes(path: Path) -> int:
    total = 0
    if not path.exists():
        return total
    for root, _, files in os.walk(path):
        root_path = Path(root)
        for name in files:
            try:
                total += (root_path / name).stat().st_size
            except OSError:
                continue
    return total


def format_bytes(value: int) -> str:
    size = float(value)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if size < 1024 or unit == "TB":
            return f"{size:.1f} {unit}" if unit != "B" else f"{int(size)} B"
        size /= 1024
    return f"{value} B"


def lsof_lock_holders(lock_path: Path) -> List[Dict[str, Any]]:
    if not lock_path.exists() or not shutil.which("lsof"):
        return []
    try:
        completed = subprocess.run(
            ["lsof", "-nP", str(lock_path)],
            check=False,
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.TimeoutExpired):
        return []
    if completed.returncode != 0:
        return []

    holders: List[Dict[str, Any]] = []
    for line in completed.stdout.splitlines()[1:]:
        parts = line.split()
        if len(parts) >= 2:
            holders.append({"command": parts[0], "pid": parts[1]})
    return holders


def load_ipfs_config(repo_path: Path) -> Dict[str, Any]:
    config_path = repo_path / "config"
    payload = read_json(config_path, {})
    return payload if isinstance(payload, dict) else {}


def repo_summary(user_data_dir: Path) -> Dict[str, Any]:
    repo_path = get_ipfs_repo_path(user_data_dir)
    config = load_ipfs_config(repo_path)
    lock_path = repo_path / "repo.lock"
    datastore = config.get("Datastore") if isinstance(config, dict) else {}
    addresses = config.get("Addresses") if isinstance(config, dict) else {}

    return {
        "path": str(repo_path),
        "exists": repo_path.exists(),
        "sizeBytes": dir_size_bytes(repo_path),
        "lockPath": str(lock_path),
        "lockExists": lock_path.exists(),
        "lockHolders": lsof_lock_holders(lock_path),
        "datastoreType": (
            (((datastore or {}).get("Spec") or {}).get("child") or {}).get("type")
            if isinstance(datastore, dict)
            else None
        ),
        "swarmAddresses": (addresses or {}).get("Swarm") if isinstance(addresses, dict) else None,
        "configuredApiAddress": (addresses or {}).get("API") if isinstance(addresses, dict) else None,
        "configuredGatewayAddress": (
            (addresses or {}).get("Gateway") if isinstance(addresses, dict) else None
        ),
        "ipfsCli": shutil.which("ipfs") or "",
    }


def print_repo_summary(summary: Dict[str, Any]) -> None:
    print(f"Local IPFS repo: {summary['path']}")
    print(f"Exists: {'yes' if summary['exists'] else 'no'}")
    print(f"Size: {format_bytes(int(summary.get('sizeBytes') or 0))}")
    print(f"Datastore: {summary.get('datastoreType') or 'unknown'}")
    holders = summary.get("lockHolders") or []
    if holders:
        holder_text = ", ".join(
            f"{item.get('command')} pid {item.get('pid')}" for item in holders
        )
        print(f"Repo lock: held by {holder_text}")
    else:
        print(f"Repo lock: {'present' if summary.get('lockExists') else 'not present'}")
    print(f"Configured API address: {summary.get('configuredApiAddress') or '-'}")
    print(f"Configured gateway address: {summary.get('configuredGatewayAddress') or '-'}")
    print(f"IPFS CLI: {summary.get('ipfsCli') or 'not found'}")


def command_repo(args: argparse.Namespace) -> int:
    user_data_dir = (
        Path(args.user_data_dir).expanduser()
        if trim_text(args.user_data_dir)
        else resolve_default_user_data_dir()
    )
    summary = repo_summary(user_data_dir)

    if args.json:
        print(json.dumps(summary, indent=2, ensure_ascii=False))
        return 0

    print_repo_summary(summary)
    if not args.with_cli:
        print(
            "\nThis shows the embedded repo. To list raw local IPFS refs, install "
            "the IPFS CLI and run this command with --with-cli while the Idena "
            "node is stopped."
        )
        return 0

    ipfs_cli = summary.get("ipfsCli")
    if not ipfs_cli:
        raise RuntimeError("ipfs CLI was not found in PATH")
    if summary.get("lockHolders"):
        raise RuntimeError(
            "the IPFS repo is locked by the running Idena node; stop the node "
            "before listing raw repo refs with the IPFS CLI"
        )

    env = {**os.environ, "IPFS_PATH": summary["path"]}
    command = [ipfs_cli, "refs", "local"]
    completed = subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
        timeout=args.timeout,
        env=env,
    )
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or "ipfs refs local failed")

    refs = [line.strip() for line in completed.stdout.splitlines() if line.strip()]
    print(f"\nRaw local refs ({len(refs)} total):")
    for ref in refs[: args.limit]:
        print(ref)
    if len(refs) > args.limit:
        print(f"... {len(refs) - args.limit} more")
    return 0


def command_status(args: argparse.Namespace) -> int:
    client, context = make_client(args)
    result: Dict[str, Any] = {"connection": context, "rpc": {}}
    for method in ("bcn_syncing", "bcn_lastBlock", "net_ipfsAddress"):
        try:
            result["rpc"][method] = client.call(method, [])
        except Exception as exc:  # noqa: BLE001 - CLI should report all RPC failures.
            result["rpc"][method] = {"error": str(exc)}

    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0

    print(f"RPC URL: {context['rpcUrl']}")
    print(f"Settings: {context['settingsPath']}")
    print(f"API key loaded: {'yes' if context['hasRpcKey'] else 'no'}")
    if result["rpc"].get("net_ipfsAddress"):
        print(f"IPFS address: {result['rpc']['net_ipfsAddress']}")
    last_block = result["rpc"].get("bcn_lastBlock")
    if isinstance(last_block, dict):
        print(f"Last block: {last_block.get('height') or last_block.get('Height')}")
    syncing = result["rpc"].get("bcn_syncing")
    print(f"Syncing: {syncing}")
    return 0


def command_read(args: argparse.Namespace) -> int:
    client, _ = make_client(args)
    cid = clean_cid(args.cid)
    if not cid:
        raise RuntimeError("CID is empty")

    data = decode_rpc_hex(client.call("ipfs_get", [cid]))
    if args.out:
        output_path = Path(args.out).expanduser()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(data)

    if args.raw:
        sys.stdout.buffer.write(data)
        return 0

    summary = summarize_payload(cid, data, args.preview_chars)
    if args.out:
        summary["writtenTo"] = str(Path(args.out).expanduser())

    if args.json:
        print(json.dumps(summary, indent=2, ensure_ascii=False))
    else:
        print_payload_summary(summary)
        if args.out:
            print(f"\nWritten to: {summary['writtenTo']}")
    return 0


def command_check(args: argparse.Namespace) -> int:
    client, _ = make_client(args)
    rows = []
    exit_code = 0
    for raw_cid in args.cids:
        cid = clean_cid(raw_cid)
        try:
            data = decode_rpc_hex(client.call("ipfs_get", [cid]))
            summary = summarize_payload(cid, data, args.preview_chars)
            rows.append({"ok": True, **summary})
        except Exception as exc:  # noqa: BLE001 - keep checking remaining CIDs.
            exit_code = 1
            rows.append({"ok": False, "cid": cid, "error": str(exc)})

    if args.json:
        print(json.dumps(rows, indent=2, ensure_ascii=False))
        return exit_code

    print(f"{'OK':<3} {'BYTES':>10} {'KIND':<15} {'CID':<48} DETAILS")
    for row in rows:
        if row["ok"]:
            detail = row.get("preview") or row.get("hexPreview") or row.get("sha256")
            print(
                f"{'yes':<3} {row['bytes']:>10} {row['kind']:<15} "
                f"{shorten(row['cid'], 48):<48} {shorten(detail, 80)}"
            )
        else:
            print(
                f"{'no':<3} {'-':>10} {'-':<15} "
                f"{shorten(row['cid'], 48):<48} {shorten(row['error'], 80)}"
            )
    return exit_code


def get_block_height(block: Any) -> Optional[int]:
    if not isinstance(block, dict):
        return None
    for key in ("height", "Height"):
        value = block.get(key)
        if isinstance(value, int):
            return value
        if isinstance(value, str) and value.isdigit():
            return int(value)
    return None


def iter_store_to_ipfs_rows(
    client: RpcClient,
    start_height: int,
    end_height: int,
    from_address: str = "",
) -> Iterable[Dict[str, Any]]:
    normalized_from = from_address.lower()
    for height in range(end_height, start_height - 1, -1):
        block = client.call("bcn_blockAt", [height])
        if not isinstance(block, dict):
            continue

        timestamp = block.get("timestamp")
        for tx_hash in block.get("transactions") or []:
            tx = client.call("bcn_transaction", [tx_hash])
            if not isinstance(tx, dict) or tx.get("type") != "storeToIpfs":
                continue
            if normalized_from and trim_text(tx.get("from")).lower() != normalized_from:
                continue

            parsed = parse_store_to_ipfs_payload(tx.get("payload", ""))
            yield {
                "height": height,
                "timestamp": tx.get("timestamp", timestamp),
                "txHash": tx.get("hash") or tx_hash,
                "from": tx.get("from"),
                "epoch": tx.get("epoch"),
                **parsed,
            }


def command_scan(args: argparse.Namespace) -> int:
    client, _ = make_client(args)
    last_block = client.call("bcn_lastBlock", [])
    latest_height = get_block_height(last_block)
    if latest_height is None:
        raise RuntimeError("Cannot resolve latest block height from bcn_lastBlock")

    end_height = args.to if args.to is not None else latest_height
    if args.from_height is not None:
        start_height = args.from_height
    else:
        start_height = max(0, end_height - max(1, args.blocks) + 1)
    if start_height > end_height:
        raise RuntimeError("--from cannot be greater than --to")

    rows = list(
        iter_store_to_ipfs_rows(
            client,
            start_height=start_height,
            end_height=end_height,
            from_address=trim_text(args.from_address),
        )
    )

    if args.fetch:
        for row in rows:
            cid = row.get("cid")
            if not cid:
                continue
            try:
                data = decode_rpc_hex(client.call("ipfs_get", [cid]))
                row["fetch"] = summarize_payload(cid, data, args.preview_chars)
            except Exception as exc:  # noqa: BLE001 - keep scanning rows.
                row["fetchError"] = str(exc)

    output = {
        "latestHeight": latest_height,
        "fromHeight": start_height,
        "toHeight": end_height,
        "count": len(rows),
        "rows": rows,
    }

    if args.json:
        print(json.dumps(output, indent=2, ensure_ascii=False))
        return 0

    print(
        f"Scanned blocks {start_height}..{end_height}. "
        f"Found {len(rows)} storeToIpfs transaction(s)."
    )
    if not rows:
        return 0

    print(
        f"{'HEIGHT':>8} {'DECLARED':>10} {'FETCHED':>10} "
        f"{'KIND':<14} {'CID':<48} TX"
    )
    for row in rows:
        fetched = "-"
        kind = "-"
        if isinstance(row.get("fetch"), dict):
            fetched = str(row["fetch"]["bytes"])
            kind = row["fetch"]["kind"]
        elif row.get("fetchError"):
            fetched = "error"
        print(
            f"{row['height']:>8} {str(row.get('declaredBytes') or '-'):>10} "
            f"{fetched:>10} {kind:<14} {shorten(row.get('cid'), 48):<48} "
            f"{shorten(row.get('txHash'), 24)}"
        )
    return 0


def command_own(args: argparse.Namespace) -> int:
    client, context = make_client(args)
    user_data_dir = Path(context["userDataDir"])
    repo = repo_summary(user_data_dir)

    coinbase = ""
    try:
        coinbase = trim_text(client.call("dna_getCoinbaseAddr", []))
    except Exception:
        coinbase = ""

    from_address = trim_text(args.from_address)
    if args.mine:
        if not coinbase:
            raise RuntimeError("cannot resolve your coinbase address for --mine")
        from_address = coinbase

    last_block = client.call("bcn_lastBlock", [])
    latest_height = get_block_height(last_block)
    if latest_height is None:
        raise RuntimeError("Cannot resolve latest block height from bcn_lastBlock")

    end_height = args.to if args.to is not None else latest_height
    if args.from_height is not None:
        start_height = args.from_height
    else:
        start_height = max(0, end_height - max(1, args.blocks) + 1)

    rows = list(
        iter_store_to_ipfs_rows(
            client,
            start_height=start_height,
            end_height=end_height,
            from_address=from_address,
        )
    )
    for row in rows:
        cid = row.get("cid")
        if not cid:
            continue
        try:
            data = decode_rpc_hex(client.call("ipfs_get", [cid]))
            row["local"] = True
            row["fetch"] = summarize_payload(cid, data, args.preview_chars)
        except Exception as exc:  # noqa: BLE001 - preserve per-CID status.
            row["local"] = False
            row["fetchError"] = str(exc)

    output = {
        "repo": repo,
        "rpcUrl": context["rpcUrl"],
        "coinbase": coinbase,
        "fromAddressFilter": from_address,
        "latestHeight": latest_height,
        "fromHeight": start_height,
        "toHeight": end_height,
        "count": len(rows),
        "localCount": sum(1 for row in rows if row.get("local")),
        "rows": rows,
    }

    if args.json:
        print(json.dumps(output, indent=2, ensure_ascii=False))
        return 0

    print_repo_summary(repo)
    if coinbase:
        print(f"Coinbase address: {coinbase}")
    if from_address:
        print(f"Address filter: {from_address}")
    print(
        f"\nScanned blocks {start_height}..{end_height}. "
        f"Found {len(rows)} storeToIpfs CID(s); "
        f"{output['localCount']} are readable through your own node now."
    )
    if not rows:
        return 0

    print(
        f"{'LOCAL':<5} {'HEIGHT':>8} {'BYTES':>10} {'KIND':<14} "
        f"{'CID':<48} PREVIEW/ERROR"
    )
    for row in rows:
        if row.get("local") and isinstance(row.get("fetch"), dict):
            fetch = row["fetch"]
            detail = fetch.get("preview") or fetch.get("hexPreview") or ""
            print(
                f"{'yes':<5} {row['height']:>8} {fetch['bytes']:>10} "
                f"{fetch['kind']:<14} {shorten(row.get('cid'), 48):<48} "
                f"{shorten(detail, 80)}"
            )
        else:
            print(
                f"{'no':<5} {row['height']:>8} "
                f"{str(row.get('declaredBytes') or '-'):>10} {'-':<14} "
                f"{shorten(row.get('cid'), 48):<48} "
                f"{shorten(row.get('fetchError'), 80)}"
            )
    return 0


def load_repo_report_cids(path: Path) -> Dict[str, Dict[str, Any]]:
    payload = read_json(path, {})
    if not isinstance(payload, dict):
        raise RuntimeError(f"Repo report is not an object: {path}")

    result: Dict[str, Dict[str, Any]] = {}
    for section in ("pins", "blockSamples"):
        values = payload.get(section)
        if not isinstance(values, list):
            continue
        for item in values:
            if not isinstance(item, dict):
                continue
            cid = clean_cid(trim_text(item.get("cid") or item.get("CID")))
            if cid:
                result[cid] = item
    return result


def command_authors(args: argparse.Namespace) -> int:
    report_path = Path(args.repo_report).expanduser()
    local_cids = load_repo_report_cids(report_path)
    if not local_cids:
        raise RuntimeError(
            "no CIDs found in repo report; run ipfsrepoinspect with a large enough --limit"
        )

    client, _ = make_client(args)
    last_block = client.call("bcn_lastBlock", [])
    latest_height = get_block_height(last_block)
    if latest_height is None:
        raise RuntimeError("Cannot resolve latest block height from bcn_lastBlock")

    end_height = args.to if args.to is not None else latest_height
    if args.from_height is not None:
        start_height = args.from_height
    else:
        start_height = max(0, end_height - max(1, args.blocks) + 1)

    matches = []
    for row in iter_store_to_ipfs_rows(
        client,
        start_height=start_height,
        end_height=end_height,
        from_address=trim_text(args.from_address),
    ):
        cid = row.get("cid")
        if args.all_store_to_ipfs or cid in local_cids:
            matches.append(
                {
                    **row,
                    "localPinned": cid in local_cids,
                    "local": local_cids.get(cid, {}),
                }
            )

    output = {
        "repoReport": str(report_path),
        "localCidCount": len(local_cids),
        "latestHeight": latest_height,
        "fromHeight": start_height,
        "toHeight": end_height,
        "matchCount": len(matches),
        "matches": matches,
    }

    if args.json:
        print(json.dumps(output, indent=2, ensure_ascii=False))
        return 0

    print(
        f"Scanned blocks {start_height}..{end_height}. "
        f"Matched {len(matches)} storeToIpfs transaction(s) against "
        f"{len(local_cids)} local CID(s)."
    )
    if not matches:
        return 0

    print(f"{'HEIGHT':>8} {'LOCAL':<5} {'FROM':<44} {'CID':<48} TX")
    for row in matches:
        print(
            f"{row['height']:>8} "
            f"{'yes' if row.get('localPinned') else 'no':<5} "
            f"{shorten(row.get('from'), 44):<44} "
            f"{shorten(row.get('cid'), 48):<48} "
            f"{shorten(row.get('txHash'), 24)}"
        )
    return 0


def add_common_rpc_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--user-data-dir",
        default="",
        help="IdenaAI user data directory. Defaults to the normal app data path.",
    )
    parser.add_argument("--settings-path", default="", help="Optional settings.json path.")
    parser.add_argument("--rpc-url", default="", help="Override node RPC URL.")
    parser.add_argument("--rpc-key", default="", help="Override node RPC API key.")
    parser.add_argument("--timeout", type=int, default=30, help="RPC timeout in seconds.")
    parser.add_argument("--json", action="store_true", help="Print JSON output.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Inspect data stored in the Idena node IPFS path. "
            "Reads known CIDs with ipfs_get and can scan recent blocks for "
            "storeToIpfs CID references."
        )
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    status_parser = subparsers.add_parser("status", help="Show RPC/IPFS status.")
    add_common_rpc_args(status_parser)
    status_parser.set_defaults(func=command_status)

    repo_parser = subparsers.add_parser(
        "repo", help="Show the local embedded IPFS repo path, size, and lock state."
    )
    repo_parser.add_argument(
        "--user-data-dir",
        default="",
        help="IdenaAI user data directory. Defaults to the normal app data path.",
    )
    repo_parser.add_argument("--json", action="store_true", help="Print JSON output.")
    repo_parser.add_argument(
        "--with-cli",
        action="store_true",
        help="Use the ipfs CLI to list raw local refs. Requires stopped node.",
    )
    repo_parser.add_argument(
        "--limit", type=int, default=100, help="Maximum raw refs to print with --with-cli."
    )
    repo_parser.add_argument(
        "--timeout", type=int, default=60, help="IPFS CLI timeout in seconds."
    )
    repo_parser.set_defaults(func=command_repo)

    read_parser = subparsers.add_parser("read", help="Read and preview one CID.")
    add_common_rpc_args(read_parser)
    read_parser.add_argument("cid", help="CID, ipfs://CID, /ipfs/CID, or _flip_CID.")
    read_parser.add_argument("--out", default="", help="Write raw bytes to this file.")
    read_parser.add_argument(
        "--raw", action="store_true", help="Write raw bytes to stdout."
    )
    read_parser.add_argument(
        "--preview-chars", type=int, default=1200, help="Text preview length."
    )
    read_parser.set_defaults(func=command_read)

    check_parser = subparsers.add_parser("check", help="Check one or more CIDs.")
    add_common_rpc_args(check_parser)
    check_parser.add_argument("cids", nargs="+", help="CID(s) to fetch.")
    check_parser.add_argument(
        "--preview-chars", type=int, default=160, help="Text preview length."
    )
    check_parser.set_defaults(func=command_check)

    scan_parser = subparsers.add_parser(
        "scan",
        help="Scan recent blocks for storeToIpfs transactions and their CIDs.",
    )
    add_common_rpc_args(scan_parser)
    scan_parser.add_argument(
        "--blocks",
        type=int,
        default=100,
        help="Number of latest blocks to scan when --from is omitted.",
    )
    scan_parser.add_argument(
        "--from",
        dest="from_height",
        type=int,
        default=None,
        help="First block height to scan.",
    )
    scan_parser.add_argument(
        "--to",
        type=int,
        default=None,
        help="Last block height to scan. Defaults to latest block.",
    )
    scan_parser.add_argument(
        "--from-address",
        default="",
        help="Only include storeToIpfs transactions sent by this address.",
    )
    scan_parser.add_argument(
        "--fetch",
        action="store_true",
        help="Also call ipfs_get for every discovered CID.",
    )
    scan_parser.add_argument(
        "--preview-chars", type=int, default=160, help="Fetched text preview length."
    )
    scan_parser.set_defaults(func=command_scan)

    own_parser = subparsers.add_parser(
        "own",
        help=(
            "Show local repo info and CIDs from recent storeToIpfs transactions "
            "that your own node can fetch now."
        ),
    )
    add_common_rpc_args(own_parser)
    own_parser.add_argument(
        "--blocks",
        type=int,
        default=500,
        help="Number of latest blocks to scan when --from is omitted.",
    )
    own_parser.add_argument(
        "--from",
        dest="from_height",
        type=int,
        default=None,
        help="First block height to scan.",
    )
    own_parser.add_argument(
        "--to",
        type=int,
        default=None,
        help="Last block height to scan. Defaults to latest block.",
    )
    own_parser.add_argument(
        "--mine",
        action="store_true",
        help="Only include CIDs from storeToIpfs transactions sent by your coinbase.",
    )
    own_parser.add_argument(
        "--from-address",
        default="",
        help="Only include CIDs from storeToIpfs transactions sent by this address.",
    )
    own_parser.add_argument(
        "--preview-chars", type=int, default=160, help="Fetched text preview length."
    )
    own_parser.set_defaults(func=command_own)

    authors_parser = subparsers.add_parser(
        "authors",
        help=(
            "Match CIDs from an offline repo report to on-chain storeToIpfs "
            "transactions and show sender addresses."
        ),
    )
    add_common_rpc_args(authors_parser)
    authors_parser.add_argument(
        "--repo-report",
        required=True,
        help="JSON report from idena-go/cmd/ipfsrepoinspect.",
    )
    authors_parser.add_argument(
        "--blocks",
        type=int,
        default=5000,
        help="Number of latest blocks to scan when --from is omitted.",
    )
    authors_parser.add_argument(
        "--from",
        dest="from_height",
        type=int,
        default=None,
        help="First block height to scan.",
    )
    authors_parser.add_argument(
        "--to",
        type=int,
        default=None,
        help="Last block height to scan. Defaults to latest block.",
    )
    authors_parser.add_argument(
        "--from-address",
        default="",
        help="Only include storeToIpfs transactions sent by this address.",
    )
    authors_parser.add_argument(
        "--all-store-to-ipfs",
        action="store_true",
        help="Show all scanned storeToIpfs transactions, not only local CID matches.",
    )
    authors_parser.set_defaults(func=command_authors)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        return args.func(args)
    except KeyboardInterrupt:
        return 130
    except Exception as exc:  # noqa: BLE001 - CLI entry point.
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
