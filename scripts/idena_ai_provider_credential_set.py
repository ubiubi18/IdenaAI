#!/usr/bin/env python3
"""Store a provider API key for the IdenaAI console from a terminal.

Run this command as root on a managed IdenaAI host. The key is read from a
hidden prompt, or from standard input when it is not a terminal, and encrypted
with the host key through systemd-creds, exactly like the credential broker.
The plaintext key never appears in a command argument, a stored file, or a log.
"""

from __future__ import annotations

import argparse
import importlib.util
import os
import subprocess
import sys
from getpass import getpass
from pathlib import Path
from types import ModuleType
from typing import IO, Callable, Iterable, NamedTuple, Sequence

DEFAULT_SERVICE = "idena-ai-console.service"
DEFAULT_CREDENTIAL_PATH = Path("/etc/credstore.encrypted/idena-ai-openai-api-key.cred")
DEFAULT_BROKER_SCRIPT = Path(
    "/usr/local/libexec/idena-ai/provider-credential-broker.py"
)
UNIT_PATTERN = "idena-ai*console.service"
PROVIDERS = ("openai", "deepseek")


class CommandError(Exception):
    """A client-safe command error."""


class InstanceStatus(NamedTuple):
    service: str
    provider: str
    credential_path: Path
    has_key: bool
    broker_installed: bool


def default_systemctl(command: Sequence[str]) -> str:
    try:
        result = subprocess.run(
            list(command),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise CommandError("systemctl is unavailable") from error
    if result.returncode != 0:
        raise CommandError("systemctl command failed")
    return result.stdout


def load_broker_module(path: Path) -> ModuleType:
    if not path.is_file():
        raise CommandError("credential broker module is missing")
    spec = importlib.util.spec_from_file_location(
        "idena_ai_provider_credential_broker", path
    )
    if spec is None or spec.loader is None:
        raise CommandError("credential broker module is invalid")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def broker_unit_for(service: str) -> str:
    return service.replace("console.service", "provider-credential-broker.service")


def parse_credential_argument(unit_text: str, fallback: Path) -> Path:
    for line in unit_text.splitlines():
        if not line.startswith("ExecStart="):
            continue
        tokens = line.split("=", 1)[1].split()
        for index, token in enumerate(tokens):
            value = ""
            if token == "--credential" and index + 1 < len(tokens):
                value = tokens[index + 1]
            elif token.startswith("--credential="):
                value = token.split("=", 1)[1]
            if value.startswith("/"):
                return Path(value)
    return fallback


def read_broker_credential_path(
    systemctl: Callable[[Sequence[str]], str], broker_unit: str
) -> tuple[Path, bool]:
    try:
        unit_text = systemctl(["systemctl", "cat", broker_unit])
    except CommandError:
        return DEFAULT_CREDENTIAL_PATH, False
    return parse_credential_argument(unit_text, DEFAULT_CREDENTIAL_PATH), True


def discover_services(systemctl: Callable[[Sequence[str]], str]) -> list[str]:
    services: set[str] = set()
    try:
        output = systemctl(
            ["systemctl", "list-unit-files", UNIT_PATTERN, "--no-legend", "--plain"]
        )
    except CommandError:
        output = ""
    for line in output.splitlines():
        name = line.split()[0] if line.split() else ""
        if name.startswith("idena-ai") and name.endswith("console.service"):
            services.add(name)
    if not services:
        services.update(
            path.name for path in Path("/etc/systemd/system").glob(UNIT_PATTERN)
        )
    return sorted(services)


def provider_credential_path(broker: ModuleType, base_path: Path, provider: str) -> Path:
    if provider == "deepseek":
        derive_path = getattr(broker, "derive_deepseek_credential_path", None)
        if derive_path is None:
            raise CommandError(
                "the installed credential broker does not support this provider"
            )
        return derive_path(base_path)
    return base_path


def provider_credential_name(broker: ModuleType, provider: str) -> str:
    if provider == "deepseek":
        name = getattr(broker, "DEEPSEEK_CREDENTIAL_NAME", "")
        if not name:
            raise CommandError(
                "the installed credential broker does not support this provider"
            )
        return name
    return broker.CREDENTIAL_NAME


def format_listing(entries: Iterable[InstanceStatus]) -> str:
    rows = list(entries)
    if not rows:
        return "No IdenaAI console instance was found on this host."
    width = max(len(row.service) for row in rows)
    lines = []
    for row in rows:
        state = "stored" if row.has_key else "empty"
        note = "" if row.broker_installed else "  (broker unit not installed)"
        lines.append(
            f"{row.service.ljust(width)}  {row.provider:<8} {state}  "
            f"{row.credential_path}{note}"
        )
    return "\n".join(lines)


def read_credential(stream: IO[str], *, interactive: bool) -> str:
    if interactive:
        return getpass("Provider API key (input hidden): ").strip()
    return stream.readline().strip()


def list_instances(
    broker: ModuleType, systemctl: Callable[[Sequence[str]], str]
) -> list[InstanceStatus]:
    entries: list[InstanceStatus] = []
    for service in discover_services(systemctl):
        base_path, broker_installed = read_broker_credential_path(
            systemctl, broker_unit_for(service)
        )
        for provider in PROVIDERS:
            credential_path = provider_credential_path(broker, base_path, provider)
            entries.append(
                InstanceStatus(
                    service=service,
                    provider=provider,
                    credential_path=credential_path,
                    has_key=credential_path.is_file(),
                    broker_installed=broker_installed,
                )
            )
    return entries


def parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Store an encrypted provider API key for an IdenaAI console."
    )
    parser.add_argument(
        "--service",
        default=os.environ.get("IDENA_AI_CONSOLE_SERVICE", DEFAULT_SERVICE),
        help="console unit that should use the key",
    )
    parser.add_argument("--provider", choices=PROVIDERS, default="openai")
    parser.add_argument(
        "--credential",
        default="",
        help="override the encrypted credential path of the console instance",
    )
    parser.add_argument(
        "--broker-script",
        default=os.environ.get("IDENA_AI_BROKER_SCRIPT", str(DEFAULT_BROKER_SCRIPT)),
        help="installed credential broker module",
    )
    parser.add_argument(
        "--list",
        action="store_true",
        dest="list_instances",
        help="show the console instances and whether a key is stored",
    )
    parser.add_argument("--clear", action="store_true", help="remove the stored key")
    parser.add_argument(
        "--restart", action="store_true", help="restart the console after storing"
    )
    parser.add_argument(
        "--stdin",
        action="store_true",
        dest="read_stdin",
        help="read the key from standard input instead of a hidden prompt",
    )
    return parser.parse_args(argv)


def main(
    argv: Sequence[str] | None = None,
    *,
    systemctl: Callable[[Sequence[str]], str] = default_systemctl,
    stream: IO[str] | None = None,
) -> int:
    args = parse_args(argv)

    if os.geteuid() != 0:
        print("run this command as root", file=sys.stderr)
        return 2

    try:
        broker = load_broker_module(Path(args.broker_script))
    except CommandError as error:
        print(f"Credential command failed: {error}", file=sys.stderr)
        return 1

    if args.list_instances:
        print(format_listing(list_instances(broker, systemctl)))
        return 0

    try:
        base_path = (
            Path(args.credential)
            if args.credential
            else read_broker_credential_path(systemctl, broker_unit_for(args.service))[0]
        )
        credential_path = provider_credential_path(broker, base_path, args.provider)
        credential_name = provider_credential_name(broker, args.provider)
    except CommandError as error:
        print(f"Credential command failed: {error}", file=sys.stderr)
        return 1

    vault = broker.CredentialVault(
        credential_path,
        broker.default_run_command,
        credential_name=credential_name,
    )

    if args.clear:
        vault.clear()
        print(f"Removed the stored {args.provider} credential for {args.service}")
        print(f"  {credential_path}")
        return 0

    input_stream = stream if stream is not None else sys.stdin
    interactive = stream is None and not args.read_stdin and sys.stdin.isatty()
    credential = read_credential(input_stream, interactive=interactive)

    try:
        vault.store(credential.encode("utf-8"))
    except broker.BrokerError as error:
        print(f"The {args.provider} key was not stored: {error}", file=sys.stderr)
        return 1

    print(f"Stored the encrypted {args.provider} credential for {args.service}")
    print(f"  {credential_path}")

    if args.restart:
        try:
            systemctl(["systemctl", "restart", args.service])
        except CommandError:
            print(
                f"Restart {args.service} manually to load the key.",
                file=sys.stderr,
            )
            return 1
        print(f"Restarted {args.service}.")
    else:
        print(f"Restart {args.service} to load the key.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
