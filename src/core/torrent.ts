import type { TorrentFile, TorrentMetadata } from './types.js';
import { extractInfoHash } from './hash.js';

const videoExtensions = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.m4v', '.ts', '.webm', '.flv'];
const archiveExtensions = ['.zip', '.rar', '.7z', '.tar', '.gz', '.iso'];

export function parseMagnetUri(magnetUri: string): { infoHash?: string; displayName?: string } {
  try {
    const url = new URL(magnetUri);
    if (url.protocol !== 'magnet:') return {};
    const xt = url.searchParams.get('xt') ?? undefined;
    const infoHash = xt?.startsWith('urn:btih:') ? xt.replace('urn:btih:', '') : undefined;
    return {
      infoHash,
      displayName: url.searchParams.get('dn') ?? undefined,
    };
  } catch {
    return {};
  }
}

export async function analyzeMagnetMetadata(
  magnetUri: string,
  timeoutMs: number,
): Promise<TorrentMetadata> {
  const ih = extractInfoHash(magnetUri) ?? '';
  if (!ih) {
    return {
      magnet: magnetUri,
      magnetUri,
      infoHash: '',
      name: '',
      files: [],
      totalBytes: 0,
      totalSize: 0,
      status: 'invalid',
      elapsedMs: 0,
    };
  }

  try {
    const response = await fetch('/api/torrent/metadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ magnetUri, timeoutMs }),
    });
    if (!response.ok) {
      return {
        magnet: magnetUri,
        magnetUri,
        infoHash: ih,
        name: '',
        files: [],
        totalBytes: 0,
        totalSize: 0,
        status: 'error',
        elapsedMs: 0,
      };
    }
    const payload = await response.json();

    if (!payload.ok || payload.unavailable) {
      return {
        magnet: magnetUri,
        magnetUri,
        infoHash: payload.infoHash ?? ih,
        name: payload.displayName ?? '',
        displayName: payload.displayName,
        files: [],
        totalBytes: payload.totalBytes ?? 0,
        totalSize: payload.totalBytes ?? 0,
        status: payload.status === 'timeout' ? 'timeout' : 'error',
        elapsedMs: payload.elapsedMs ?? 0,
        error: payload.error,
      };
    }

    const files: TorrentFile[] = (payload.files ?? []).map((f: any) => ({
      path: f.path ?? '',
      name: f.path?.split(/[\\/]/).pop() ?? '',
      size: f.bytes ?? f.length ?? 0,
      extension: (f.path ?? '').split('.').pop()?.toLowerCase() ?? '',
      bytes: f.bytes ?? f.length ?? 0,
    }));

    return {
      magnet: magnetUri,
      magnetUri,
      infoHash: payload.infoHash ?? ih,
      name: payload.displayName ?? '',
      displayName: payload.displayName,
      files,
      totalBytes: payload.totalBytes ?? 0,
      totalSize: payload.totalBytes ?? 0,
      seeders: payload.seeders,
      peers: payload.peers,
      status: 'ok',
      elapsedMs: payload.elapsedMs ?? 0,
    };
  } catch {
    return {
      magnet: magnetUri,
      magnetUri,
      infoHash: ih,
      name: '',
      files: [],
      totalBytes: 0,
      totalSize: 0,
      status: 'error',
      elapsedMs: 0,
    };
  }
}

export function isVideoFile(path: string): boolean {
  return videoExtensions.some((ext) => path.toLowerCase().endsWith(ext));
}

export function isArchiveFile(path: string): boolean {
  return archiveExtensions.some((ext) => path.toLowerCase().endsWith(ext));
}

export async function analyzeMany(
  magnets: string[],
  concurrency: number,
  timeoutMs: number,
): Promise<TorrentMetadata[]> {
  const results: TorrentMetadata[] = [];
  for (let i = 0; i < magnets.length; i += concurrency) {
    const batch = magnets.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map((m) => analyzeMagnetMetadata(m, timeoutMs)));
    results.push(...batchResults);
  }
  return results;
}
