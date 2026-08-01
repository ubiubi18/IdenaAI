import importlib.util
import os
import stat
import tempfile
import unittest
from pathlib import Path


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
