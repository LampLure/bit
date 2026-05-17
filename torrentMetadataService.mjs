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

function parseExtension(path) {
  const name = path.split(/[\\/]/).pop() ?? path;
  return name.split('.').pop()?.toLowerCase() ?? '';
}

function buildFileEntry(file) {
  const path = file.path;
  const name = path.split(/[\\/]/).pop() ?? path;
  const size = file.length;
  const extension = parseExtension(path);
  return { path, name, size, extension, bytes: size };
}

export async function fetchTorrentMetadata(magnetUri, timeoutMs = 45_000) {
  const loaded = await loadWebTorrent();
  if (!loaded.available) return { magnet: magnetUri, infoHash: '', name: '', files: [], totalSize: 0, status: 'error', elapsedMs: 0, error: loaded.error };

  const startTime = Date.now();

  return new Promise((resolve) => {
    let client;

    try {
      client = new loaded.WebTorrent();
    } catch (e) {
      resolve({ magnet: magnetUri, infoHash: '', name: '', files: [], totalSize: 0, status: 'invalid', elapsedMs: Date.now() - startTime, error: e.message });
      return;
    }

    const timeout = setTimeout(() => {
      try { client.destroy(); } catch {}
      resolve({ magnet: magnetUri, infoHash: '', name: '', files: [], totalSize: 0, status: 'timeout', elapsedMs: Date.now() - startTime, error: 'Timed out while fetching torrent metadata.' });
    }, timeoutMs);

    try {
      const torrent = client.add(magnetUri, { destroyStoreOnDestroy: true });

      torrent.on('metadata', () => {
        clearTimeout(timeout);
        for (const file of torrent.files) {
          file.deselect?.();
        }
        const files = torrent.files.map(buildFileEntry);
        const payload = {
          magnet: magnetUri,
          infoHash: torrent.infoHash,
          name: torrent.name ?? '',
          files,
          totalSize: files.reduce((sum, f) => sum + f.size, 0),
          status: 'ok',
          elapsedMs: Date.now() - startTime,
        };
        try { client.destroy(); } catch {}
        resolve(payload);
      });

      torrent.on('error', (error) => {
        clearTimeout(timeout);
        try { client.destroy(); } catch {}
        resolve({ magnet: magnetUri, infoHash: torrent?.infoHash || '', name: torrent?.name || '', files: [], totalSize: 0, status: 'error', elapsedMs: Date.now() - startTime, error: error.message });
      });

      torrent.on('warning', () => {});
    } catch (e) {
      clearTimeout(timeout);
      try { client.destroy(); } catch {}
      resolve({ magnet: magnetUri, infoHash: '', name: '', files: [], totalSize: 0, status: 'invalid', elapsedMs: Date.now() - startTime, error: e.message });
    }
  });
}

export async function fetchManyTorrentMetadata(magnets, concurrency = 4, timeoutMs = 45_000) {
  const results = new Array(magnets.length);
  let cursor = 0;

  async function worker() {
    while (cursor < magnets.length) {
      const idx = cursor;
      cursor += 1;
      results[idx] = await fetchTorrentMetadata(magnets[idx], timeoutMs);
    }
  }

  const workerCount = Math.min(concurrency, magnets.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}
