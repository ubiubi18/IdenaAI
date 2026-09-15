# Automatic transfer and stake services

These scripts maintain the existing Linux service pair: the source sends one configured batch to the target, which waits at least 60 seconds after observing the marked transfer before replenishing its own stake. Manual transfers without the automation marker are excluded.

Installed paths:

- `/usr/local/libexec/idena-auto-transfer/idena-auto-common.sh`
- `/usr/local/sbin/idena-auto-transfer-source` on the source host
- `/usr/local/sbin/idena-auto-stake-target` on the target host

The existing root-owned `/etc/idena-auto-transfer.conf` supplies addresses, batch size, reserve, and payload markers through each service's `EnvironmentFile`. Journals remain under `/var/lib/idena-auto-transfer`; RPC keys stay in the local node profile. Updating these scripts does not replace configuration or journals.

Both services defer while an outgoing transaction is pending and submit with an explicit nonce and epoch. A transaction is confirmed only when its block hash is nonzero. The source retains missing transfers for review unless their recorded nonce or epoch proves they can no longer execute; it archives invalidated transfers and resumes on the next timer tick. Legacy entries without that metadata require evidence from node logs before recovery. A still-valid missing transfer or an ambiguous missing stake transaction remains blocked to prevent duplicate spending.

For an update, stop the relevant timer and wait for its service to finish, back up the installed scripts and journal, install the scripts with root ownership, then restore the timer. Keep batch sizes, reserves, identities, and profiles unchanged. `--dry-run` performs reads and fee estimates without submitting or writing the journal; `--status` prints a journal summary.

Run the synthetic regression tests on Linux (Bash 4+, `jq`, `flock`, Python 3):

```sh
python3 -m unittest discover -s deploy/auto-stake -p 'test_*.py'
```
