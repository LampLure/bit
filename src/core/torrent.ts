import type { RawMagnetResult, TorrentFile, TorrentMetadata } from './types.js';

const videoExtensions = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.m4v', '.ts', '.webm'];
const archiveExtensions = ['.zip', '.rar', '.7z', '.tar', '.gz'];

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

function estimateFileFromTitle(title: string, magnetUri: string): TorrentFile[] {
  const decodedTitle = decodeURIComponent(parseMagnetUri(magnetUri).displayName ?? title).trim();
  const lower = decodedTitle.toLowerCase();
  const hasVideoExt = videoExtensions.some((ext) => lower.includes(ext));
  const name = hasVideoExt ? decodedTitle : `${decodedTitle || 'video'}.mkv`;
  const sizeHint = /2160p|4k/i.test(decodedTitle)
    ? 12 * 1024 ** 3
    : /1080p/i.test(decodedTitle)
      ? 4 * 1024 ** 3
      : /720p/i.test(decodedTitle)
        ? 1800 * 1024 ** 2
        : 900 * 1024 ** 2;
  return [{ path: name, bytes: sizeHint }];
}


async function fetchServerMetadata(magnetUri: string, timeoutMs: number): Promise<TorrentMetadata | undefined> {
  if (typeof fetch !== 'function') return undefined;
  try {
    const response = await fetch('/api/torrent/metadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ magnetUri, timeoutMs }),
    });
    if (!response.ok) return undefined;
    const payload = await response.json() as Partial<TorrentMetadata> & { ok?: boolean; unavailable?: boolean; error?: string };
    if (!payload.ok || payload.unavailable || !payload.files) return undefined;
    return {
      magnetUri,
      infoHash: payload.infoHash,
      displayName: payload.displayName,
      files: payload.files,
      totalBytes: payload.totalBytes ?? payload.files.reduce((sum, file) => sum + file.bytes, 0),
      seeders: payload.seeders,
      status: 'complete',
    };
  } catch {
    return undefined;
  }
}

export async function analyzeMagnetMetadata(
  result: RawMagnetResult,
  timeoutMs: number,
): Promise<TorrentMetadata> {
  const serverMetadata = await fetchServerMetadata(result.magnetUri, timeoutMs);
  if (serverMetadata) return serverMetadata;

  const parsed = parseMagnetUri(result.magnetUri);
  const timeout = new Promise<TorrentMetadata>((resolve) => {
    globalThis.setTimeout(
      () =>
        resolve({
          magnetUri: result.magnetUri,
          infoHash: parsed.infoHash,
          displayName: parsed.displayName,
          files: [],
          totalBytes: 0,
          status: 'timeout',
          error: 'metadata 获取超时；当前前端原型不会下载文件。',
        }),
      timeoutMs,
    );
  });

  const metadata = new Promise<TorrentMetadata>((resolve) => {
    globalThis.setTimeout(() => {
      const files = estimateFileFromTitle(result.title, result.magnetUri);
      resolve({
        magnetUri: result.magnetUri,
        infoHash: parsed.infoHash,
        displayName: parsed.displayName ?? result.title,
        files,
        totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
        seeders: Math.max(1, Math.floor((parsed.infoHash?.length ?? result.title.length) % 200)),
        status: 'complete',
      });
    }, 250 + Math.random() * 700);
  });

  return Promise.race([metadata, timeout]);
}

export function isVideoFile(path: string): boolean {
  return videoExtensions.some((ext) => path.toLowerCase().endsWith(ext));
}

export function isArchiveFile(path: string): boolean {
  return archiveExtensions.some((ext) => path.toLowerCase().endsWith(ext));
}
