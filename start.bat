@echo off
cd /d %~dp0

set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/

if not exist node_modules (
  echo [start] Installing dependencies...
  npm install
)

npm run app
pause
