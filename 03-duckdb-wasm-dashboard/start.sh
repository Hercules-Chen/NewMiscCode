#!/usr/bin/env sh
# DuckDB-WASM Data Desk - Linux/macOS launcher
cd "$(dirname "$0")" || exit 1
echo "[start.sh] folder: $(pwd)"
if [ ! -f public/vendor/duckdb-eh.wasm ]; then
  echo "[start.sh] public/vendor missing -> npm install && npm run build"
  npm install && npm run build || exit 1
fi
node server.js --open "$@"
rc=$?
echo "[start.sh] exit code: $rc"
exit $rc
