import type { TorrentFile, TorrentMetadata } from './types.js';
import { extractInfoHash } from './hash.js';
import { fetchTorrentMetadata as fetchTcMetadata } from './torrentClient.js';

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
    const items = await fetchTcMetadata([magnetUri], { concurrency: 1, timeoutMs });
    const payload = items[0];
    if (!payload) {
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
    return payload;
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
  return fetchTcMetadata(magnets, { concurrency, timeoutMs });
}
