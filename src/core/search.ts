import { scoreWithAi } from './ai.js';
import { scoreByRules } from './rules.js';
import { analyzeMany } from './torrent.js';
import { extractInfoHash, dedupeByInfoHash } from './hash.js';
import type { Adapter, AppSettings, FinalResult, ProgressItem, RawMagnetResult, RankedResult, TorrentMetadata } from './types.js';

export type ProgressCallback = (item: ProgressItem) => void;

export async function searchWithBrowser(
  keyword: string,
  adapters: Adapter[],
  settings: AppSettings,
  onProgress: ProgressCallback,
): Promise<FinalResult[]> {
  const activeAdapters = adapters.slice(0, Math.max(1, Math.min(4, settings.concurrency)));
  onProgress({ id: 'system-search', label: '搜索', phase: 'system', value: 0, status: 'running', message: `启动 ${activeAdapters.length} 个资源站任务` });

  const allRawResults: RawMagnetResult[] = [];
  const queue = [...activeAdapters];

  const workers = Array.from({ length: Math.min(settings.concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const adapter = queue.shift();
      if (!adapter) break;
      const panelId = activeAdapters.indexOf(adapter);

      onProgress({
        id: `panel-${panelId}`,
        label: adapter.name,
        phase: 'browser',
        value: 0.1,
        status: 'running',
        message: `正在打开 ${adapter.name}`,
      });

      try {
        const r = await fetch('/api/browser/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adapterId: adapter.id, keyword, panelId }),
        });
        const result = await r.json();

        if (result.status === 'need_human_verification') {
          onProgress({
            id: `panel-${panelId}`,
            label: adapter.name,
            phase: 'browser',
            value: 0.5,
            status: 'waiting',
            message: '等待用户完成人机验证',
          });
          allRawResults.push({
            id: `${adapter.id}-verification`,
            sourceAdapterId: adapter.id,
            sourceName: adapter.name,
            title: '等待验证',
            magnetUri: '',
            detailUrl: '',
          });
          continue;
        }

        if (result.status === 'failed') {
          onProgress({
            id: `panel-${panelId}`,
            label: adapter.name,
            phase: 'browser',
            value: 1,
            status: 'error',
            message: result.message ?? '搜索失败',
          });
          continue;
        }

        onProgress({
          id: `panel-${panelId}`,
          label: adapter.name,
          phase: 'browser',
          value: 0.8,
          status: 'running',
          message: result.message ?? `提取到 ${result.results?.length ?? 0} 条`,
        });

        allRawResults.push(...(result.results ?? []));

        onProgress({
          id: `panel-${panelId}`,
          label: adapter.name,
          phase: 'browser',
          value: 1,
          status: 'done',
          message: `搜索完成`,
        });
      } catch {
        onProgress({
          id: `panel-${panelId}`,
          label: adapter.name,
          phase: 'browser',
          value: 1,
          status: 'error',
          message: '搜索失败',
        });
      }
    }
  });

  await Promise.all(workers);

  const validResults = allRawResults.filter((r) => r.magnetUri && r.magnetUri.startsWith('magnet:'));
  const deduped = dedupeByInfoHash(validResults.map((r) => ({ ...r, magnet: r.magnetUri })));

  onProgress({ id: 'system-search', label: '搜索', phase: 'system', value: 1, status: 'done', message: `共提取 ${deduped.length} 条去重后磁力链接` });

  return rankResults(keyword, deduped as any as RawMagnetResult[], settings, onProgress);
}

async function rankResults(
  keyword: string,
  rawResults: RawMagnetResult[],
  settings: AppSettings,
  onProgress: ProgressCallback,
): Promise<FinalResult[]> {
  if (rawResults.length === 0) return [];

  onProgress({ id: 'system-metadata', label: 'Metadata', phase: 'system', value: 0, status: 'running', message: '正在获取 metadata（不下载文件内容）' });

  const magnets = rawResults.map((r) => r.magnetUri);
  const metadataResults = await analyzeMany(magnets, settings.torrentConcurrency ?? 4, settings.metadataTimeoutMs);

  onProgress({ id: 'system-metadata', label: 'Metadata', phase: 'system', value: 1, status: 'done', message: `metadata 获取完成` });

  onProgress({ id: 'system-rules', label: '规则预筛', phase: 'system', value: 0, status: 'running', message: '正在规则预筛' });

  const scoredCandidates: Array<{
    id: string;
    title: string;
    magnet: string;
    infoHash: string;
    files: typeof metadataResults[0]['files'];
    totalSize: number;
    ruleScore: number;
    ruleReasons: string[];
    rawResult: RawMagnetResult;
    metadata: TorrentMetadata;
  }> = [];

  for (let i = 0; i < rawResults.length; i++) {
    const raw = rawResults[i];
    const meta = metadataResults[i];
    if (!meta) continue;

    const ih = extractInfoHash(raw.magnetUri) ?? '';
    const ruleScoreResult = scoreByRules(raw.title, meta, keyword);

    if (ruleScoreResult.hardReject) continue;

    scoredCandidates.push({
      id: raw.id,
      title: raw.title,
      magnet: raw.magnetUri,
      infoHash: ih,
      files: meta.files,
      totalSize: meta.totalBytes,
      ruleScore: ruleScoreResult.score,
      ruleReasons: ruleScoreResult.reasons,
      rawResult: raw,
      metadata: meta,
    });
  }

  onProgress({ id: 'system-rules', label: '规则预筛', phase: 'system', value: 1, status: 'done', message: `规则预筛保留 ${scoredCandidates.length} 条` });

  onProgress({ id: 'system-ai', label: 'AI评分', phase: 'system', value: 0, status: 'running', message: '正在 AI 评分' });

  const aiScores = await scoreWithAi(scoredCandidates, {
    endpoint: settings.aiEndpoint,
    model: settings.aiModel,
    threshold: settings.confidenceThreshold,
  });

  onProgress({ id: 'system-ai', label: 'AI评分', phase: 'system', value: 1, status: 'done', message: `AI 评分完成` });

  const finalResults: FinalResult[] = [];

  for (const candidate of scoredCandidates) {
    const aiResult = aiScores.find((s) => s.id === candidate.id);
    const finalScore = aiResult?.finalScore ?? candidate.ruleScore;

    if (finalScore < settings.confidenceThreshold) continue;

    finalResults.push({
      id: candidate.id,
      title: candidate.title,
      magnet: candidate.magnet,
      finalScore,
      ruleScore: candidate.ruleScore,
      aiScore: aiResult?.aiScore ?? candidate.ruleScore,
      infoHash: candidate.infoHash,
      files: candidate.files,
      totalSize: candidate.totalSize,
      reasons: aiResult?.aiScoreDetail?.reasons ?? candidate.ruleReasons,
    });
  }

  finalResults.sort((a, b) => b.finalScore - a.finalScore);

  return finalResults;
}

export async function executeSearch(
  query: string,
  adapters: Adapter[],
  settings: AppSettings,
  onProgress: ProgressCallback,
): Promise<FinalResult[]> {
  return searchWithBrowser(query, adapters, settings, onProgress);
}
