import type { TorrentMetadata } from './types.js';

export async function fetchTorrentMetadata(
  magnets: string[],
  options: { concurrency: number; timeoutMs: number },
): Promise<TorrentMetadata[]> {
  if (magnets.length === 0) return [];

  const r = await fetch('/api/torrent/metadata', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      magnets,
      concurrency: options.concurrency,
      timeoutMs: options.timeoutMs,
    }),
  });

  if (!r.ok) {
    return magnets.map((magnet) => ({
      magnet,
      magnetUri: magnet,
      infoHash: '',
      name: '',
      files: [],
      totalSize: 0,
      status: 'error' as const,
      elapsedMs: 0,
    }));
  }

  const payload = await r.json();
  const items = (payload.items ?? []) as any[];

  return items.map((item: any) => ({
    magnet: item.magnet ?? '',
    magnetUri: item.magnetUri ?? item.magnet ?? '',
    infoHash: item.infoHash ?? '',
    name: item.name ?? item.displayName ?? '',
    files: (item.files ?? []).map((f: any) => ({
      path: f.path ?? '',
      name: f.name ?? f.path?.split(/[\\/]/).pop() ?? '',
      size: f.size ?? f.bytes ?? f.length ?? 0,
      extension: f.extension ?? (f.path ?? '').split('.').pop()?.toLowerCase() ?? '',
      bytes: f.bytes ?? f.size ?? f.length ?? 0,
    })),
    totalSize: item.totalSize ?? item.totalBytes ?? 0,
    status: (item.status === 'ok' ? 'ok' :
              item.status === 'timeout' ? 'timeout' :
              item.status === 'invalid' ? 'invalid' :
              item.status === 'no_metadata' ? 'no_metadata' :
              'error') as TorrentMetadata['status'],
    elapsedMs: item.elapsedMs ?? 0,
    seeders: item.seeders,
    error: item.error,
  }));
}
