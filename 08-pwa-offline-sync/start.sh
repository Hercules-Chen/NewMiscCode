#!/usr/bin/env sh
# Linux/macOS launcher: ./start.sh [--port 8808] [--debug]
cd "$(dirname "$0")" || exit 1
echo "[08-pwa-offline-sync] folder: $(pwd)"
exec node --disable-warning=ExperimentalWarning src/cli.js "$@"
