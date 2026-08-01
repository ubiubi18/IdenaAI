#!/usr/bin/env python3
"""Host-bound credential broker for the unattended IdenaAI console.

The broker accepts requests only from the configured service user and cgroup.
Plaintext credentials exist only in process memory and the local Unix socket.
At rest, systemd-creds encrypts them with the Hetzner host key.
"""

from __future__ import annotations

import argparse
import hmac
import json
import os
import pwd
import signal
import socket
import socketserver
import struct
import subprocess
import sys
import tempfile
import threading
from pathlib import Path
from typing import Any, Callable

MAX_REQUEST_BYTES = 16 * 1024
MIN_CREDENTIAL_BYTES = 16
MAX_CREDENTIAL_BYTES = 4096
PROTOCOL_VERSION = 1
SUPPORTED_PROVIDER = "openai"
CREDENTIAL_NAME = "idena-ai-openai-api-key"


class BrokerError(Exception):
    """A client-safe credential broker error."""


def validate_credential(value: Any) -> bytes:
    if not isinstance(value, str):
        raise BrokerError("credential is missing")

    credential = value.strip()
    encoded = credential.encode("utf-8")
    if not MIN_CREDENTIAL_BYTES <= len(encoded) <= MAX_CREDENTIAL_BYTES:
        raise BrokerError("credential has an invalid format")
    if credential != value or any(byte <= 0x20 or byte == 0x7F for byte in encoded):
        raise BrokerError("credential has an invalid format")
    return encoded


def read_peer_cgroup(pid: int) -> str:
    try:
        return Path(f"/proc/{pid}/cgroup").read_text(encoding="utf-8")
    except (OSError, ValueError) as error:
        raise BrokerError("unable to verify caller service") from error


def peer_credentials(sock: socket.socket) -> tuple[int, int, int]:
    if not hasattr(socket, "SO_PEERCRED"):
        raise BrokerError("peer credential checks are unavailable")
    raw = sock.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i"))
    return struct.unpack("3i", raw)


def default_run_command(
    command: list[str], *, input_bytes: bytes | None = None
) -> bytes:
    try:
        result = subprocess.run(
            command,
            input=input_bytes,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
            timeout=15,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise BrokerError("host credential operation failed") from error
    return result.stdout


class CredentialVault:
    def __init__(
        self,
        credential_path: Path,
        run_command: Callable[..., bytes] = default_run_command,
    ) -> None:
        self.credential_path = credential_path
        self.run_command = run_command
        self._lock = threading.Lock()

    def has_key(self) -> bool:
        with self._lock:
            return self.credential_path.is_file()

    def _decrypt_path(self, source_path: Path) -> bytes:
        plaintext = self.run_command(
            [
                "/usr/bin/systemd-creds",
                "decrypt",
                f"--name={CREDENTIAL_NAME}",
                str(source_path),
                "-",
            ]
        ).strip()
        return validate_credential(plaintext.decode("utf-8"))

    def load(self) -> bytes | None:
        with self._lock:
            if not self.credential_path.is_file():
                return None
            return self._decrypt_path(self.credential_path)

    def store(self, credential: bytes) -> None:
        validated = validate_credential(credential.decode("utf-8"))
        self.credential_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(self.credential_path.parent, 0o700)

        with self._lock:
            temporary_path: Path | None = None
            try:
                descriptor, temporary_name = tempfile.mkstemp(
                    prefix=f".{self.credential_path.name}.",
                    dir=self.credential_path.parent,
                )
                os.close(descriptor)
                temporary_path = Path(temporary_name)
                temporary_path.unlink()
                self.run_command(
                    [
                        "/usr/bin/systemd-creds",
                        "encrypt",
                        "--with-key=host",
                        f"--name={CREDENTIAL_NAME}",
                        "-",
                        str(temporary_path),
                    ],
                    input_bytes=validated,
                )
                os.chmod(temporary_path, 0o600)
                round_trip = self._decrypt_path(temporary_path)
                if not hmac.compare_digest(round_trip, validated):
                    raise BrokerError("host credential verification failed")
                os.replace(temporary_path, self.credential_path)
                temporary_path = None
            finally:
                if temporary_path is not None:
                    temporary_path.unlink(missing_ok=True)

    def clear(self) -> None:
        with self._lock:
            self.credential_path.unlink(missing_ok=True)


class CredentialRequestHandler(socketserver.StreamRequestHandler):
    server: "CredentialBrokerServer"

    def setup(self) -> None:
        super().setup()
        self.connection.settimeout(3.0)

    def _reply(self, payload: dict[str, Any]) -> None:
        self.wfile.write(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
        self.wfile.flush()

    def _authorize(self) -> None:
        pid, uid, _gid = peer_credentials(self.connection)
        if uid != self.server.allowed_uid:
            raise BrokerError("caller is not authorized")
        if self.server.allowed_cgroup:
            cgroup = read_peer_cgroup(pid)
            if self.server.allowed_cgroup not in cgroup:
                raise BrokerError("caller service is not authorized")

    def _read_request(self) -> dict[str, Any]:
        line = self.rfile.readline(MAX_REQUEST_BYTES + 1)
        if not line or len(line) > MAX_REQUEST_BYTES or not line.endswith(b"\n"):
            raise BrokerError("request is invalid")
        if self.rfile.read(1):
            raise BrokerError("request contains trailing data")
        try:
            payload = json.loads(line)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise BrokerError("request is invalid") from error
        if not isinstance(payload, dict):
            raise BrokerError("request is invalid")
        return payload

    def handle(self) -> None:
        operation = "unknown"
        try:
            self._authorize()
            payload = self._read_request()
            if payload.get("version") != PROTOCOL_VERSION:
                raise BrokerError("protocol version is unsupported")
            if payload.get("provider") != SUPPORTED_PROVIDER:
                raise BrokerError("provider is unsupported")

            operation = str(payload.get("operation") or "")
            if operation == "status":
                self._reply({"ok": True, "hasKey": self.server.vault.has_key()})
                return
            if operation == "load":
                credential = self.server.vault.load()
                response: dict[str, Any] = {
                    "ok": True,
                    "hasKey": credential is not None,
                }
                if credential is not None:
                    response["credential"] = credential.decode("utf-8")
                self._reply(response)
                return
            if operation == "store":
                credential = validate_credential(payload.get("credential"))
                self.server.vault.store(credential)
                self._reply({"ok": True, "hasKey": True})
                return
            if operation == "clear":
                self.server.vault.clear()
                self._reply({"ok": True, "hasKey": False})
                return
            raise BrokerError("operation is unsupported")
        except BrokerError as error:
            self._reply({"ok": False, "error": str(error)})
            print(
                f"credential broker rejected operation={operation}",
                file=sys.stderr,
                flush=True,
            )
        except Exception:
            self._reply({"ok": False, "error": "credential broker failed closed"})
            print(
                f"credential broker failed operation={operation}",
                file=sys.stderr,
                flush=True,
            )


class CredentialBrokerServer(socketserver.UnixStreamServer):
    allow_reuse_address = False

    def __init__(
        self,
        socket_path: Path,
        *,
        vault: CredentialVault,
        allowed_uid: int,
        allowed_cgroup: str,
    ) -> None:
        self.socket_path = socket_path
        self.vault = vault
        self.allowed_uid = allowed_uid
        self.allowed_cgroup = allowed_cgroup
        socket_path.unlink(missing_ok=True)
        super().__init__(str(socket_path), CredentialRequestHandler)

    def server_close(self) -> None:
        super().server_close()
        self.socket_path.unlink(missing_ok=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--socket",
        default=os.environ.get(
            "IDENA_AI_CREDENTIAL_SOCKET",
            "/run/idena-ai/provider-credentials.sock",
        ),
    )
    parser.add_argument(
        "--credential",
        default=os.environ.get(
            "IDENA_AI_OPENAI_CREDENTIAL",
            "/etc/credstore.encrypted/idena-ai-openai-api-key.cred",
        ),
    )
    parser.add_argument(
        "--user",
        default=os.environ.get("IDENA_AI_CREDENTIAL_USER", "pohw"),
    )
    parser.add_argument(
        "--allowed-cgroup",
        default=os.environ.get(
            "IDENA_AI_CREDENTIAL_ALLOWED_CGROUP",
            "/system.slice/idena-ai-console.service",
        ),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if os.geteuid() != 0:
        print("credential broker must run as root", file=sys.stderr)
        return 2

    try:
        user = pwd.getpwnam(args.user)
    except KeyError:
        print("credential broker user does not exist", file=sys.stderr)
        return 2

    socket_path = Path(args.socket)
    credential_path = Path(args.credential)
    if not socket_path.is_absolute() or not credential_path.is_absolute():
        print("credential broker paths must be absolute", file=sys.stderr)
        return 2

    socket_path.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
    os.chmod(socket_path.parent, 0o755)
    vault = CredentialVault(credential_path)
    server = CredentialBrokerServer(
        socket_path,
        vault=vault,
        allowed_uid=user.pw_uid,
        allowed_cgroup=str(args.allowed_cgroup or ""),
    )
    os.chmod(socket_path, 0o600)
    os.chown(socket_path, user.pw_uid, user.pw_gid)

    def stop_server(_signum: int, _frame: Any) -> None:
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, stop_server)
    signal.signal(signal.SIGINT, stop_server)

    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
