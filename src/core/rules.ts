import { isArchiveFile, isVideoFile } from './torrent.js';
import type { RuleScore, TorrentMetadata } from './types.js';

const adTerms = [
  'QQ群', 'qq群', 'q群', '加群', '微信', '解压密码', '付费', '购买',
  '扫码', '会员', '广告', '最新地址', '水印', '招代理', '博彩',
];

export function scoreByRules(
  title: string,
  metadata: TorrentMetadata,
  keyword?: string,
): RuleScore {
  const reasons: string[] = [];
  let score = 55;
  const files = metadata.files;
  const videoFiles = files.filter((file) => isVideoFile(file.path));
  const archiveFiles = files.filter((file) => isArchiveFile(file.path));

  if (metadata.status !== 'ok') {
    reasons.push('metadata 未成功获取');
    score -= 35;
    return {
      accepted: false,
      score: Math.max(0, score),
      reasons,
      hardReject: true,
    };
  }

  if (videoFiles.length === 0) {
    reasons.push('未发现视频文件');
    score -= 45;
  } else {
    reasons.push(`发现 ${videoFiles.length} 个视频文件`);
    score += 20;
  }

  if (metadata.totalSize > 700 * 1024 ** 2) {
    reasons.push('总体积符合常见视频资源范围');
    score += 8;
  } else if (metadata.totalSize > 0) {
    reasons.push('总体积偏小');
    score -= 12;
  }

  if (archiveFiles.length > videoFiles.length) {
    reasons.push('压缩包数量多于视频文件');
    score -= 20;
  }

  if (metadata.totalSize > 0 && videoFiles.length > 0) {
    const videoBytes = videoFiles.reduce((sum, f) => sum + f.size, 0);
    const videoRatio = videoBytes / metadata.totalSize;
    if (videoRatio < 0.3) {
      reasons.push('视频文件占比低于30%');
      score -= 18;
    }
  }

  for (const file of videoFiles) {
    if (file.size < 50 * 1024 * 1024) {
      reasons.push(`视频文件 ${file.name} 体积过小（低于50MB）`);
      score -= 8;
      break;
    }
  }

  const lowerTitle = title.toLowerCase();
  const matchedAds = adTerms.filter((term) => lowerTitle.includes(term) || lowerTitle.includes(term.toLowerCase()));
  if (matchedAds.length > 0) {
    reasons.push(`标题包含疑似广告词：${matchedAds.join('、')}`);
    score -= 15;
  }

  if (keyword) {
    const kw = keyword.toLowerCase();
    const tl = title.toLowerCase();
    if (!tl.includes(kw) && keyword.length > 1) {
      const words = kw.split(/\s+/);
      let matches = 0;
      for (const w of words) {
        if (tl.includes(w)) matches++;
      }
      if (matches < words.length * 0.5) {
        reasons.push('标题与搜索词相似度低');
        score -= 12;
      }
    }
  }

  const normalized = Math.max(0, Math.min(100, score));

  return {
    accepted: videoFiles.length > 0 && normalized >= 20,
    score: normalized,
    reasons,
    hardReject: videoFiles.length === 0 && archiveFiles.length > videoFiles.length,
  };
}
