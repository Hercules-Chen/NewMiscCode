#!/usr/bin/env sh
# Linux/macOS: dashboard + REST API + embedded worker. Extra args go to "wf serve".
cd "$(dirname "$0")" || exit 1
echo "[start.sh] folder: $(pwd)"
node bin/wf.mjs serve "$@"
rc=$?
echo "[start.sh] exit code: $rc"
exit $rc
