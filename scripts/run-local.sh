#!/usr/bin/env bash
# Run the already-built local Kite binary (no Rust recompile).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/.cache/cargo-target/debug/kite"
ALT="$HOME/kite-target/debug/kite"

if [[ -x "$BIN" ]]; then
  exec "$BIN" "$@"
elif [[ -x "$ALT" ]]; then
  exec "$ALT" "$@"
else
  echo "No local binary found. Build once with:" >&2
  echo "  source scripts/env.sh && CARGO_BUILD_JOBS=1 npm run tauri -- build --debug --bundles deb" >&2
  exit 1
fi
