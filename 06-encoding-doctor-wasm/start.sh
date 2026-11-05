#!/usr/bin/env sh
# Encoding Doctor - Linux/macOS launcher for the browser UI
cd "$(dirname "$0")" || exit 1
echo "[start.sh] folder: $(pwd)"
if [ ! -f web/encdoc.wasm ] || [ ! -f web/wasm_exec.js ]; then
  echo "[start.sh] web/encdoc.wasm missing -> node scripts/build.mjs --wasm-only (needs Go 1.24+)"
  node scripts/build.mjs --wasm-only || exit 1
fi
node server.js --open "$@"
rc=$?
echo "[start.sh] exit code: $rc"
exit $rc
