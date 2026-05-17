@echo off
cd /d %~dp0

if not exist node_modules (
  echo [start] Installing dependencies...
  npm install
)

npm run app
pause
