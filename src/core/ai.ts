import type { AiScore, RuleScore, TorrentFile } from './types.js';

export interface AiScorerOptions {
  endpoint: string;
  model: string;
  threshold: number;
}

interface Candidate {
  id: string;
  title: string;
  magnet: string;
  infoHash: string;
  files: TorrentFile[];
  totalSize: number;
  ruleScore: number;
  ruleReasons: string[];
}

interface AiScoreItem {
  id: string;
  score: number;
  is_real_video_resource: boolean;
  is_ad_or_trap: boolean;
  reason: string;
}

const MAX_TOKENS = 24000;
const CHARS_PER_TOKEN = 4;

function truncateFileName(name: string): string {
  if (name.length <= 160) return name;
  return name.slice(0, 157) + '...';
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function splitIntoBatches(candidates: Candidate[], maxBatchSize: number): Candidate[][] {
  const batches: Candidate[][] = [];
  let current: Candidate[] = [];
  let currentTokens = 0;

  for (const c of candidates) {
    const filesText = c.files.slice(0, 80).map((f) => truncateFileName(f.path)).join(', ');
    const itemText = `title:${c.title} files:[${filesText}] size:${c.totalSize} ruleScore:${c.ruleScore}`;
    const tokens = estimateTokens(itemText);

    if (current.length >= maxBatchSize || (currentTokens + tokens > MAX_TOKENS - 4000 && current.length > 0)) {
      batches.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(c);
    currentTokens += tokens;
  }

  if (current.length > 0) batches.push(current);
  return batches;
}

function localHeuristicScore(candidate: Candidate): AiScore {
  let score = candidate.ruleScore;
  const reasons: string[] = [];

  const qualityBoost = /2160p|4k|1080p|remux|web-dl|bluray/i.test(candidate.title) ? 12 : 0;
  const relevancePenalty = /sample|trailer|预告/i.test(candidate.title) ? 15 : 0;
  score = Math.max(0, Math.min(100, score + qualityBoost - relevancePenalty));

  const verdict = score >= 82 ? 'excellent' : score >= 65 ? 'good' : score >= 45 ? 'uncertain' : 'rejected';

  return {
    confidence: score / 100,
    verdict,
    reasons: ['本地启发式评分已完成', ...candidate.ruleReasons.slice(0, 3)],
    score,
    is_real_video_resource: score >= 50,
    is_ad_or_trap: score < 20,
    reason: score >= 70 ? '规则匹配度高' : score >= 40 ? '部分匹配' : '低匹配度',
  };
}

function parseAiResponse(text: string): AiScoreItem[] | null {
  try {
    const cleaned = text.replace(/```json\s*/i, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (parsed.items && Array.isArray(parsed.items)) return parsed.items;
    return null;
  } catch {
    try {
      const arr = JSON.parse(text);
      if (Array.isArray(arr)) return arr;
      return null;
    } catch {
      return null;
    }
  }
}

export async function scoreWithAi(
  candidates: Array<{ id: string; title: string; magnet: string; infoHash: string; files: TorrentFile[]; totalSize: number; ruleScore: number; ruleReasons: string[] }>,
  options: AiScorerOptions,
): Promise<Array<{ id: string; finalScore: number; ruleScore: number; aiScore: number; aiScoreDetail: AiScore }>> {
  if (candidates.length === 0) return [];

  const batches = splitIntoBatches(candidates, 15);
  const allResults: Array<{ id: string; finalScore: number; ruleScore: number; aiScore: number; aiScoreDetail: AiScore }> = [];

  for (const batch of batches) {
    const candidateData = batch.map((c) => ({
      id: c.id,
      title: c.title,
      magnet: c.magnet,
      files: c.files.slice(0, 80).map((f) => ({ path: truncateFileName(f.path), size: f.size })),
      totalSize: c.totalSize,
      ruleScore: c.ruleScore,
    }));

    const prompt = `你是一个资源质量评估助手。请严格以JSON格式输出评分结果。

候选资源列表：
${JSON.stringify(candidateData, null, 2)}

请输出JSON:
{
  "items": [
    {
      "id": "candidate_id",
      "score": 0,
      "is_real_video_resource": true,
      "is_ad_or_trap": false,
      "reason": "简短原因"
    }
  ]
}

评分标准：
- score: 0-100，基于标题、文件名、文件大小判断是否是真实视频资源
- is_real_video_resource: 是否是真实视频资源
- is_ad_or_trap: 是否是广告或陷阱资源
- reason: 简短评分理由（20字以内）`;

    let aiScores: AiScoreItem[] | null = null;

    if (options.endpoint) {
      try {
        const response = await fetch(options.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: options.model,
            stream: false,
            prompt,
            temperature: 0.1,
            max_tokens: 2048,
          }),
        });

        if (response.ok) {
          const payload = await response.json();
          const text = String(payload.content ?? payload.response ?? payload.text ?? payload.completion ?? '');
          aiScores = parseAiResponse(text);
        }
      } catch {}
    }

    for (const candidate of batch) {
      const heuristic = localHeuristicScore(candidate);
      const aiItem = aiScores?.find((item) => item.id === candidate.id);

      if (aiItem && typeof aiItem.score === 'number') {
        const aiScore = Math.max(0, Math.min(100, aiItem.score));
        const finalScore = Math.round(candidate.ruleScore * 0.45 + aiScore * 0.55);
        allResults.push({
          id: candidate.id,
          finalScore,
          ruleScore: candidate.ruleScore,
          aiScore,
          aiScoreDetail: {
            confidence: aiScore / 100,
            verdict: aiScore >= 82 ? 'excellent' : aiScore >= 65 ? 'good' : aiScore >= 45 ? 'uncertain' : 'rejected',
            reasons: [aiItem.reason || 'AI评分完成', ...candidate.ruleReasons.slice(0, 2)],
            score: aiScore,
            is_real_video_resource: aiItem.is_real_video_resource ?? false,
            is_ad_or_trap: aiItem.is_ad_or_trap ?? false,
            reason: aiItem.reason || 'AI评分完成',
          },
        });
      } else {
        allResults.push({
          id: candidate.id,
          finalScore: Math.round(heuristic.score),
          ruleScore: candidate.ruleScore,
          aiScore: heuristic.score,
          aiScoreDetail: heuristic,
        });
      }
    }
  }

  return allResults;
}

export function isAiAvailable(endpoint: string): boolean {
  return !!endpoint && endpoint.length > 0;
}
