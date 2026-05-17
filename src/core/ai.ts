import type { AiScore, RankedResult, RawMagnetResult, RuleScore, TorrentMetadata } from './types.js';

export interface AiScorerOptions {
  endpoint: string;
  model: string;
  threshold: number;
}

function localHeuristicScore(result: RawMagnetResult, metadata: TorrentMetadata, ruleScore: RuleScore): AiScore {
  const qualityBoost = /2160p|4k|1080p|remux|web-dl|bluray/i.test(result.title) ? 0.12 : 0;
  const relevancePenalty = /sample|trailer|预告/i.test(result.title) ? 0.22 : 0;
  const confidence = Math.max(0, Math.min(1, ruleScore.score + qualityBoost - relevancePenalty));
  return {
    confidence: Number(confidence.toFixed(2)),
    verdict: confidence >= 0.82 ? 'excellent' : confidence >= 0.65 ? 'good' : confidence >= 0.45 ? 'uncertain' : 'rejected',
    reasons: [
      '本地启发式评分已完成',
      ...ruleScore.reasons.slice(0, 3),
      metadata.files.length > 0 ? `文件数：${metadata.files.length}` : '无文件列表',
    ],
  };
}

export async function scoreWithAi(
  candidates: Array<{ result: RawMagnetResult; metadata: TorrentMetadata; ruleScore: RuleScore }>,
  options: AiScorerOptions,
): Promise<RankedResult[]> {
  const prompt = JSON.stringify(
    candidates.map((item) => ({
      title: item.result.title,
      files: item.metadata.files.slice(0, 20),
      totalBytes: item.metadata.totalBytes,
      ruleScore: item.ruleScore.score,
    })),
  ).slice(0, 32_000);

  try {
    if (options.endpoint) {
      const response = await fetch(options.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: options.model,
          stream: false,
          prompt: `请只输出 JSON 数组，对每个候选资源给出 confidence(0-1)、verdict、reasons。候选：${prompt}`,
        }),
      });
      if (response.ok) {
        const payload = await response.json();
        const text = String(payload.content ?? payload.response ?? payload.text ?? '');
        const parsed = JSON.parse(text) as AiScore[];
        return candidates
          .map((item, index) => ({ ...item.result, metadata: item.metadata, ruleScore: item.ruleScore, aiScore: parsed[index] ?? localHeuristicScore(item.result, item.metadata, item.ruleScore) }))
          .filter((item) => item.aiScore.confidence >= options.threshold)
          .sort((a, b) => b.aiScore.confidence - a.aiScore.confidence);
      }
    }
  } catch {
    // Fall back to the deterministic local heuristic when llama.cpp is not running.
  }

  return candidates
    .map((item) => ({ ...item.result, metadata: item.metadata, ruleScore: item.ruleScore, aiScore: localHeuristicScore(item.result, item.metadata, item.ruleScore) }))
    .filter((item) => item.aiScore.confidence >= options.threshold)
    .sort((a, b) => b.aiScore.confidence - a.aiScore.confidence);
}
