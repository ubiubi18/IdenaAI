#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly script_dir
readonly source_dir="${script_dir}/novnc"
web_root="$(realpath -e -- "${IDENAAI_NOVNC_WEB_ROOT:-/usr/share/novnc}")"
readonly web_root
readonly module_target="${web_root}/idena-vnc-clipboard.mjs"
readonly html_target="${web_root}/idena-vnc-lite.html"
readonly module_temp="${web_root}/.idena-vnc-clipboard.mjs.$$"
readonly html_temp="${web_root}/.idena-vnc-lite.html.$$"

cleanup() {
  rm -f -- "${module_temp}" "${html_temp}"
}

trap cleanup EXIT

if [[ ${EUID} -ne 0 ]]; then
  echo "Run as root (for example: sudo $0)" >&2
  exit 1
fi

for required in \
  "${source_dir}/idena-vnc-lite.html" \
  "${source_dir}/idena-vnc-clipboard.mjs" \
  "${web_root}/core/rfb.js"; do
  if [[ ! -f ${required} ]]; then
    echo "Required file is missing: ${required}" >&2
    exit 1
  fi
done

install -o root -g root -m 0644 \
  "${source_dir}/idena-vnc-clipboard.mjs" \
  "${module_temp}"
install -o root -g root -m 0644 \
  "${source_dir}/idena-vnc-lite.html" \
  "${html_temp}"

# Publish the dependency first and the HTML entrypoint last. Each rename is
# atomic within the noVNC web root, so an interruption cannot expose an HTML
# page that imports a missing module.
mv -f -- "${module_temp}" "${module_target}"
mv -f -- "${html_temp}" "${html_target}"

cmp -s \
  "${source_dir}/idena-vnc-lite.html" \
  "${html_target}"
cmp -s \
  "${source_dir}/idena-vnc-clipboard.mjs" \
  "${module_target}"

echo "Installed the IdenaAI noVNC clipboard client in ${web_root}."
echo "No service restart is required."
