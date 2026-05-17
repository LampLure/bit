let webTorrentPromise;

async function loadWebTorrent() {
  webTorrentPromise ??= import('webtorrent').catch((error) => ({ error }));
  const loaded = await webTorrentPromise;
  if (loaded.error) return { available: false, error: loaded.error.message };
  return { available: true, WebTorrent: loaded.default ?? loaded.WebTorrent ?? loaded };
}

export async function torrentMetadataStatus() {
  const loaded = await loadWebTorrent();
  return loaded.available
    ? { available: true, provider: 'webtorrent' }
    : { available: false, provider: 'webtorrent', error: loaded.error ?? 'Install WebTorrent: npm install webtorrent' };
}

export async function fetchTorrentMetadata(magnetUri, timeoutMs = 45_000) {
  const loaded = await loadWebTorrent();
  if (!loaded.available) return { ok: false, unavailable: true, error: loaded.error ?? 'WebTorrent is not installed.' };

  const startTime = Date.now();

  return new Promise((resolve) => {
    let client;

    try {
      client = new loaded.WebTorrent();
    } catch (e) {
      resolve({ ok: false, status: 'invalid', error: e.message, elapsedMs: Date.now() - startTime });
      return;
    }

    const timeout = setTimeout(() => {
      try { client.destroy(); } catch {}
      resolve({ ok: false, status: 'timeout', error: 'Timed out while fetching torrent metadata.', elapsedMs: Date.now() - startTime });
    }, timeoutMs);

    try {
      const torrent = client.add(magnetUri, { destroyStoreOnDestroy: true });

      torrent.on('metadata', () => {
        clearTimeout(timeout);
        for (const file of torrent.files) {
          file.deselect?.();
        }
        const files = torrent.files.map((file) => ({
          path: file.path,
          bytes: file.length,
        }));
        const payload = {
          ok: true,
          status: 'ok',
          magnetUri,
          infoHash: torrent.infoHash,
          displayName: torrent.name,
          files,
          totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
          seeders: torrent.numPeers,
          elapsedMs: Date.now() - startTime,
        };
        try { client.destroy(); } catch {}
        resolve(payload);
      });

      torrent.on('error', (error) => {
        clearTimeout(timeout);
        try { client.destroy(); } catch {}
        resolve({ ok: false, status: 'error', error: error.message, infoHash: torrent?.infoHash, elapsedMs: Date.now() - startTime });
      });

      torrent.on('warning', () => {});
    } catch (e) {
      clearTimeout(timeout);
      try { client.destroy(); } catch {}
      resolve({ ok: false, status: 'invalid', error: e.message, elapsedMs: Date.now() - startTime });
    }
  });
}

export async function fetchManyTorrentMetadata(magnets, concurrency = 4, timeoutMs = 45_000) {
  const results = [];
  for (let i = 0; i < magnets.length; i += concurrency) {
    const batch = magnets.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map((m) => fetchTorrentMetadata(m, timeoutMs)));
    results.push(...batchResults);
  }
  return results;
}
