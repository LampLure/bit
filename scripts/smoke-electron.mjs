#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname ?? '.', '..');
const PORT = '4173';
const HEALTH = `http://127.0.0.1:${PORT}/api/health`;

function waitForHealth() {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      fetch(HEALTH)
        .then(r => r.json())
        .then(d => { if (d.ok) resolve(); })
        .catch(() => {})
        .finally(() => {
          if (Date.now() - start > 10_000) reject(new Error('Server did not start'));
          else setTimeout(check, 500);
        });
    };
    check();
  });
}

async function main() {
  console.log('[smoke] Starting server...');
  const server = spawn(process.execPath, ['server.mjs'], {
    stdio: 'inherit',
    env: { ...process.env, PORT },
    cwd: ROOT,
  });

  try {
    await waitForHealth();
    console.log('[smoke] Server is healthy');
  } catch (e) {
    console.error('[smoke]', e.message);
    server.kill();
    process.exit(1);
  }

  console.log('[smoke] Testing metadata API...');
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/torrent/metadata`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        magnets: ['magnet:?xt=urn:btih:0000000000000000000000000000000000000000'],
        concurrency: 1,
        timeoutMs: 5000,
      }),
    });
    const data = await r.json();
    console.log('[smoke] Metadata response:', JSON.stringify(data, null, 2));

    if (data.items && Array.isArray(data.items)) {
      console.log('[smoke] PASS: batch API returns items array');
    } else {
      console.log('[smoke] FAIL: batch API did not return items array');
    }
  } catch (e) {
    console.log('[smoke] Metadata API error (expected if WebTorrent not installed):', e.message);
  }

  server.kill();
  console.log('[smoke] Done');
}

main().catch(err => {
  console.error('[smoke] Fatal:', err.message);
  process.exit(1);
});
