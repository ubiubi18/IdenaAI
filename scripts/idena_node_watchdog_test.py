import importlib.util
import json
import stat
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


MODULE_PATH = Path(__file__).with_name("idena_node_watchdog.py")
SPEC = importlib.util.spec_from_file_location("idena_node_watchdog", MODULE_PATH)
assert SPEC and SPEC.loader
WATCHDOG = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = WATCHDOG
SPEC.loader.exec_module(WATCHDOG)


def config(**overrides):
    values = {
        "rpc_url": "http://127.0.0.1:9009",
        "api_key_file": Path("/fixture/api.key"),
        "expected_address": "0x" + "a" * 40,
        "peer_loss_seconds": 900,
        "peer_zero_samples": 15,
        "startup_grace_seconds": 1800,
        "restart_cooldown_seconds": 3600,
        "online_false_seconds": 900,
        "online_false_blocks": 30,
        "head_stale_seconds": 300,
        "max_block_lag": 2,
        "recheck_seconds": 5,
        "eligible_identity_states": ("Human",),
    }
    values.update(overrides)
    return WATCHDOG.WatchdogConfig(**values)


def snapshot(
    *,
    peers=3,
    height=100,
    block_timestamp=1_000_000,
    online=False,
    service_uptime=3600,
    auto_online=True,
    syncing=False,
    wrong_time=False,
    period="None",
    address=None,
    state="Human",
    delegatee=None,
    pending_transactions=None,
    invocation="42:1",
):
    expected = address or "0x" + "a" * 40
    return {
        "service": {
            "active": True,
            "mainPid": 42,
            "uptimeSeconds": service_uptime,
            "invocationId": invocation,
            "autoOnlineActive": auto_online,
        },
        "peers": peers,
        "syncing": {
            "syncing": syncing,
            "wrongTime": wrong_time,
            "currentBlock": height,
            "highestBlock": height,
        },
        "lastBlock": {"height": height, "timestamp": block_timestamp},
        "coinbase": expected,
        "identity": {
            "address": expected,
            "state": state,
            "online": online,
            "delegatee": delegatee,
            "isPool": False,
            "penaltySeconds": 28800,
        },
        "epoch": {"currentPeriod": period},
        "pendingTransactions": (
            [] if pending_transactions is None else pending_transactions
        ),
        "rpcErrors": [],
    }


def tick(state, snap, now, cfg=None, boot="boot-a"):
    return WATCHDOG.evaluate_tick(
        state,
        snap,
        cfg or config(),
        boot_id=boot,
        monotonic_seconds=now,
        epoch_seconds=1_000_000 + now,
    )


class ConfigurationTests(unittest.TestCase):
    def test_accepts_only_literal_loopback_http_rpc(self):
        self.assertEqual(
            WATCHDOG.validate_loopback_rpc_url("http://127.0.0.1:9009"),
            "http://127.0.0.1:9009",
        )
        self.assertEqual(
            WATCHDOG.validate_loopback_rpc_url("http://[::1]:9009/"),
            "http://[::1]:9009",
        )
        for invalid in (
            "https://127.0.0.1:9009",
            "http://localhost:9009",
            "http://10.0.0.1:9009",
            "http://user:pass@127.0.0.1:9009",
            "http://127.0.0.1:9009/?key=secret",
        ):
            with self.subTest(invalid=invalid):
                with self.assertRaises(WATCHDOG.WatchdogError):
                    WATCHDOG.validate_loopback_rpc_url(invalid)

    def test_api_key_file_must_be_private_and_is_never_returned_in_state(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "api.key"
            path.write_text("fixture-private-rpc-key-value", encoding="utf-8")
            path.chmod(0o600)
            self.assertEqual(
                WATCHDOG.read_api_key(path), "fixture-private-rpc-key-value"
            )
            path.chmod(0o644)
            with self.assertRaises(WATCHDOG.WatchdogError):
                WATCHDOG.read_api_key(path)
            self.assertNotIn("key", json.dumps(WATCHDOG.default_state()).lower())

    def test_atomic_state_file_is_private(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state" / "state.json"
            WATCHDOG.atomic_write_json(path, WATCHDOG.default_state())
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertEqual(stat.S_IMODE(path.parent.stat().st_mode), 0o700)

    def test_systemd_credential_path_overrides_configured_key_path(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            path.write_text(
                json.dumps(
                    {
                        "rpcUrl": "http://127.0.0.1:9009",
                        "apiKeyFile": "/source/api.key",
                        "expectedAddress": "0x" + "a" * 40,
                    }
                ),
                encoding="utf-8",
            )
            with mock.patch.dict(
                "os.environ",
                {WATCHDOG.API_KEY_FILE_ENV: "/run/credentials/idena-rpc-key"},
            ):
                loaded = WATCHDOG.load_config(path)
            self.assertEqual(
                loaded.api_key_file,
                Path("/run/credentials/idena-rpc-key"),
            )

    def test_zero_expected_address_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            path.write_text(
                json.dumps(
                    {
                        "rpcUrl": "http://127.0.0.1:9009",
                        "apiKeyFile": "/source/api.key",
                        "expectedAddress": "0x" + "0" * 40,
                    }
                ),
                encoding="utf-8",
            )
            with self.assertRaises(WATCHDOG.WatchdogError):
                WATCHDOG.load_config(path)

    def test_status_exposes_only_boolean_identity_bindings(self):
        cfg = config()
        state = WATCHDOG.default_state()
        good = snapshot()
        status = WATCHDOG.build_status(
            state, good, None, {"notes": []}, cfg, 1_000_000, mode="check"
        )
        self.assertEqual(
            status["addressBindings"],
            {
                "coinbaseMatchesExpected": True,
                "identityMatchesExpected": True,
            },
        )
        wrong = snapshot(address="0x" + "b" * 40)
        status = WATCHDOG.build_status(
            state, wrong, None, {"notes": []}, cfg, 1_000_000, mode="check"
        )
        self.assertEqual(
            status["addressBindings"],
            {
                "coinbaseMatchesExpected": False,
                "identityMatchesExpected": False,
            },
        )

    def test_valid_json_with_corrupt_state_types_fails_closed(self):
        for field, value in (
            ("schema", True),
            ("restartHistoryEpochs", None),
            ("recentBlockAdvances", None),
            ("peerMonitoringArmed", "yes"),
            ("zeroPeerSamples", -1),
            ("lastRestartEpoch", float("nan")),
        ):
            with self.subTest(field=field):
                state = WATCHDOG.default_state()
                state[field] = value
                with self.assertRaises(WATCHDOG.WatchdogError):
                    WATCHDOG.normalize_state(state)


class PeerRecoveryTests(unittest.TestCase):
    def test_zero_peers_during_cold_start_never_arms_restart(self):
        state, action, details = tick(
            WATCHDOG.default_state(),
            snapshot(peers=0, service_uptime=7200),
            5000,
        )
        self.assertIsNone(action)
        self.assertFalse(state["peerMonitoringArmed"])
        self.assertIsNone(state["zeroPeersSince"])
        self.assertIn("peer_monitor_unarmed", details["notes"])

    def test_new_invocation_resets_current_arm_during_startup_grace(self):
        state = WATCHDOG.default_state()
        state.update(
            {
                "bootId": "boot-a",
                "serviceInvocationId": "old:1",
                "everObservedPeers": True,
                "peerMonitoringArmed": True,
                "zeroPeersSince": 1,
                "zeroPeerSamples": 20,
            }
        )
        state, action, details = tick(
            state,
            snapshot(peers=0, invocation="new:2", service_uptime=600),
            1000,
        )
        self.assertIsNone(action)
        self.assertFalse(state["peerMonitoringArmed"])
        self.assertIsNone(state["zeroPeersSince"])
        self.assertIn("peer_monitor_unarmed", details["notes"])

    def test_historically_healthy_node_rearms_after_startup_grace(self):
        state = WATCHDOG.default_state()
        state.update(
            {
                "bootId": "old-boot",
                "serviceInvocationId": "old:1",
                "everObservedPeers": True,
                "peerMonitoringArmed": True,
            }
        )
        state, action, _ = tick(
            state,
            snapshot(peers=0, invocation="new:2", service_uptime=1800),
            2000,
            boot="new-boot",
        )
        self.assertIsNone(action)
        self.assertTrue(state["peerMonitoringArmed"])
        self.assertEqual(state["zeroPeersSince"], 2000)

        for index, now in enumerate(range(2060, 2961, 60), start=1):
            state, action, _ = tick(
                state,
                snapshot(
                    peers=0,
                    invocation="new:2",
                    service_uptime=1800 + index * 60,
                ),
                now,
                boot="new-boot",
            )
        self.assertEqual(action, "restart_peer_loss")

    def test_restarts_once_after_fifteen_proven_minutes_of_peer_loss(self):
        state, _, _ = tick(
            WATCHDOG.default_state(),
            snapshot(peers=3, service_uptime=300),
            0,
        )
        self.assertTrue(state["peerMonitoringArmed"])

        action = None
        for now in range(60, 961, 60):
            state, action, _ = tick(
                state,
                snapshot(peers=0, service_uptime=300 + now),
                now,
            )
            if now < 960:
                self.assertIsNone(action)
        self.assertEqual(action, "restart_peer_loss")
        self.assertGreaterEqual(state["zeroPeerSamples"], 15)

        WATCHDOG.mark_action_started(state, action, 1_001_000)
        state, action, _ = tick(state, snapshot(peers=0), 1020)
        self.assertIsNone(action)
        self.assertTrue(state["peerRestartedForOutage"])

    def test_rpc_unknown_breaks_continuous_zero_peer_evidence(self):
        state, _, _ = tick(
            WATCHDOG.default_state(), snapshot(peers=2), 0
        )
        state, _, _ = tick(state, snapshot(peers=0), 60)
        self.assertEqual(state["zeroPeersSince"], 60)
        state, action, _ = tick(state, snapshot(peers=None), 120)
        self.assertIsNone(action)
        self.assertIsNone(state["zeroPeersSince"])
        self.assertEqual(state["zeroPeerSamples"], 0)

    def test_global_cooldown_blocks_restart_after_observed_peer(self):
        state, _, _ = tick(
            WATCHDOG.default_state(),
            snapshot(peers=2, service_uptime=300),
            0,
        )
        state["zeroPeersSince"] = 1
        state["zeroPeerSamples"] = 20
        state, action, _ = tick(
            state, snapshot(peers=0, service_uptime=1799), 1000
        )
        self.assertEqual(action, "restart_peer_loss")

        state["lastRestartEpoch"] = 1_000_900
        state, action, _ = tick(
            state, snapshot(peers=0, service_uptime=7200), 1900
        )
        self.assertIsNone(action)

    def test_peer_recovery_resets_outage_latch(self):
        state = WATCHDOG.default_state()
        state["bootId"] = "boot-a"
        state["serviceInvocationId"] = "42:1"
        state["peerMonitoringArmed"] = True
        state["peerRestartedForOutage"] = True
        state, action, _ = tick(state, snapshot(peers=1), 100)
        self.assertIsNone(action)
        self.assertFalse(state["peerRestartedForOutage"])

    def test_six_hour_budget_stops_restart_flapping(self):
        state = WATCHDOG.default_state()
        state.update(
            {
                "bootId": "boot-a",
                "serviceInvocationId": "42:1",
                "peerMonitoringArmed": True,
                "zeroPeersSince": 1,
                "zeroPeerSamples": 20,
                "lastRestartEpoch": 1_000_000,
                "restartHistoryEpochs": [990_000, 1_000_000],
            }
        )
        state, action, _ = tick(state, snapshot(peers=0), 5000)
        self.assertIsNone(action)
        self.assertEqual(len(state["restartHistoryEpochs"]), 2)

        state, action, _ = tick(state, snapshot(peers=0), 22_000)
        self.assertEqual(action, "restart_peer_loss")
        self.assertEqual(len(state["restartHistoryEpochs"]), 0)


class OnlineRecoveryTests(unittest.TestCase):
    def build_healthy_offline_history(self):
        state = WATCHDOG.default_state()
        for index, now in enumerate(range(0, 1081, 60)):
            state, action, _ = tick(
                state,
                snapshot(
                    height=100 + index * 3,
                    block_timestamp=1_000_000 + now,
                ),
                now,
            )
        return state, action

    def test_restarts_once_after_healthy_offline_grace_and_progress(self):
        state, action = self.build_healthy_offline_history()
        self.assertEqual(action, "restart_online_stuck")
        self.assertGreaterEqual(
            100 + 18 * 3 - state["onlineFalseStartBlock"], 30
        )
        WATCHDOG.mark_action_started(state, action, 1_001_080)
        state, action, _ = tick(state, snapshot(height=160), 1140)
        self.assertIsNone(action)
        self.assertTrue(state["onlineRestartedForEpisode"])

        state, action, _ = tick(
            state, snapshot(height=163, online=True), 1200
        )
        self.assertIsNone(action)
        self.assertFalse(state["onlineRestartedForEpisode"])

    def test_every_material_health_gate_blocks_online_restart(self):
        cases = {
            "no peers": {"peers": 0},
            "syncing": {"syncing": True},
            "wrong time": {"wrong_time": True},
            "ceremony": {"period": "ShortSession"},
            "delegated": {"delegatee": "0x" + "b" * 40},
            "wrong identity": {"address": "0x" + "b" * 40},
            "ineligible": {"state": "Candidate"},
            "autoonline missing": {"auto_online": False},
            "startup grace": {"service_uptime": 100},
            "pending online transaction": {
                "pending_transactions": [{"type": "online"}]
            },
        }
        for label, overrides in cases.items():
            with self.subTest(label=label):
                state = WATCHDOG.default_state()
                state["bootId"] = "boot-a"
                state["serviceInvocationId"] = "42:1"
                state["onlineFalseSince"] = 1
                state["onlineFalseStartBlock"] = 1
                state["lastObservedBlock"] = 149
                state["recentBlockAdvances"] = [850, 900]
                state, action, _ = tick(
                    state,
                    snapshot(
                        height=150,
                        block_timestamp=1_001_000,
                        **overrides,
                    ),
                    1000,
                )
                self.assertIsNone(action)
                self.assertIsNone(state["onlineFalseSince"])

    def test_penalty_seconds_does_not_block_recovery(self):
        state, action = self.build_healthy_offline_history()
        self.assertEqual(action, "restart_online_stuck")
        self.assertEqual(state["onlineRestartedForEpisode"], False)

    def test_new_boot_resets_continuous_windows_but_keeps_action_cooldown(self):
        state = WATCHDOG.default_state()
        state.update(
            {
                "bootId": "old-boot",
                "zeroPeersSince": 1,
                "onlineFalseSince": 1,
                "lastRestartEpoch": 999_000,
            }
        )
        state, action, _ = tick(
            state, snapshot(peers=0), 5000, boot="new-boot"
        )
        self.assertIsNone(action)
        self.assertIsNone(state["zeroPeersSince"])
        self.assertIsNone(state["onlineFalseSince"])
        self.assertEqual(state["lastRestartEpoch"], 999_000)


class RecheckTests(unittest.TestCase):
    def test_recheck_requires_same_invocation_and_same_fault(self):
        state = WATCHDOG.default_state()
        state["serviceInvocationId"] = "42:1"
        self.assertTrue(
            WATCHDOG.recheck_action(
                "restart_peer_loss",
                state,
                snapshot(peers=0),
                config(),
                1000,
                1_001_000,
            )
        )
        self.assertFalse(
            WATCHDOG.recheck_action(
                "restart_peer_loss",
                state,
                snapshot(peers=1),
                config(),
                1000,
                1_001_000,
            )
        )
        self.assertFalse(
            WATCHDOG.recheck_action(
                "restart_peer_loss",
                state,
                snapshot(peers=0, invocation="99:2"),
                config(),
                1000,
                1_001_000,
            )
        )


class RestartFailureTests(unittest.TestCase):
    def test_known_restart_failure_releases_episode_latch_but_keeps_budget(self):
        state = WATCHDOG.default_state()
        WATCHDOG.mark_action_started(state, "restart_peer_loss", 1_000_000)
        error = WATCHDOG.RestartError(
            "idena.service restart failed", outcome_unknown=False
        )
        WATCHDOG.mark_action_failed(state, "restart_peer_loss", error)
        self.assertFalse(state["peerRestartedForOutage"])
        self.assertEqual(state["lastRestartEpoch"], 1_000_000)
        self.assertEqual(state["restartHistoryEpochs"], [1_000_000])

    def test_timeout_retains_episode_latch_because_outcome_is_unknown(self):
        state = WATCHDOG.default_state()
        WATCHDOG.mark_action_started(state, "restart_online_stuck", 1_000_000)
        error = WATCHDOG.RestartError(
            "restart outcome unknown", outcome_unknown=True
        )
        WATCHDOG.mark_action_failed(state, "restart_online_stuck", error)
        self.assertTrue(state["onlineRestartedForEpisode"])
        self.assertEqual(state["restartHistoryEpochs"], [1_000_000])

    def test_restart_subprocess_classifies_known_and_unknown_failures(self):
        with mock.patch.object(
            WATCHDOG.subprocess,
            "run",
            side_effect=WATCHDOG.subprocess.CalledProcessError(1, "systemctl"),
        ):
            with self.assertRaises(WATCHDOG.RestartError) as nonzero:
                WATCHDOG.restart_idena_service()
        self.assertTrue(nonzero.exception.outcome_unknown)

        with mock.patch.object(
            WATCHDOG.subprocess,
            "run",
            side_effect=WATCHDOG.subprocess.TimeoutExpired("systemctl", 330),
        ):
            with self.assertRaises(WATCHDOG.RestartError) as unknown:
                WATCHDOG.restart_idena_service()
        self.assertTrue(unknown.exception.outcome_unknown)

        with mock.patch.object(
            WATCHDOG.subprocess,
            "run",
            side_effect=OSError("systemctl could not be executed"),
        ):
            with self.assertRaises(WATCHDOG.RestartError) as known:
                WATCHDOG.restart_idena_service()
        self.assertFalse(known.exception.outcome_unknown)


if __name__ == "__main__":
    unittest.main()
