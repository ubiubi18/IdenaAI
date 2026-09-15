"""Linux integration tests with synthetic RPC responses; never connect to a node."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import unittest


HERE = Path(__file__).resolve().parent
SOURCE = "0x" + "1" * 40
TARGET = "0x" + "2" * 40
TX_HASH = "0x" + "a" * 64
ZERO_HASH = "0x" + "0" * 64


@unittest.skipUnless(shutil.which("flock"), "requires Linux flock and Bash 4+")
class AutoStakeTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.now = int(time.time())
        self.responses = {
            "bcn_syncing": {"syncing": False, "currentBlock": 10, "highestBlock": 10},
            "net_peers": ["synthetic-peer"],
            "dna_getCoinbaseAddr": SOURCE,
            "dna_identity": {"state": "Human"},
            "dna_epoch": {"epoch": 226},
            "dna_getBalance": {"balance": "1002.5", "nonce": 5, "mempoolNonce": 5},
            "bcn_pendingTransactions": {"transactions": []},
            "bcn_transactions": {"transactions": []},
            "bcn_transaction": None,
            "bcn_estimateTx": {"txFee": "0.01"},
            "dna_sendTransaction": TX_HASH,
        }
        self.state = {"version": 1, "active": None, "completed": []}
        self.env = dict(os.environ, IDENA_AUTO_STATE_DIR=str(self.root))
        mock = (
            f'source "{HERE / "idena-auto-common.sh"}"\n'
            f'load_config() {{ SOURCE_ADDRESS={SOURCE}; TARGET_ADDRESS={TARGET}; '
            'BATCH_AMOUNT_IDNA=1000; FEE_RESERVE_IDNA=2; '
            'TRANSFER_PAYLOAD_HEX=0x1234; STAKE_PAYLOAD_PREFIX_HEX=0x5678; }\n'
            'rpc() {\n'
            '  jq -cn --arg method "$1" --argjson params "${2:-[]}" '
            "'{method:$method,params:$params}' >>\"$STATE_DIR/calls.jsonl\"\n"
            '  jq -c --arg method "$1" '\
            "'.[$method]' \"$STATE_DIR/responses.json\"\n"
            '}\n'
        )
        (self.root / "mock.sh").write_text(mock)

    def active(self, **fields):
        self.state["active"] = dict(
            hash=TX_HASH, status="needs_review", submittedAt=self.now - 3600,
            epoch=225, nonce=28, **fields
        )

    def run_script(self, target=False, dry_run=False, errors=None):
        name = "idena-auto-stake-target" if target else "idena-auto-transfer-source"
        state_path = self.root / ("target-state.json" if target else "source-state.json")
        state_path.write_text(json.dumps(self.state))
        responses = {k: {"result": v} for k, v in self.responses.items()}
        responses.update(errors or {})
        (self.root / "responses.json").write_text(json.dumps(responses))
        script = (HERE / name).read_text().replace(
            "source /usr/local/libexec/idena-auto-transfer/idena-auto-common.sh",
            f'source "{self.root / "mock.sh"}"',
        )
        (self.root / "run.sh").write_text(script)
        result = subprocess.run(
            ["bash", str(self.root / "run.sh"), "--dry-run" if dry_run else "--run"],
            env=self.env, text=True, capture_output=True, timeout=15,
        )
        calls = [json.loads(line) for line in (self.root / "calls.jsonl").read_text().splitlines()]
        sends = [c["params"][0] for c in calls if c["method"] == "dna_sendTransaction"]
        return result, json.loads(state_path.read_text()), sends

    def test_missing_expired_transfer_is_retired_without_sending(self):
        self.active()
        result, state, sends = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIsNone(state["active"])
        self.assertEqual(state["abandoned"][0]["hash"], TX_HASH)
        self.assertEqual(state["abandoned"][0]["status"], "invalidated")
        self.assertEqual(sends, [])

    def test_consumed_nonce_recovers_but_valid_nonce_stays_blocked(self):
        self.active()
        self.state["active"].update(epoch=226, nonce=5)
        result, state, sends = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIsNone(state["active"])
        self.assertEqual(sends, [])
        self.state["active"]["nonce"] = 6
        result, state, sends = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(state["active"]["hash"], TX_HASH)
        self.assertEqual(sends, [])

    def test_legacy_unknown_nonce_requires_review(self):
        self.active()
        del self.state["active"]["nonce"]
        result, state, sends = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(state["active"]["status"], "needs_review")
        self.assertEqual(sends, [])

    def test_rpc_error_does_not_retire_or_send(self):
        self.active()
        original = json.loads(json.dumps(self.state))
        result, state, sends = self.run_script(errors={"bcn_transaction": {"error": {"message": "unavailable"}}})
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(state, original)
        self.assertEqual(sends, [])

    def test_mempool_lookup_is_not_confirmation(self):
        self.active()
        self.responses["bcn_transaction"] = {"hash": TX_HASH, "blockHash": ZERO_HASH}
        result, state, sends = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIsNotNone(state["active"])
        self.assertEqual(state["completed"], [])
        self.assertEqual(sends, [])

    def test_manual_pending_transfer_defers_even_with_1002_balance(self):
        self.responses["bcn_pendingTransactions"]["transactions"] = [{"from": SOURCE, "amount": "1000", "payload": "0x", "type": "send"}]
        result, state, sends = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("outgoing transaction", result.stdout)
        self.assertIsNone(state["active"])
        self.assertEqual(sends, [])

    def test_pending_nonce_catches_transaction_arriving_after_mempool_read(self):
        self.responses["dna_getBalance"]["mempoolNonce"] = 6
        result, _, sends = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(sends, [])

    def test_new_transfer_pins_and_journals_nonce_and_epoch(self):
        result, state, sends = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(sends), 1)
        self.assertEqual(sends[0]["amount"], "1000")
        self.assertEqual(sends[0]["to"], TARGET)
        self.assertEqual((sends[0]["nonce"], sends[0]["epoch"]), (6, 226))
        self.assertEqual((state["active"]["nonce"], state["active"]["epoch"]), (6, 226))

    def test_reserve_and_dry_run_prevent_spending(self):
        result, state, sends = self.run_script(dry_run=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(sends, [])
        self.assertEqual(state, self.state)
        self.responses["dna_getBalance"]["balance"] = "1002"
        result, _, sends = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(sends, [])

    def test_target_waits_for_manual_spend_and_pins_stake_nonce(self):
        self.responses["dna_getCoinbaseAddr"] = TARGET
        self.state = {"version": 1, "receipts": {TX_HASH: {"status": "waiting", "firstSeen": self.now - 120, "stakeTxHash": None}}}
        self.responses["dna_getBalance"]["mempoolNonce"] = 6
        result, _, sends = self.run_script(target=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(sends, [])
        self.responses["dna_getBalance"]["mempoolNonce"] = 5
        result, state, sends = self.run_script(target=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(sends), 1)
        self.assertEqual(sends[0]["type"], 22)
        self.assertEqual((sends[0]["from"], sends[0]["to"]), (TARGET, TARGET))
        self.assertEqual((state["receipts"][TX_HASH]["nonce"], state["receipts"][TX_HASH]["epoch"]), (6, 226))

    def test_target_mempool_stake_remains_submitted(self):
        self.responses["dna_getCoinbaseAddr"] = TARGET
        self.responses["bcn_transaction"] = {"hash": TX_HASH, "blockHash": ZERO_HASH}
        self.state = {"version": 1, "receipts": {TX_HASH: {"status": "submitted", "submittedAt": self.now - 3600, "stakeTxHash": TX_HASH}}}
        result, state, sends = self.run_script(target=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(state["receipts"][TX_HASH]["status"], "submitted")
        self.assertEqual(sends, [])


if __name__ == "__main__":
    unittest.main()
