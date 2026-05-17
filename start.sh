#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

ELECTRON_VERSION="42.1.0"
ELECTRON_DIST="node_modules/electron/dist"

if [ ! -d node_modules ]; then
  echo "[start] Installing dependencies..."
  ELECTRON_MIRROR="" npm install 2>/dev/null || npm install
fi

if [ ! -f "${ELECTRON_DIST}/electron" ]; then
  echo "[start] Downloading Electron ${ELECTRON_VERSION}..."
  mkdir -p "${ELECTRON_DIST}"
  ZIP="/tmp/electron-v${ELECTRON_VERSION}.zip"
  MIRROR_URL="https://npmmirror.com/mirrors/electron/v${ELECTRON_VERSION}/electron-v${ELECTRON_VERSION}-linux-x64.zip"
  GH_URL="https://github.com/electron/electron/releases/download/v${ELECTRON_VERSION}/electron-v${ELECTRON_VERSION}-linux-x64.zip"

  curl -fSL -o "$ZIP" "$MIRROR_URL" 2>/dev/null || curl -fSL -o "$ZIP" "$GH_URL"
  unzip -oq "$ZIP" -d "${ELECTRON_DIST}"
  rm -f "$ZIP"
  chmod +x "${ELECTRON_DIST}/electron"
  echo "[start] Electron binary installed."
fi

npm run app
