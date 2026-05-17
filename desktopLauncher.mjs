import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

const PORT = process.env.PORT ?? '4173';
const HEALTH_URL = `http://127.0.0.1:${PORT}/api/health`;
const ROOT = resolve(import.meta.dirname ?? '.');

function findElectronBinary() {
  const candidates = [
    resolve(ROOT, 'node_modules', 'electron', 'dist', 'electron'),
    resolve(ROOT, 'node_modules', '.bin', 'electron'),
  ];
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  throw new Error(
    'Electron binary not found. Try: npm install electron\n' +
    'Or download manually: npx @electron/get --version=42.1.0'
  );
}

function waitForHealth(url, timeoutMs = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      fetch(url)
        .then((r) => r.json())
        .then((data) => {
          if (data.ok) resolve();
        })
        .catch(() => {})
        .finally(() => {
          if (Date.now() - start > timeoutMs) {
            reject(new Error('Server did not become healthy within timeout'));
            return;
          }
          setTimeout(check, 400);
        });
    };
    check();
  });
}

async function main() {
  console.log('[launcher] Starting server...');
  const server = spawn(process.execPath, ['server.mjs'], {
    stdio: 'inherit',
    env: { ...process.env, PORT },
    cwd: ROOT,
  });

  server.on('error', (err) => {
    console.error('[launcher] Server failed to start:', err.message);
    process.exit(1);
  });

  try {
    await waitForHealth(HEALTH_URL);
    console.log('[launcher] Server healthy, starting Electron...');
  } catch (err) {
    console.error('[launcher]', err.message);
    server.kill();
    process.exit(1);
  }

  const electronPath = findElectronBinary();
  console.log('[launcher] Using electron at:', electronPath);
  const electron = spawn(electronPath, ['electron/main.mjs'], {
    stdio: 'inherit',
    env: { ...process.env, PORT, ELECTRON_BACKEND_URL: `http://127.0.0.1:${PORT}` },
    cwd: ROOT,
  });

  electron.on('error', (err) => {
    console.error('[launcher] Electron failed:', err.message);
    server.kill();
    process.exit(1);
  });

  electron.on('exit', (code) => {
    console.log('[launcher] Electron exited, shutting down server...');
    server.kill();
    process.exit(code ?? 0);
  });

  const cleanup = () => {
    server.kill();
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch((err) => {
  console.error('[launcher] Fatal:', err.message);
  process.exit(1);
});
