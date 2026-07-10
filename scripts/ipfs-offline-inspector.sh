#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GO_TOOLCHAIN="${IDENA_GO_GOTOOLCHAIN:-go1.26.5}"

if [[ -z "${GO_BIN:-}" ]]; then
  if ! GO_BIN="$(command -v go)"; then
    echo "Go is required to run the offline IPFS inspector." >&2
    exit 1
  fi
fi

cd "$ROOT_DIR/idena-go"
exec env GOTOOLCHAIN="$GO_TOOLCHAIN" "$GO_BIN" run ./cmd/ipfsrepoinspect "$@"
