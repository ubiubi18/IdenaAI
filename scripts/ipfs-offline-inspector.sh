#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_GO_119="$HOME/go/pkg/mod/golang.org/toolchain@v0.0.1-go1.19.13.darwin-arm64/bin/go"

if [[ -z "${GO_BIN:-}" ]]; then
  if [[ -x "$DEFAULT_GO_119" ]]; then
    GO_BIN="$DEFAULT_GO_119"
  else
    GO_BIN="$(command -v go)"
  fi
fi

cd "$ROOT_DIR/idena-go"
exec "$GO_BIN" run ./cmd/ipfsrepoinspect "$@"
