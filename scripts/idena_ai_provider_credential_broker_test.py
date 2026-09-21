import importlib.util
import io
import json
import os
import stat
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


MODULE_PATH = Path(__file__).with_name("idena_ai_provider_credential_broker.py")
SPEC = importlib.util.spec_from_file_location("credential_broker", MODULE_PATH)
assert SPEC and SPEC.loader
BROKER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BROKER)


class FakeSystemdCreds:
    def __call__(self, command, *, input_bytes=None):
        operation = command[1]
        if operation == "encrypt":
            output_path = Path(command[-1])
            output_path.write_bytes(b"encrypted:" + input_bytes)
            return b""
        if operation == "decrypt":
            source_path = Path(command[-2])
            return source_path.read_bytes().removeprefix(b"encrypted:")
        raise AssertionError(f"unexpected command: {command}")


class CredentialVaultTests(unittest.TestCase):
    def test_provider_credentials_are_isolated_and_caller_checks_still_apply(self):
        with tempfile.TemporaryDirectory() as directory:
            vaults = {
                provider: BROKER.CredentialVault(
                    Path(directory) / f"{provider}.cred", FakeSystemdCreds(),
                    credential_name=f"idena-ai-{provider}-api-key",
                )
                for provider in ("openai", "deepseek")
            }

            def request(provider, operation, credential=None, uid=1000):
                handler = object.__new__(BROKER.CredentialRequestHandler)
                handler.server = SimpleNamespace(vaults=vaults, allowed_uid=1000, allowed_cgroup="/system.slice/test.service")
                handler.connection = None
                handler.rfile = io.BytesIO((json.dumps(dict(version=1, provider=provider, operation=operation, credential=credential)) + "\n").encode())
                handler.wfile = io.BytesIO()
                with patch.object(BROKER, "peer_credentials", return_value=(42, uid, 1000)), patch.object(BROKER, "read_peer_cgroup", return_value="0::/system.slice/test.service\n"):
                    handler.handle()
                return json.loads(handler.wfile.getvalue())

            for provider in vaults:
                self.assertEqual(request(provider, "store", f"fixture-{provider}-credential"), {"ok": True, "hasKey": True})
            self.assertEqual(request("deepseek", "load")["credential"], "fixture-deepseek-credential")
            self.assertTrue(request("deepseek", "clear")["ok"])
            self.assertFalse(request("deepseek", "status")["hasKey"])
            self.assertEqual(request("openai", "load")["credential"], "fixture-openai-credential")
            self.assertFalse(request("../openai", "load")["ok"])
            self.assertFalse(request("openai", "load", uid=1001)["ok"])

    def test_rejects_overlapping_provider_storage(self):
        with tempfile.TemporaryDirectory() as directory:
            vault = BROKER.CredentialVault(Path(directory) / "same.cred", FakeSystemdCreds())
            with self.assertRaisesRegex(BROKER.BrokerError, "must be distinct"):
                BROKER.CredentialBrokerServer(Path(directory) / "broker.sock", vault=vault, deepseek_vault=vault, allowed_uid=1000, allowed_cgroup="")

    def test_rejects_whitespace_and_short_credentials(self):
        self.assertEqual(
            BROKER.validate_credential("fixture-provider-credential-value"),
            b"fixture-provider-credential-value",
        )
        with self.assertRaises(BROKER.BrokerError):
            BROKER.validate_credential("fixture provider credential value")
        with self.assertRaises(BROKER.BrokerError):
            BROKER.validate_credential("short")

    def test_store_round_trip_and_clear(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "openai.cred"
            vault = BROKER.CredentialVault(path, FakeSystemdCreds())

            vault.store(b"fixture-host-bound-credential-value")

            self.assertTrue(vault.has_key())
            self.assertEqual(
                vault.load(),
                b"fixture-host-bound-credential-value",
            )
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            vault.clear()
            self.assertFalse(vault.has_key())

    def test_plaintext_is_not_written_to_final_credential_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "openai.cred"
            credential = b"fixture-host-bound-credential-value"
            vault = BROKER.CredentialVault(path, FakeSystemdCreds())

            vault.store(credential)

            self.assertNotEqual(path.read_bytes(), credential)
            self.assertTrue(path.read_bytes().startswith(b"encrypted:"))


if __name__ == "__main__":
    unittest.main()
