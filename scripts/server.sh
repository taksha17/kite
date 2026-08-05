#!/usr/bin/env bash
# Run kite-server: builds the web app if needed, then serves API + PWA.
set -euo pipefail

_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$_DIR/.." && pwd)"
source "$_DIR/env.sh"

# Data + server build live on a native filesystem: cargo and SQLite can
# stall on NTFS mounts under memory pressure.
DATA_DIR="${KITE_DATA_DIR:-$HOME/.local/share/kite-server}"
WEB_DIR="${KITE_WEB_DIR:-$ROOT/dist}"
SRV_TARGET="${KITE_SERVER_TARGET_DIR:-/tmp/kite-server-target}"
PORT="${PORT:-8080}"

export CARGO_TARGET_DIR="$SRV_TARGET"

if [ ! -f "$WEB_DIR/index.html" ]; then
  echo "Web app not built — running npm build first…"
  (cd "$ROOT" && npm run build)
fi

MODE="${KITE_SERVER_MODE:-release}"
if [ "$MODE" = "dev" ]; then
  exec cargo run --offline -j 2 --manifest-path "$ROOT/kite-server/Cargo.toml" -- \
    serve --data-dir "$DATA_DIR" --web-dir "$WEB_DIR" --port "$PORT"
else
  BIN="$SRV_TARGET/release/kite-server"
  if [ ! -x "$BIN" ]; then
    cargo build --release --offline -j 2 --manifest-path "$ROOT/kite-server/Cargo.toml"
  fi
  exec "$BIN" serve --data-dir "$DATA_DIR" --web-dir "$WEB_DIR" --port "$PORT"
fi
