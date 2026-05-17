#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "[start] Installing dependencies..."
  ELECTRON_MIRROR="" npm install
fi

ELECTRON_EXEC="node_modules/electron/dist/electron"
if [ ! -f "$ELECTRON_EXEC" ]; then
  echo "[start] Electron binary missing, re-downloading from GitHub..."
  ELECTRON_MIRROR="" npm install electron 2>/dev/null || true
fi
if [ ! -f "$ELECTRON_EXEC" ]; then
  echo "[start] ERROR: Electron binary not installed."
  echo "  Try: ELECTRON_MIRROR='' npm install electron"
  echo "  Or download from: https://github.com/electron/electron/releases"
  exit 1
fi

npm run app
