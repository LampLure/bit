import type { TorrentMetadata } from './types.js';

export async function fetchTorrentMetadata(
  magnets: string[],
  options: { concurrency: number; timeoutMs: number },
): Promise<TorrentMetadata[]> {
  if (magnets.length === 0) return [];

  const batches: string[][] = [];
  for (let i = 0; i < magnets.length; i += options.concurrency) {
    batches.push(magnets.slice(i, i + options.concurrency));
  }

  const results: TorrentMetadata[] = [];

  for (const batch of batches) {
    const batchResults = await Promise.all(
      batch.map((magnet) => fetchSingleMetadata(magnet, options.timeoutMs)),
    );
    results.push(...batchResults);
  }

  return results;
}

async function fetchSingleMetadata(magnet: string, timeoutMs: number): Promise<TorrentMetadata> {
  try {
    const r = await fetch('/api/torrent/metadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ magnetUri: magnet, timeoutMs }),
    });
    if (!r.ok) {
      return {
        magnet,
        magnetUri: magnet,
        infoHash: '',
        name: '',
        files: [],
        totalBytes: 0,
        totalSize: 0,
        status: 'error',
        elapsedMs: 0,
      };
    }
    const payload = await r.json();
    if (!payload.ok) {
      return {
        magnet,
        magnetUri: magnet,
        infoHash: payload.infoHash ?? '',
        name: payload.displayName ?? '',
        files: payload.files ?? [],
        totalBytes: payload.totalBytes ?? 0,
        totalSize: payload.totalBytes ?? 0,
        status: payload.status === 'timeout' ? 'timeout' : payload.status === 'failed' ? 'error' : 'error',
        elapsedMs: 0,
        error: payload.error,
      };
    }
    return {
      magnet,
      magnetUri: magnet,
      infoHash: payload.infoHash ?? '',
      name: payload.displayName ?? '',
      displayName: payload.displayName,
      files: (payload.files ?? []).map((f: any) => ({
        path: f.path ?? '',
        name: f.path?.split(/[\\/]/).pop() ?? '',
        size: f.bytes ?? f.length ?? 0,
        extension: (f.path ?? '').split('.').pop()?.toLowerCase() ?? '',
        bytes: f.bytes ?? f.length ?? 0,
      })),
      totalBytes: payload.totalBytes ?? 0,
      totalSize: payload.totalBytes ?? 0,
      seeders: payload.seeders,
      peers: payload.peers,
      status: 'ok',
      elapsedMs: 0,
    };
  } catch {
    return {
      magnet,
      magnetUri: magnet,
      infoHash: '',
      name: '',
      files: [],
      totalBytes: 0,
      totalSize: 0,
      status: 'error',
      elapsedMs: 0,
    };
  }
}
