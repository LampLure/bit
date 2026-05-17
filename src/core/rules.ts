import { isArchiveFile, isVideoFile } from './torrent.js';
import type { RawMagnetResult, RuleScore, TorrentMetadata } from './types.js';

const adTerms = ['广告', 'qq群', 'q群', '微信', '付费', '博彩', '最新地址', '水印', '招代理'];

export function scoreByRules(result: RawMagnetResult, metadata: TorrentMetadata): RuleScore {
  const reasons: string[] = [];
  let score = 0.55;
  const files = metadata.files;
  const videoFiles = files.filter((file) => isVideoFile(file.path));
  const archiveFiles = files.filter((file) => isArchiveFile(file.path));

  if (metadata.status !== 'complete') {
    reasons.push('metadata 未成功获取');
    score -= 0.35;
  }

  if (videoFiles.length === 0) {
    reasons.push('未发现视频文件');
    score -= 0.45;
  } else {
    reasons.push(`发现 ${videoFiles.length} 个视频文件`);
    score += 0.25;
  }

  if (metadata.totalBytes > 700 * 1024 ** 2) {
    reasons.push('总体积符合常见视频资源范围');
    score += 0.1;
  } else if (metadata.totalBytes > 0) {
    reasons.push('总体积偏小');
    score -= 0.15;
  }

  if (archiveFiles.length > videoFiles.length) {
    reasons.push('压缩包数量多于视频文件');
    score -= 0.2;
  }

  const title = result.title.toLowerCase();
  const matchedAds = adTerms.filter((term) => title.includes(term));
  if (matchedAds.length > 0) {
    reasons.push(`标题包含疑似广告词：${matchedAds.join('、')}`);
    score -= 0.25;
  }

  if ((metadata.seeders ?? 0) > 30) {
    reasons.push('活跃度较高');
    score += 0.08;
  }

  const normalized = Math.max(0, Math.min(1, Number(score.toFixed(2))));
  return {
    accepted: normalized >= 0.45 && videoFiles.length > 0,
    score: normalized,
    reasons,
  };
}
