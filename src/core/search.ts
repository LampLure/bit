import { scoreWithAi } from './ai.js';
import { scoreByRules } from './rules.js';
import { analyzeMagnetMetadata } from './torrent.js';
import type { AppSettings, PageFetcher, ProgressItem, RankedResult, RawMagnetResult, SiteAdapter } from './types.js';

export type ProgressCallback = (item: ProgressItem) => void;

const maxResultsPerAdapter = 10;
const maxDetailPagesPerAdapter = 8;

function absoluteUrl(href: string | null, baseUrl: string): string | undefined {
  if (!href) return undefined;
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return undefined;
  }
}

function magnetId(adapter: SiteAdapter, magnetUri: string, index: number): string {
  const hash = Array.from(`${adapter.id}-${magnetUri}`)
    .map((char) => char.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 24);
  return `${adapter.id}-${hash}-${index}`;
}

function extractText(element: Element): string {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function parseMagnetResultsFromDocument(
  adapter: SiteAdapter,
  document: Document,
  pageUrl: string,
  fallbackTitle: string,
): RawMagnetResult[] {
  const selector = adapter.magnetLinkSelector?.trim() || 'a[href^="magnet:"]';
  const elements = Array.from(document.querySelectorAll(selector));
  return elements
    .map((element, index): RawMagnetResult | undefined => {
      const link = element instanceof HTMLAnchorElement ? element.href : element.getAttribute('href') ?? '';
      if (!link.startsWith('magnet:')) return undefined;
      const title = extractText(element.closest(adapter.resultItemSelector || 'article, li, tr, div') ?? element) || fallbackTitle || `Magnet ${index + 1}`;
      return {
        id: magnetId(adapter, link, index),
        sourceAdapterId: adapter.id,
        sourceName: adapter.name,
        title,
        magnetUri: link,
        detailUrl: pageUrl,
      };
    })
    .filter((item): item is RawMagnetResult => Boolean(item));
}

function parseResultLinks(adapter: SiteAdapter, document: Document, pageUrl: string): Array<{ title: string; url: string }> {
  if (!adapter.resultItemSelector) return [];
  const elements = Array.from(document.querySelectorAll(adapter.resultItemSelector));
  const links: Array<{ title: string; url: string }> = [];
  for (const element of elements.slice(0, maxResultsPerAdapter)) {
    const anchor = element instanceof HTMLAnchorElement ? element : element.querySelector('a[href]');
    const url = absoluteUrl(anchor?.getAttribute('href') ?? null, pageUrl);
    if (!url || url.startsWith('magnet:')) continue;
    links.push({ title: extractText(element) || anchor?.textContent?.trim() || url, url });
  }
  return links;
}

async function runAdapterSearch(adapter: SiteAdapter, query: string, index: number, fetchPage: PageFetcher, onProgress: ProgressCallback): Promise<RawMagnetResult[]> {
  const progressId = `browser-${adapter.id}`;
  const searchUrl = adapter.searchUrlTemplate
    ? adapter.searchUrlTemplate.replaceAll('{query}', encodeURIComponent(query))
    : adapter.homeUrl;

  onProgress({ id: progressId, label: adapter.name, phase: 'browser', value: 0.1, status: 'running', message: `加载 ${searchUrl}` });
  const searchPage = await fetchPage(searchUrl);
  if (searchPage.cloudflareDetected) {
    onProgress({ id: progressId, label: adapter.name, phase: 'browser', value: 0.3, status: 'waiting', message: '检测到 Cloudflare/验证页，请在浏览器窗格完成验证后重试' });
    return [];
  }
  if (!searchPage.ok) {
    onProgress({ id: progressId, label: adapter.name, phase: 'browser', value: 1, status: 'error', message: searchPage.error ?? `HTTP ${searchPage.status}` });
    return [];
  }

  const parser = new DOMParser();
  const searchDoc = parser.parseFromString(searchPage.html, 'text/html');
  const directMagnets = parseMagnetResultsFromDocument(adapter, searchDoc, searchPage.url, searchPage.title);
  const resultLinks = parseResultLinks(adapter, searchDoc, searchPage.url);

  if (directMagnets.length > 0 && resultLinks.length === 0) {
    onProgress({ id: progressId, label: adapter.name, phase: 'browser', value: 1, status: 'done', message: `搜索页直接发现 ${directMagnets.length} 条磁力链接` });
    return directMagnets.slice(0, maxResultsPerAdapter);
  }

  const collected = [...directMagnets];
  const detailLinks = resultLinks.slice(0, maxDetailPagesPerAdapter);
  for (let detailIndex = 0; detailIndex < detailLinks.length; detailIndex += 1) {
    const link = detailLinks[detailIndex];
    onProgress({
      id: progressId,
      label: adapter.name,
      phase: 'browser',
      value: 0.35 + (detailIndex / Math.max(1, detailLinks.length)) * 0.55,
      status: 'running',
      message: `抓取详情页 ${detailIndex + 1}/${detailLinks.length}`,
    });
    const detailPage = await fetchPage(link.url);
    if (!detailPage.ok || detailPage.cloudflareDetected) continue;
    const detailDoc = parser.parseFromString(detailPage.html, 'text/html');
    const magnets = parseMagnetResultsFromDocument(adapter, detailDoc, detailPage.url, link.title);
    collected.push(...magnets);
  }

  const unique = Array.from(new Map(collected.map((item) => [item.magnetUri, item])).values()).slice(0, maxResultsPerAdapter);
  onProgress({ id: progressId, label: adapter.name, phase: 'browser', value: 1, status: 'done', message: `抓取到 ${unique.length} 条磁力链接` });
  return unique;
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
  fetchPage: PageFetcher,
  onProgress: ProgressCallback,
): Promise<RankedResult[]> {
  const activeAdapters = adapters.slice(0, Math.max(1, Math.min(4, settings.concurrency)));
  onProgress({ id: 'system-search', label: '搜索', phase: 'system', value: 0, status: 'running', message: `启动 ${activeAdapters.length} 个资源站任务` });

  const rawGroups = await withConcurrency(activeAdapters, settings.concurrency, (adapter, index) => runAdapterSearch(adapter, query, index, fetchPage, onProgress));
  const rawResults = rawGroups.flat();
  onProgress({ id: 'system-search', label: '搜索', phase: 'system', value: 1, status: 'done', message: `共抓取 ${rawResults.length} 条磁力链接` });

  const metadataItems = await withConcurrency(rawResults, Math.min(6, Math.max(1, settings.concurrency * 2)), async (result) => {
    const id = `metadata-${result.id}`;
    onProgress({ id, label: result.title, phase: 'metadata', value: 0.2, status: 'running', message: '分析 magnet metadata（不下载文件）' });
    const metadata = await analyzeMagnetMetadata(result, settings.metadataTimeoutMs);
    onProgress({ id, label: result.title, phase: 'metadata', value: 1, status: metadata.status === 'complete' ? 'done' : 'error', message: metadata.status === 'complete' ? 'metadata 完成' : metadata.error ?? 'metadata 失败' });
    return { result, metadata, ruleScore: scoreByRules(result, metadata) };
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
