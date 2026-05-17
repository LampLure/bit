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

export async function analyzeMagnetMetadata(
  result: RawMagnetResult,
  timeoutMs: number,
): Promise<TorrentMetadata> {
  const parsed = parseMagnetUri(result.magnetUri);
  const timeout = new Promise<TorrentMetadata>((resolve) => {
    window.setTimeout(
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
    window.setTimeout(() => {
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
