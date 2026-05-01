# Rehearsal Parallel Lane Benchmark

IdenaAI's rehearsal devnet starts nine local nodes by default: one bootstrap node
and eight validator identities. This is enough to benchmark parallel validation
lanes on a private loopback network without touching mainnet.

This document defines the safe boundary for that work.

## Allowed Scope

- Run multiple autosolver lanes only against the local rehearsal devnet.
- Use only node endpoints created by the current rehearsal controller.
- Require loopback RPC URLs such as `127.0.0.1` or `localhost`.
- Store per-lane telemetry locally for benchmark comparison.
- Keep the normal app session connected to one primary validator unless a
  dedicated rehearsal lane runner is explicitly active.

## Not Allowed Scope

- Do not turn this into multi-identity mainnet automation.
- Do not accept arbitrary user-supplied RPC URLs for parallel lanes.
- Do not reuse this path for real invited identities.
- Do not submit answers or reports to mainnet from hidden lanes.
- Do not hide lane activity from the user.

## Implementation Shape

A safe rehearsal lane runner should:

1. Read the active devnet status from the main-process rehearsal controller.
2. Select validator nodes from that status only.
3. Verify every selected RPC endpoint is loopback and belongs to the active
   rehearsal network.
4. Run one isolated validation solver lane per selected validator.
5. Write one telemetry record per lane, including endpoint, period, solved
   counts, report counts, provider/model, token use, cost estimate, and errors.
6. Refuse to start if the app is not in rehearsal mode.

The current app already has the eight local validator identities. The missing
piece is a rehearsal-only lane runner that reuses the existing solver logic
without exposing this as a real-session multi-account feature.

