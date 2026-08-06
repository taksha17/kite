#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/env.sh"

# Keep the desktop responsive and memory-bounded while building:
# - nice/ionice deprioritize build work vs the UI
# - Node heap capped so Vite/tsc can't balloon
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=3072}"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-4}"

exec nice -n 10 ionice -c2 -n6 npm run tauri -- build "$@"
