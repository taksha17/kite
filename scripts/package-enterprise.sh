#!/usr/bin/env bash
# Package Kite Enterprise (Server Edition): binary + web UI + docs.
# Usage:
#   bash scripts/package-enterprise.sh --os linux --bin path/to/kite-server --out release
#   bash scripts/package-enterprise.sh --os windows --bin path/to/kite-server.exe --out release
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OS=""
BIN=""
OUT="$ROOT/release"
WEB_DIR="$ROOT/dist"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --os) OS="${2:-}"; shift 2 ;;
    --bin) BIN="${2:-}"; shift 2 ;;
    --out) OUT="${2:-}"; shift 2 ;;
    --web-dir) WEB_DIR="${2:-}"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$OS" || -z "$BIN" ]]; then
  echo "Usage: $0 --os linux|windows --bin <kite-server> [--out dir] [--web-dir dist]" >&2
  exit 1
fi
if [[ ! -f "$BIN" ]]; then
  echo "Binary not found: $BIN" >&2
  exit 1
fi
if [[ ! -d "$WEB_DIR" || ! -f "$WEB_DIR/index.html" ]]; then
  echo "Web UI missing at $WEB_DIR (run npm run build first)" >&2
  exit 1
fi

mkdir -p "$OUT"
STAGE="$OUT/kite-enterprise"
rm -rf "$STAGE"
mkdir -p "$STAGE/dist"
cp -a "$WEB_DIR"/. "$STAGE/dist/"

case "$OS" in
  linux)
    cp "$BIN" "$STAGE/kite-server"
    chmod +x "$STAGE/kite-server"
    cp "$ROOT/scripts/enterprise/README.md" "$STAGE/README.md"
    mkdir -p "$STAGE/systemd"
    cp "$ROOT/scripts/enterprise/kite-server.service" "$STAGE/systemd/kite-server.service"
    tar -C "$OUT" -czf "$OUT/kite-enterprise-linux-x64.tar.gz" kite-enterprise
    echo "Wrote $OUT/kite-enterprise-linux-x64.tar.gz"
    ;;
  windows)
    cp "$BIN" "$STAGE/kite-server.exe"
    cp "$ROOT/scripts/enterprise/README.md" "$STAGE/README.txt"
    cp "$ROOT/scripts/enterprise/start.bat" "$STAGE/start.bat"
    rm -f "$OUT/kite-enterprise-windows-x64.zip"
    if command -v zip >/dev/null 2>&1; then
      (cd "$OUT" && zip -r -q kite-enterprise-windows-x64.zip kite-enterprise)
    else
      python3 -c "import shutil; shutil.make_archive(r'$OUT/kite-enterprise-windows-x64', 'zip', r'$OUT', 'kite-enterprise')"
    fi
    echo "Wrote $OUT/kite-enterprise-windows-x64.zip"
    ;;
  *)
    echo "Unsupported --os: $OS (use linux or windows)" >&2
    exit 1
    ;;
esac
