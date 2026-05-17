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
    : { available: false, provider: 'webtorrent', error: loaded.error ?? 'Install WebTorrent to enable real DHT/tracker metadata: npm install webtorrent' };
}

export async function fetchTorrentMetadata(magnetUri, timeoutMs = 20_000) {
  const loaded = await loadWebTorrent();
  if (!loaded.available) return { ok: false, unavailable: true, error: loaded.error ?? 'WebTorrent is not installed.' };

  const client = new loaded.WebTorrent();
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      client.destroy();
      resolve({ ok: false, status: 'timeout', error: 'Timed out while fetching torrent metadata.' });
    }, timeoutMs);

    const torrent = client.add(magnetUri, { destroyStoreOnDestroy: true });
    torrent.on('metadata', () => {
      clearTimeout(timeout);
      for (const file of torrent.files) file.deselect?.();
      const files = torrent.files.map((file) => ({ path: file.path, bytes: file.length }));
      const payload = {
        ok: true,
        status: 'complete',
        magnetUri,
        infoHash: torrent.infoHash,
        displayName: torrent.name,
        files,
        totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
        seeders: torrent.numPeers,
      };
      client.destroy();
      resolve(payload);
    });
    torrent.on('error', (error) => {
      clearTimeout(timeout);
      client.destroy();
      resolve({ ok: false, status: 'failed', error: error.message });
    });
  });
}
