#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "This script is for macOS arm64 only." >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IDENA_GO_DIR="${IDENAAI_IDENA_GO_DIR:-${ROOT_DIR}/idena-go}"
WASM_BINDING_DIR="${IDENAAI_IDENA_WASM_BINDING_DIR:-${ROOT_DIR}/idena-wasm-binding}"
WASM_SRC_DIR="${IDENAAI_IDENA_WASM_DIR:-${ROOT_DIR}/idena-wasm}"
OUTPUT_BIN="${1:-$HOME/Library/Application Support/IdenaAI/node/idena-go}"
GO_TOOLCHAIN="${IDENA_GO_GOTOOLCHAIN:-go1.19.13}"
USING_DEFAULT_SOURCE_DIRS=0
SOURCES_PREPARED=0

if [[ -z "${IDENAAI_IDENA_GO_DIR:-}" && -z "${IDENAAI_IDENA_WASM_BINDING_DIR:-}" && -z "${IDENAAI_IDENA_WASM_DIR:-}" ]]; then
  USING_DEFAULT_SOURCE_DIRS=1
fi

relative_path() {
  node -e "const path = require('path'); const relative = path.relative(process.argv[1], process.argv[2]) || '.'; console.log(relative.startsWith('.') ? relative : './' + relative)" "$1" "$2"
}

prepare_default_sources() {
  if [[ "${USING_DEFAULT_SOURCE_DIRS}" != "1" || "${SOURCES_PREPARED}" == "1" ]]; then
    return
  fi

  echo "Preparing pinned source mirrors..."
  node "${ROOT_DIR}/scripts/setup-sources.js"
  SOURCES_PREPARED=1
}

if ! command -v cargo >/dev/null 2>&1 || ! command -v rustc >/dev/null 2>&1; then
  echo "Rust toolchain is missing. Install rustup first:" >&2
  echo "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal" >&2
  exit 1
fi

if ! command -v go >/dev/null 2>&1; then
  echo "Go toolchain is missing." >&2
  exit 1
fi

if [[ ! -d "${IDENA_GO_DIR}" || ! -f "${IDENA_GO_DIR}/go.mod" ]]; then
  prepare_default_sources
fi

if [[ ! -d "${IDENA_GO_DIR}" || ! -f "${IDENA_GO_DIR}/go.mod" ]]; then
  echo "idena-go source directory not found at ${IDENA_GO_DIR}" >&2
  echo "Run npm run setup:sources first." >&2
  exit 1
fi

if [[ ! -d "${WASM_SRC_DIR}" || ! -f "${WASM_SRC_DIR}/Cargo.toml" ]]; then
  prepare_default_sources
fi

if [[ ! -d "${WASM_SRC_DIR}" || ! -f "${WASM_SRC_DIR}/Cargo.toml" ]]; then
  echo "idena-wasm source directory not found at ${WASM_SRC_DIR}" >&2
  echo "Run npm run setup:sources first." >&2
  exit 1
fi

if [[ ! -d "${WASM_BINDING_DIR}" || ! -f "${WASM_BINDING_DIR}/go.mod" ]]; then
  prepare_default_sources
fi

if [[ ! -d "${WASM_BINDING_DIR}" || ! -f "${WASM_BINDING_DIR}/go.mod" ]]; then
  echo "idena-wasm-binding source directory not found at ${WASM_BINDING_DIR}" >&2
  echo "Run npm run setup:sources first." >&2
  exit 1
fi

echo "Building libidena_wasm for aarch64-apple-darwin..."
(
  cd "${WASM_SRC_DIR}"
  cargo build --release --target aarch64-apple-darwin
)

mkdir -p "${WASM_BINDING_DIR}/lib"
cp "${WASM_SRC_DIR}/target/aarch64-apple-darwin/release/libidena_wasm.a" "${WASM_BINDING_DIR}/lib/libidena_wasm_darwin_arm64.a"

echo "Building idena-go v1.1.2..."
mkdir -p "$(dirname "${OUTPUT_BIN}")"
(
  cd "${IDENA_GO_DIR}"
  LOCAL_WASM_BINDING="$(relative_path "${IDENA_GO_DIR}" "${WASM_BINDING_DIR}")"
  go mod edit "-replace=github.com/idena-network/idena-wasm-binding=${LOCAL_WASM_BINDING}"
  env GOTOOLCHAIN="${GO_TOOLCHAIN}" go build -ldflags "-X main.version=1.1.2" -o "${OUTPUT_BIN}" .
)
chmod 755 "${OUTPUT_BIN}"

"${OUTPUT_BIN}" --version

echo "Done. Node binary written to: ${OUTPUT_BIN}"
