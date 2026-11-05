#!/usr/bin/env sh
# Encoding Doctor - build wasm + native CLI (+ Windows exe). Needs Go 1.24+ and Node 18+.
cd "$(dirname "$0")" || exit 1
echo "[build.sh] folder: $(pwd)"
node scripts/build.mjs --windows "$@"
rc=$?
echo "[build.sh] exit code: $rc"
exit $rc
