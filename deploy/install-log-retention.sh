#!/usr/bin/env bash
set -euo pipefail

# Install for each console profile. Rotation does not restart the console/node.
# Usage: sudo bash deploy/install-log-retention.sh idena-ai /var/lib/idena-ai/profile
if [[ "$EUID" -ne 0 || "$#" -ne 2 ]]; then
  echo "usage: sudo bash $0 INSTANCE PROFILE_DIRECTORY" >&2
  exit 2
fi

instance="$1"
profile="$2"
if [[ ! "$instance" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]*$ ||
      ! "$profile" =~ ^/[a-zA-Z0-9_./-]+$ || ! -d "$profile" ]]; then
  echo "Invalid instance name or profile directory" >&2
  exit 2
fi
profile="$(realpath -e "$profile")"
if [[ ! -f "$profile/settings.json" || -L "$profile/idena.log" ]]; then
  echo "Expected an existing console profile with a regular application log" >&2
  exit 2
fi
owner="$(stat -c %U "$profile")"
group="$(stat -c %G "$profile")"
if [[ "$owner" == root || "$owner" == UNKNOWN || "$group" == UNKNOWN ]]; then
  echo "The console profile must belong to its service user" >&2
  exit 2
fi

source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
work_dir="$(mktemp -d)"
trap 'rm -rf -- "$work_dir"' EXIT
cat >"$work_dir/$instance.conf" <<EOF
"$profile/idena.log"
"$profile/console.log"
"$profile/node/datadir/logs/error.log"
{
    su $owner $group
    daily
    maxsize 100M
    rotate 7
    compress
    copytruncate
    missingok
    notifempty
}
EOF

# Validate before installing; debug mode neither rotates logs nor writes state.
/usr/sbin/logrotate --debug --state /dev/null "$work_dir/$instance.conf"
systemd-analyze verify \
  "$source_dir/systemd/idena-ai-logrotate@.service" \
  "$source_dir/systemd/idena-ai-logrotate@.timer"
install -d -m 0755 /etc/idena-ai-logrotate /var/lib/logrotate
install -m 0644 "$work_dir/$instance.conf" "/etc/idena-ai-logrotate/$instance.conf"
install -m 0644 "$source_dir/systemd/idena-ai-logrotate@.service" /etc/systemd/system/
install -m 0644 "$source_dir/systemd/idena-ai-logrotate@.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now "idena-ai-logrotate@$instance.timer"
echo "Log retention enabled for $instance; the console and node were not restarted."
