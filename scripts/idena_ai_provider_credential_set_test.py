import contextlib
import importlib.util
import io
import stat
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).with_name("idena_ai_provider_credential_set.py")
SPEC = importlib.util.spec_from_file_location("credential_set", MODULE_PATH)
assert SPEC and SPEC.loader
COMMAND = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COMMAND)

BROKER_PATH = Path(__file__).with_name("idena_ai_provider_credential_broker.py")
BROKER_SPEC = importlib.util.spec_from_file_location("credential_broker_for_set", BROKER_PATH)
assert BROKER_SPEC and BROKER_SPEC.loader
BROKER = importlib.util.module_from_spec(BROKER_SPEC)
BROKER_SPEC.loader.exec_module(BROKER)

CREDENTIAL_VALUE = "fixture-provider-credential-value"


class FakeSystemdCreds:
    def __call__(self, command, *, input_bytes=None):
        operation = command[1]
        if operation == "encrypt":
            Path(command[-1]).write_bytes(b"encrypted:" + input_bytes)
            return b""
        if operation == "decrypt":
            return Path(command[-2]).read_bytes().removeprefix(b"encrypted:")
        raise AssertionError(f"unexpected command: {command}")


class FakeSystemctl:
    def __init__(self, units):
        self.units = units
        self.restarted = []

    def __call__(self, command):
        if command[:2] == ["systemctl", "cat"]:
            unit = command[2]
            if unit in self.units:
                return self.units[unit]
            raise COMMAND.CommandError("unit not found")
        if command[:2] == ["systemctl", "list-unit-files"]:
            return "".join(f"{name} enabled enabled\n" for name in self.units)
        if command[:2] == ["systemctl", "restart"]:
            self.restarted.append(command[2])
            return ""
        raise AssertionError(f"unexpected command: {command}")


def broker_unit(credential_path):
    return (
        "[Service]\n"
        "ExecStart=/usr/bin/python3 "
        "/usr/local/libexec/idena-ai/provider-credential-broker.py "
        f"--credential {credential_path}\n"
    )


class ProviderCredentialCommandTests(unittest.TestCase):
    def test_store_encrypts_stdin_and_never_prints_the_key(self):
        with tempfile.TemporaryDirectory() as directory:
            credential_path = Path(directory) / "idena-ai-openai-api-key.cred"
            systemctl = FakeSystemctl(
                {
                    "idena-ai-console.service": "[Unit]\n",
                    "idena-ai-provider-credential-broker.service": broker_unit(
                        credential_path
                    ),
                }
            )
            stdout = io.StringIO()
            with patch.object(COMMAND, "load_broker_module", return_value=BROKER), patch.object(
                BROKER, "default_run_command", FakeSystemdCreds()
            ), patch.object(COMMAND.os, "geteuid", return_value=0), contextlib.redirect_stdout(
                stdout
            ):
                code = COMMAND.main(
                    ["--stdin", "--restart"],
                    systemctl=systemctl,
                    stream=io.StringIO(f"{CREDENTIAL_VALUE}\n"),
                )

            self.assertEqual(code, 0)
            self.assertTrue(credential_path.read_bytes().startswith(b"encrypted:"))
            self.assertNotEqual(credential_path.read_bytes(), CREDENTIAL_VALUE)
            self.assertEqual(stat.S_IMODE(credential_path.stat().st_mode), 0o600)
            self.assertNotIn(CREDENTIAL_VALUE, stdout.getvalue())
            self.assertEqual(systemctl.restarted, ["idena-ai-console.service"])

    def test_deepseek_uses_the_derived_host_path(self):
        base_path = Path("/etc/credstore.encrypted/idena-ai-3-openai-api-key.cred")
        self.assertEqual(
            COMMAND.provider_credential_path(BROKER, base_path, "deepseek"),
            BROKER.derive_deepseek_credential_path(base_path),
        )
        self.assertEqual(
            COMMAND.provider_credential_path(BROKER, base_path, "deepseek"),
            Path("/etc/credstore.encrypted/idena-ai-3-openai-api-key.deepseek.cred"),
        )
        self.assertEqual(
            COMMAND.provider_credential_name(BROKER, "deepseek"),
            BROKER.DEEPSEEK_CREDENTIAL_NAME,
        )
        self.assertEqual(COMMAND.provider_credential_name(BROKER, "openai"), BROKER.CREDENTIAL_NAME)

    def test_credential_argument_parsing(self):
        fallback = Path("/etc/credstore.encrypted/openai.cred")
        self.assertEqual(
            COMMAND.parse_credential_argument(
                "ExecStart=/usr/bin/python3 broker --credential /srv/three.cred\n",
                fallback,
            ),
            Path("/srv/three.cred"),
        )
        self.assertEqual(
            COMMAND.parse_credential_argument(
                "ExecStart=/usr/bin/python3 broker --credential=/srv/equals.cred\n",
                fallback,
            ),
            Path("/srv/equals.cred"),
        )
        self.assertEqual(
            COMMAND.parse_credential_argument("ExecStart=/usr/bin/python3 broker\n", fallback),
            fallback,
        )

    def test_list_reports_instances_and_stored_state(self):
        with tempfile.TemporaryDirectory() as directory:
            stored = Path(directory) / "idena-ai-3-openai-api-key.cred"
            stored.write_bytes(b"encrypted:placeholder")
            systemctl = FakeSystemctl(
                {
                    "idena-ai-3-console.service": "[Unit]\n",
                    "idena-ai-3-provider-credential-broker.service": broker_unit(stored),
                }
            )
            listing = COMMAND.format_listing(COMMAND.list_instances(BROKER, systemctl))

            self.assertIn("idena-ai-3-console.service", listing)
            self.assertIn("openai", listing)
            self.assertIn("stored", listing)
            self.assertIn("deepseek", listing)
            self.assertIn("empty", listing)
            self.assertIn(str(stored), listing)
            self.assertNotIn("encrypted:placeholder", listing)

    def test_invalid_credential_is_rejected_without_storing(self):
        with tempfile.TemporaryDirectory() as directory:
            credential_path = Path(directory) / "idena-ai-openai-api-key.cred"
            systemctl = FakeSystemctl({})
            stderr = io.StringIO()
            with patch.object(COMMAND, "load_broker_module", return_value=BROKER), patch.object(
                BROKER, "default_run_command", FakeSystemdCreds()
            ), patch.object(COMMAND.os, "geteuid", return_value=0), contextlib.redirect_stderr(
                stderr
            ):
                code = COMMAND.main(
                    ["--stdin", "--credential", str(credential_path)],
                    systemctl=systemctl,
                    stream=io.StringIO("short\n"),
                )

            self.assertEqual(code, 1)
            self.assertFalse(credential_path.exists())
            self.assertIn("was not stored", stderr.getvalue())
            self.assertNotIn("short\n", stderr.getvalue())

    def test_root_is_required(self):
        stderr = io.StringIO()
        with patch.object(COMMAND.os, "geteuid", return_value=1000), contextlib.redirect_stderr(
            stderr
        ):
            code = COMMAND.main(["--list"], stream=io.StringIO(""))

        self.assertEqual(code, 2)
        self.assertIn("root", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
