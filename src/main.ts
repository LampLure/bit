import { applyGuideCapture, guideMessages, nextGuideStep } from './core/adapterGuide.js';
import { executeSearch, rankRawResults } from './core/search.js';
import { defaultSettings, loadAdapters, loadHistory, loadSettings, pushHistory, saveAdapters, saveSettings } from './core/storage.js';
import type { AppSettings, FetchedPage, GuideStep, HistoryEntry, PageFetcher, ProgressItem, RankedResult, RawMagnetResult, SiteAdapter } from './core/types.js';

interface State {
  query: string;
  settings: AppSettings;
  adapters: SiteAdapter[];
  history: HistoryEntry[];
  results: RankedResult[];
  progress: Record<string, ProgressItem>;
  running: boolean;
  guideStep: GuideStep;
  draftAdapter?: SiteAdapter;
  previewHtml?: string;
  previewUrl?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function seedAdapter(): SiteAdapter {
  const now = nowIso();
  return {
    id: 'demo-public-domain',
    name: 'Demo Public Domain',
    homeUrl: 'https://example.org',
    searchUrlTemplate: 'https://example.org/search?q={query}',
    searchInputSelector: 'input[name="q"]',
    searchButtonSelector: 'button[type="submit"]',
    resultItemSelector: '.result-item',
    magnetLinkSelector: 'a[href^="magnet:"]',
    createdAt: now,
    updatedAt: now,
  };
}

function newAdapter(name: string, homeUrl: string, searchUrlTemplate?: string): SiteAdapter {
  const now = nowIso();
  return {
    id: crypto.randomUUID(),
    name,
    homeUrl,
    searchUrlTemplate,
    createdAt: now,
    updatedAt: now,
  };
}

const storedAdapters = loadAdapters();
const state: State = {
  query: '',
  settings: { ...defaultSettings, ...loadSettings() },
  adapters: storedAdapters.length > 0 ? storedAdapters : [seedAdapter()],
  history: loadHistory(),
  results: [],
  progress: {},
  running: false,
  guideStep: 'idle',
};

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Missing root element');
const root = rootElement;

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char] ?? char);
}


function injectCaptureScript(html: string): string {
  const script = `<script>
(() => {
  function cssEscape(value) { return value.replace(/[^a-zA-Z0-9_-]/g, ch => '\\\\' + ch); }
  function selectorFrom(el) {
    if (el.id) return '#' + cssEscape(el.id);
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      let part = node.tagName.toLowerCase();
      if (node.classList && node.classList.length) part += Array.from(node.classList).slice(0, 2).map(c => '.' + cssEscape(c)).join('');
      const siblings = node.parentElement ? Array.from(node.parentElement.children).filter(child => child.tagName === node.tagName) : [];
      if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(' > ');
  }
  document.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    parent.postMessage({ type: 'adapter-selector', selector: selectorFrom(event.target), text: (event.target.textContent || '').trim().slice(0, 120) }, '*');
  }, true);
})();
</script>`;
  return html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<\/body>/i, `${script}</body>`) || `${html}${script}`;
}

async function apiFetchPage(url: string): Promise<FetchedPage> {
  try {
    const response = await fetch(`/api/fetch?url=${encodeURIComponent(url)}`);
    if (response.ok) return await response.json() as FetchedPage;
    return { url, status: response.status, ok: false, title: '', html: '', cloudflareDetected: false, error: `本地抓取服务返回 HTTP ${response.status}` };
  } catch (error) {
    return { url, status: 0, ok: false, title: '', html: '', cloudflareDetected: false, error: error instanceof Error ? error.message : String(error) };
  }
}

const pageFetcher: PageFetcher = apiFetchPage;

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '未知';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

function upsertProgress(item: ProgressItem): void {
  state.progress[item.id] = item;
  render();
}

function persist(): void {
  saveAdapters(state.adapters);
  saveSettings(state.settings);
}

function renderSidebar(): string {
  return `
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-icon">⌁</div>
        <div><h1>Bit Resource Finder</h1><p>本地 metadata + 规则 + LLaMACpp 评分</p></div>
      </div>
      <label class="field"><span>搜索关键字</span><input id="query" value="${escapeHtml(state.query)}" placeholder="例如：开源纪录片 1080p" /></label>
      <label class="field"><span>并发浏览器窗格：${state.settings.concurrency}</span><input id="concurrency" type="range" min="1" max="4" value="${state.settings.concurrency}" /></label>
      <button class="primary" id="search" ${state.running || !state.query.trim() || state.adapters.length === 0 ? 'disabled' : ''}>${state.running ? '搜索中…' : '▶ 开始搜索'}</button>
      <button class="secondary" id="add-adapter">＋ 添加资源站</button>
      <section class="panel"><h2>资源站 adapters</h2>${state.adapters.length === 0 ? '<p class="muted">暂无资源站，请先添加。</p>' : ''}${state.adapters.map((adapter) => `<div class="adapter-chip"><strong>${escapeHtml(adapter.name)}</strong><span>${escapeHtml(adapter.homeUrl)}</span></div>`).join('')}</section>
      <section class="panel"><h2>最近 5 次搜索</h2>${state.history.length === 0 ? '<p class="muted">暂无历史记录。</p>' : ''}${state.history.map((entry) => `<button class="history-item" data-history="${entry.id}"><strong>${escapeHtml(entry.query)}</strong><span>${new Date(entry.createdAt).toLocaleString()} · ${entry.results.length} 条</span></button>`).join('')}</section>
      <section class="panel compact"><h2>AI 设置</h2><label class="field small"><span>LLaMACpp endpoint</span><input id="ai-endpoint" value="${escapeHtml(state.settings.aiEndpoint)}" /></label><label class="field small"><span>展示阈值：${state.settings.confidenceThreshold}</span><input id="threshold" type="range" min="0.1" max="0.95" step="0.05" value="${state.settings.confidenceThreshold}" /></label></section>
    </aside>`;
}

function renderBrowserGrid(): string {
  const panes = Array.from({ length: state.settings.concurrency }, (_, index) => state.adapters[index] ?? state.draftAdapter).filter(Boolean) as SiteAdapter[];
  const visible = panes.length > 0 ? panes : Array.from({ length: state.settings.concurrency }, (_, index) => ({ id: `empty-${index}`, name: `浏览器 ${index + 1}`, homeUrl: 'about:blank', createdAt: nowIso(), updatedAt: nowIso() }));
  const guide = state.guideStep !== 'idle' && state.guideStep !== 'done'
    ? `<div class="guide-toast"><strong>半自动指引</strong><span>${guideMessages[state.guideStep]}</span><button id="manual-selector">手动填写 selector</button></div>`
    : '';
  return `<section class="browser-section"><div class="section-head"><h2>嵌入浏览器分屏</h2><p>使用本地抓取服务渲染页面；点击预览页元素可生成 adapter selector。</p></div>${guide}<div class="browser-grid panes-${state.settings.concurrency}">${visible.map((adapter, index) => {
    const isDraft = state.draftAdapter?.id === adapter.id && state.previewHtml;
    const frame = isDraft
      ? `<iframe title="${escapeHtml(adapter.name)}" srcdoc="${escapeHtml(injectCaptureScript(state.previewHtml ?? ''))}" sandbox="allow-scripts allow-forms"></iframe>`
      : adapter.homeUrl !== 'about:blank'
        ? `<iframe title="${escapeHtml(adapter.name)}" src="${escapeHtml(adapter.homeUrl)}" sandbox="allow-same-origin allow-scripts allow-forms"></iframe>`
        : '<div class="blank-pane">等待加载资源站或 Cloudflare 人工验证</div>';
    return `<div class="browser-pane"><div class="browser-toolbar"><span class="dot red"></span><span class="dot yellow"></span><span class="dot green"></span><strong>${escapeHtml(adapter.name)}</strong></div>${frame}</div>`;
  }).join('')}</div></section>`;
}

function renderProgress(): string {
  const items = Object.values(state.progress);
  return `<section class="progress-panel"><div class="section-head"><h2>进度</h2><p>浏览器搜索、metadata 分析、AI 评分独立显示。</p></div>${items.length === 0 ? '<p class="muted">尚未开始任务。</p>' : ''}${items.map((item) => `<div class="progress-row ${item.status}"><div><strong>${escapeHtml(item.label)}</strong><span>${item.phase} · ${escapeHtml(item.message)}</span></div><progress value="${item.value}" max="1"></progress></div>`).join('')}</section>`;
}

function renderResults(): string {
  return `<section class="results-panel"><div class="section-head"><h2>结果列表</h2><p>按 AI 置信度排序；点击标题展开文件列表和评分理由。</p></div>${state.results.length === 0 ? '<p class="muted">暂无可展示结果。</p>' : ''}<div class="result-list">${state.results.map((result, index) => `<details class="result-card" ${index === 0 ? 'open' : ''}><summary><span class="rank">#${index + 1}</span><strong>${escapeHtml(result.title)}</strong><em>${Math.round(result.aiScore.confidence * 100)}%</em></summary><div class="result-body"><label>磁力链接</label><code>${escapeHtml(result.magnetUri)}</code><div class="score-grid"><span>来源：${escapeHtml(result.sourceName)}</span><span>规则评分：${result.ruleScore.score}</span><span>AI 结论：${result.aiScore.verdict}</span><span>总大小：${formatBytes(result.metadata.totalBytes)}</span></div><h4>文件列表</h4><ul>${result.metadata.files.map((file) => `<li>${escapeHtml(file.path)} <span>${formatBytes(file.bytes)}</span></li>`).join('')}</ul><h4>评分理由</h4><ul>${result.aiScore.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('')}</ul></div></details>`).join('')}</div></section>`;
}

function render(): void {
  root.innerHTML = `<div class="app-shell">${renderSidebar()}<main>${renderBrowserGrid()}<div class="lower-grid">${renderProgress()}${renderResults()}</div></main></div>`;
  bindEvents();
}



async function tryBrowserRuntimeSearch(query: string): Promise<RankedResult[] | undefined> {
  try {
    const statusResponse = await fetch('/api/browser/status');
    const status = await statusResponse.json() as { available?: boolean; error?: string };
    if (!status.available) {
      upsertProgress({ id: 'browser-runtime', label: '有头浏览器', phase: 'system', value: 1, status: 'waiting', message: status.error ?? 'Playwright 未安装，回退到 HTTP 抓取模式' });
      return undefined;
    }
    upsertProgress({ id: 'browser-runtime', label: '有头浏览器', phase: 'system', value: 0.15, status: 'running', message: '使用 Playwright/Chromium 持久化上下文执行真实搜索' });
    const response = await fetch('/api/browser/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, adapters: state.adapters, concurrency: state.settings.concurrency }),
    });
    const payload = await response.json() as { ok?: boolean; results?: RawMagnetResult[]; error?: string; unavailable?: boolean };
    if (!payload.ok || payload.unavailable) {
      upsertProgress({ id: 'browser-runtime', label: '有头浏览器', phase: 'system', value: 1, status: 'error', message: payload.error ?? '有头浏览器搜索失败，回退到 HTTP 抓取模式' });
      return undefined;
    }
    const rawResults = payload.results ?? [];
    upsertProgress({ id: 'browser-runtime', label: '有头浏览器', phase: 'system', value: 1, status: 'done', message: `真实浏览器抓取到 ${rawResults.length} 条磁力链接` });
    return rankRawResults(rawResults, state.settings, upsertProgress);
  } catch (error) {
    upsertProgress({ id: 'browser-runtime', label: '有头浏览器', phase: 'system', value: 1, status: 'error', message: error instanceof Error ? error.message : String(error) });
    return undefined;
  }
}

function captureSelector(selector: string): void {
  if (!state.draftAdapter) return;
  state.draftAdapter = applyGuideCapture(state.draftAdapter, state.guideStep, selector);
  state.guideStep = nextGuideStep(state.guideStep);
  upsertProgress({ id: 'adapter-guide', label: '添加资源站', phase: 'system', value: state.guideStep === 'done' ? 1 : 0.45, status: state.guideStep === 'done' ? 'done' : 'waiting', message: guideMessages[state.guideStep] });
  if (state.guideStep === 'done' && state.draftAdapter) {
    state.adapters = [state.draftAdapter, ...state.adapters.filter((item) => item.id !== state.draftAdapter?.id)];
    state.draftAdapter = undefined;
    state.previewHtml = undefined;
    state.previewUrl = undefined;
    persist();
  }
  render();
}

window.addEventListener('message', (event) => {
  const data = event.data as { type?: string; selector?: string };
  if (data?.type === 'adapter-selector' && data.selector) captureSelector(data.selector);
});

function bindEvents(): void {
  document.getElementById('query')?.addEventListener('input', (event) => { state.query = (event.target as HTMLInputElement).value; render(); });
  document.getElementById('concurrency')?.addEventListener('input', (event) => { state.settings.concurrency = Number((event.target as HTMLInputElement).value); persist(); render(); });
  document.getElementById('ai-endpoint')?.addEventListener('change', (event) => { state.settings.aiEndpoint = (event.target as HTMLInputElement).value; persist(); });
  document.getElementById('threshold')?.addEventListener('input', (event) => { state.settings.confidenceThreshold = Number((event.target as HTMLInputElement).value); persist(); render(); });
  document.getElementById('add-adapter')?.addEventListener('click', async () => {
    const homeUrl = prompt('请输入资源站首页 URL（http/https）', 'https://example.org')?.trim();
    if (!homeUrl) return;
    let parsedHome: URL;
    try {
      parsedHome = new URL(homeUrl);
      if (!['http:', 'https:'].includes(parsedHome.protocol)) throw new Error('unsupported protocol');
    } catch {
      alert('请输入有效的 http/https URL');
      return;
    }
    const name = prompt('请输入资源站名称', parsedHome.host)?.trim() || parsedHome.host;
    const template = prompt('如果站点支持搜索 URL，请填写模板（用 {query} 表示关键词）', `${homeUrl.replace(/\/$/, '')}/search?q={query}`)?.trim() || undefined;
    state.draftAdapter = newAdapter(name, parsedHome.href, template);
    state.guideStep = 'searchInput';
    upsertProgress({ id: 'adapter-guide', label: '添加资源站', phase: 'system', value: 0.1, status: 'running', message: '通过本地服务加载资源站首页' });
    const page = await apiFetchPage(homeUrl);
    state.previewHtml = page.html;
    state.previewUrl = page.url;
    upsertProgress({ id: 'adapter-guide', label: '添加资源站', phase: 'system', value: 0.2, status: page.ok ? 'waiting' : 'error', message: page.ok ? guideMessages.searchInput : page.error ?? `HTTP ${page.status}` });
    render();
  });
  document.getElementById('manual-selector')?.addEventListener('click', () => {
    const selector = prompt(`请输入 ${state.guideStep} 的 CSS selector`)?.trim();
    if (selector) captureSelector(selector);
  });
  document.getElementById('search')?.addEventListener('click', async () => {
    if (state.running || !state.query.trim()) return;
    state.running = true; state.progress = {}; render();
    try {
      state.results = (await tryBrowserRuntimeSearch(state.query.trim())) ?? await executeSearch(state.query.trim(), state.adapters, state.settings, pageFetcher, upsertProgress);
      const entry: HistoryEntry = { id: crypto.randomUUID(), query: state.query.trim(), createdAt: nowIso(), results: state.results };
      state.history = pushHistory(entry);
    } finally {
      state.running = false; render();
    }
  });
  document.querySelectorAll<HTMLButtonElement>('[data-history]').forEach((button) => button.addEventListener('click', () => {
    const entry = state.history.find((item) => item.id === button.dataset.history);
    if (!entry) return;
    state.query = entry.query; state.results = entry.results; render();
  }));
}

render();
