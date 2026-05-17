#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

export ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}"

if [ ! -d node_modules ]; then
  echo "[start] Installing dependencies..."
  npm install
fi

npm run app
