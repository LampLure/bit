import { scoreWithAi } from './ai.js';
import { scoreByRules } from './rules.js';
import { analyzeMagnetMetadata } from './torrent.js';
import type { AppSettings, ProgressItem, RankedResult, RawMagnetResult, SiteAdapter } from './types.js';

export type ProgressCallback = (item: ProgressItem) => void;

function demoMagnet(title: string, salt: string): string {
  const hash = Array.from(`${title}-${salt}`)
    .map((char) => char.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('')
    .padEnd(40, '0')
    .slice(0, 40);
  return `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}`;
}

async function runAdapterSearch(adapter: SiteAdapter, query: string, index: number, onProgress: ProgressCallback): Promise<RawMagnetResult[]> {
  const progressId = `browser-${adapter.id}`;
  onProgress({ id: progressId, label: adapter.name, phase: 'browser', value: 0.1, status: 'running', message: '加载资源站首页' });
  await new Promise((resolve) => window.setTimeout(resolve, 500 + index * 150));

  const maybeCloudflare = /cloudflare|cf-|just a moment/i.test(adapter.homeUrl);
  if (maybeCloudflare) {
    onProgress({ id: progressId, label: adapter.name, phase: 'browser', value: 0.35, status: 'waiting', message: '检测到 Cloudflare，请在浏览器窗格手动验证' });
    await new Promise((resolve) => window.setTimeout(resolve, 1200));
  }

  onProgress({ id: progressId, label: adapter.name, phase: 'browser', value: 0.65, status: 'running', message: '执行 adapter 搜索并抓取详情页磁力链接' });
  await new Promise((resolve) => window.setTimeout(resolve, 700));

  const resultCount = 2 + ((query.length + index) % 3);
  const results = Array.from({ length: resultCount }, (_, itemIndex) => {
    const quality = ['1080p WEB-DL', '2160p BluRay', '720p HDTV', '全集 MKV'][itemIndex % 4];
    const title = `${query} ${quality} - ${adapter.name} #${itemIndex + 1}`;
    return {
      id: `${adapter.id}-${Date.now()}-${itemIndex}`,
      sourceAdapterId: adapter.id,
      sourceName: adapter.name,
      title,
      magnetUri: demoMagnet(title, adapter.id),
      detailUrl: adapter.searchUrlTemplate?.replace('{query}', encodeURIComponent(query)) ?? adapter.homeUrl,
    } satisfies RawMagnetResult;
  });

  onProgress({ id: progressId, label: adapter.name, phase: 'browser', value: 1, status: 'done', message: `抓取到 ${results.length} 条磁力链接` });
  return results;
}

async function withConcurrency<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  async function run(): Promise<void> {
    while (cursor < items.length) {
      const current = cursor;
      cursor += 1;
      results[current] = await worker(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

export async function executeSearch(
  query: string,
  adapters: SiteAdapter[],
  settings: AppSettings,
  onProgress: ProgressCallback,
): Promise<RankedResult[]> {
  const activeAdapters = adapters.slice(0, Math.max(1, Math.min(4, settings.concurrency)));
  onProgress({ id: 'system-search', label: '搜索', phase: 'system', value: 0, status: 'running', message: `启动 ${activeAdapters.length} 个浏览器窗格` });

  const rawGroups = await withConcurrency(activeAdapters, settings.concurrency, (adapter, index) => runAdapterSearch(adapter, query, index, onProgress));
  const rawResults = rawGroups.flat();
  onProgress({ id: 'system-search', label: '搜索', phase: 'system', value: 1, status: 'done', message: `共抓取 ${rawResults.length} 条磁力链接` });

  const metadataItems = await withConcurrency(rawResults, Math.min(6, Math.max(1, settings.concurrency * 2)), async (result, index) => {
    const id = `metadata-${result.id}`;
    onProgress({ id, label: result.title, phase: 'metadata', value: 0.2, status: 'running', message: '分析 magnet metadata（不下载文件）' });
    const metadata = await analyzeMagnetMetadata(result, settings.metadataTimeoutMs);
    onProgress({ id, label: result.title, phase: 'metadata', value: 1, status: metadata.status === 'complete' ? 'done' : 'error', message: metadata.status === 'complete' ? 'metadata 完成' : metadata.error ?? 'metadata 失败' });
    return { result, metadata, ruleScore: scoreByRules(result, metadata), index };
  });

  const candidates = metadataItems.filter((item) => item.ruleScore.accepted);
  onProgress({ id: 'ai-score', label: 'AI评分', phase: 'ai', value: 0.3, status: 'running', message: `规则预筛保留 ${candidates.length}/${metadataItems.length} 条` });
  const ranked = await scoreWithAi(candidates, {
    endpoint: settings.aiEndpoint,
    model: settings.aiModel,
    threshold: settings.confidenceThreshold,
  });
  onProgress({ id: 'ai-score', label: 'AI评分', phase: 'ai', value: 1, status: 'done', message: `AI 排序后展示 ${ranked.length} 条` });
  return ranked;
}
