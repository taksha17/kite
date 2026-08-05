#!/usr/bin/env bash
# Route build caches off the small Ubuntu root partition onto New Volume1.
# Works when sourced or executed.
_ENV_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$_ENV_DIR/.." && pwd)"
CACHE="$ROOT/.cache"

mkdir -p "$CACHE/tmp" "$CACHE/npm" "$CACHE/cargo-home" "$CACHE/cargo-target" "$CACHE/xdg-cache"

export TMPDIR="$CACHE/tmp"
export TMP="$CACHE/tmp"
export TEMP="$CACHE/tmp"
export npm_config_cache="$CACHE/npm"
export CARGO_HOME="$CACHE/cargo-home"
export CARGO_TARGET_DIR="$CACHE/cargo-target"
export XDG_CACHE_HOME="$CACHE/xdg-cache"

# Keep rustup / cargo toolchain binaries discoverable
if [ -d "$HOME/.cargo/bin" ]; then
  export PATH="$HOME/.cargo/bin:$PATH"
fi
if [ -d "$CARGO_HOME/bin" ]; then
  export PATH="$CARGO_HOME/bin:$PATH"
fi

cd "$ROOT"
