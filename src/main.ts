import { applyGuideCapture, guideMessages, guideToasts, nextGuideStep } from './core/adapterGuide.js';
import { executeSearch } from './core/search.js';
import { defaultSettings, loadAdapters, loadHistory, loadSearchHistory, loadSettings, pushHistory, pushSearchHistory, saveAdapters, saveSettings } from './core/storage.js';
import type { Adapter, AdapterCaptureStep, AppSettings, FinalResult, HistoryEntry, ProgressItem, SearchHistoryEntry } from './core/types.js';

interface State {
  query: string;
  settings: AppSettings;
  adapters: Adapter[];
  history: HistoryEntry[];
  searchHistory: SearchHistoryEntry[];
  results: FinalResult[];
  progress: Record<string, ProgressItem>;
  running: boolean;
  guideStep: AdapterCaptureStep;
  draftAdapter?: Adapter;
  previewUrl?: string;
  toastMessage: string;
  hasVerificationPending: boolean;
  verificationPanelIds: number[];
  needsContinue: Record<number, boolean>;
}

function nowTs(): number {
  return Date.now();
}

function seedAdapter(): Adapter {
  const now = nowTs();
  return {
    id: 'demo-public-domain',
    name: 'Demo Public Domain',
    homeUrl: 'https://example.org',
    searchMode: 'browser',
    searchInputSelector: 'input[name="q"]',
    searchButtonSelector: 'button[type="submit"]',
    resultItemSelector: '.result-item',
    magnetLinkSelector: 'a[href^="magnet:"]',
    waitAfterSearchMs: 2000,
    waitAfterDetailMs: 1500,
    createdAt: now,
    updatedAt: now,
  };
}

function newAdapter(name: string, homeUrl: string): Adapter {
  const now = nowTs();
  return {
    id: crypto.randomUUID(),
    name,
    homeUrl,
    searchMode: 'browser',
    searchInputSelector: '',
    searchButtonSelector: '',
    resultItemSelector: '',
    magnetLinkSelector: '',
    waitAfterSearchMs: 2000,
    waitAfterDetailMs: 1500,
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
  searchHistory: loadSearchHistory(),
  results: [],
  progress: {},
  running: false,
  guideStep: 'idle',
  toastMessage: '',
  hasVerificationPending: false,
  verificationPanelIds: [],
  needsContinue: {},
};

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Missing root element');

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char] ?? char);
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '未知';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

function upsertProgress(item: ProgressItem): void {
  state.progress[item.id] = item;
  if (item.status === 'waiting' && item.message.includes('验证')) {
    state.hasVerificationPending = true;
  }
  render();
}

function persist(): void {
  saveAdapters(state.adapters);
  saveSettings(state.settings);
}

function showToast(message: string): void {
  state.toastMessage = message;
  render();
  setTimeout(() => {
    state.toastMessage = '';
    render();
  }, 2000);
}

function renderSidebar(): string {
  return `
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-icon">⌁</div>
        <div><h1>Bit Resource Finder</h1><p>本地 metadata + 规则 + LLaMACpp 评分</p></div>
      </div>
      <label class="field"><span>搜索关键字</span><input id="query" value="${escapeHtml(state.query)}" placeholder="例如：开源纪录片 1080p" /></label>
      <label class="field"><span>并发数：${state.settings.concurrency}</span><input id="concurrency" type="range" min="1" max="4" value="${state.settings.concurrency}" /></label>
      <button class="primary" id="search" ${state.running || !state.query.trim() || state.adapters.length === 0 ? 'disabled' : ''}>${state.running ? '搜索中…' : '▶ 开始搜索'}</button>
      <button class="secondary" id="add-adapter">＋ 添加资源站</button>
      ${state.guideStep !== 'idle' && state.guideStep !== 'done' ? `<button class="secondary" id="cancel-adapter">取消录制</button>` : ''}
      <section class="panel"><h2>资源站 adapters</h2>${state.adapters.length === 0 ? '<p class="muted">暂无资源站，请先添加。</p>' : ''}${state.adapters.map((adapter) => `<div class="adapter-chip"><strong>${escapeHtml(adapter.name)}</strong><span>${escapeHtml(adapter.homeUrl)}</span></div>`).join('')}</section>
      <section class="panel"><h2>最近 5 次搜索</h2>${state.searchHistory.length === 0 ? '<p class="muted">暂无历史记录。</p>' : ''}${state.searchHistory.map((entry) => `<button class="history-item" data-history="${entry.id}"><strong>${escapeHtml(entry.keyword)}</strong><span>${new Date(entry.createdAt).toLocaleString()} · ${entry.results.length} 条</span></button>`).join('')}</section>
      <section class="panel compact"><h2>AI 设置</h2><label class="field small"><span>LLaMACpp endpoint</span><input id="ai-endpoint" value="${escapeHtml(state.settings.aiEndpoint)}" /></label><label class="field small"><span>展示阈值：${state.settings.confidenceThreshold}</span><input id="threshold" type="range" min="10" max="100" step="5" value="${state.settings.confidenceThreshold}" /></label><label class="field small"><span>Metadata 超时：${state.settings.metadataTimeoutMs}ms</span><input id="meta-timeout" type="number" min="5000" max="120000" step="5000" value="${state.settings.metadataTimeoutMs}" /></label></section>
    </aside>`;
}

function renderPanels(): string {
  const panels = Array.from({ length: state.settings.concurrency }, (_, index) => ({
    index,
    adapter: state.adapters[index],
    progress: Object.values(state.progress).find((p) => p.id === `panel-${index}`),
  }));

  return `<section class="browser-section">
    <div class="section-head"><h2>浏览器任务面板</h2><p>每个面板对应一个资源站，遇到验证页会提示人工完成。</p></div>
    ${state.guideStep !== 'idle' && state.guideStep !== 'done' ? `<div class="guide-toast"><strong>录制指引</strong><span>${guideMessages[state.guideStep]}</span><button id="manual-selector">手动填写 selector</button></div>` : ''}
    <div class="panel-grid panes-${state.settings.concurrency}">
      ${panels.map((panel) => {
        const prog = panel.progress;
        const isVerification = prog?.status === 'waiting' && prog?.message?.includes('验证');
        const panelId = panel.index;
        return `<div class="panel-card ${isVerification ? 'verification' : prog?.status ?? 'idle'}">
          <div class="panel-toolbar">
            <span class="status-dot ${prog?.status === 'running' ? 'running' : prog?.status === 'done' ? 'done' : prog?.status === 'error' ? 'error' : prog?.status === 'waiting' ? 'waiting' : 'idle'}"></span>
            <strong>${escapeHtml(panel.adapter?.name ?? `面板 ${panelId + 1}`)}</strong>
            ${prog ? `<span class="badge badge-${prog.status}">${prog.message}</span>` : '<span class="badge badge-idle">空闲</span>'}
          </div>
          <div class="panel-body">
            ${isVerification ? `<div class="verification-alert">
              <p>检测到验证页面</p>
              <button class="continue-btn" data-panel="${panelId}">我已完成验证，继续</button>
            </div>` : `<p class="muted">${prog?.message ?? '等待任务…'}</p>`}
          </div>
        </div>`;
      }).join('')}
    </div>
  </section>`;
}

function renderProgress(): string {
  const items = Object.values(state.progress);
  const systemItems = items.filter((i) => i.id.startsWith('system-'));
  const total = Math.max(1, systemItems.length);
  const done = systemItems.filter((i) => i.status === 'done').length;
  const currentStage = systemItems.find((i) => i.status === 'running');

  return `<section class="progress-panel">
    <div class="section-head"><h2>进度</h2></div>
    <div class="progress-bar-container">
      <div class="progress-bar" style="width:${Math.round((done / total) * 100)}%"></div>
    </div>
    <p class="progress-text">${currentStage?.message ?? (state.running ? '准备中…' : state.results.length > 0 ? '完成' : '尚未开始任务')}</p>
    ${items.filter((i) => !i.id.startsWith('system-')).length > 0 ? items.filter((i) => !i.id.startsWith('system-')).map((item) => `<div class="progress-row ${item.status}"><div><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.message)}</span></div></div>`).join('') : ''}
  </section>`;
}

function renderResults(): string {
  return `<section class="results-panel">
    <div class="section-head"><h2>结果列表</h2><p>按最终评分排序；点击展开查看详情。</p></div>
    ${state.results.length === 0 ? '<p class="muted">暂无可展示结果。</p>' : ''}
    <div class="result-list">
      ${state.results.map((result, index) => `<details class="result-card" ${index === 0 ? 'open' : ''}>
        <summary>
          <span class="rank">#${index + 1}</span>
          <strong>${escapeHtml(result.title)}</strong>
          <div class="score-badges">
            <span class="final-score">${result.finalScore}分</span>
            <span class="rule-score">规则${result.ruleScore}</span>
            <span class="ai-score">AI${result.aiScore}</span>
          </div>
        </summary>
        <div class="result-body">
          <label>磁力链接</label>
          <code>${escapeHtml(result.magnet)}</code>
          <div class="score-grid">
            <span>最终评分：${result.finalScore}</span>
            <span>规则评分：${result.ruleScore}</span>
            <span>AI 评分：${result.aiScore}</span>
            <span>总大小：${formatBytes(result.totalSize)}</span>
          </div>
          ${result.files.length > 0 ? `<h4>文件列表</h4><ul>${result.files.map((file) => `<li>${escapeHtml(file.path)} <span>${formatBytes(file.bytes)}</span></li>`).join('')}</ul>` : ''}
          ${result.reasons.length > 0 ? `<h4>评分理由</h4><ul>${result.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('')}</ul>` : ''}
        </div>
      </details>`).join('')}
    </div>
  </section>`;
}

function render(): void {
  const root = rootElement!;
  root.innerHTML = `<div class="app-shell">
    ${renderSidebar()}
    <main>
      ${renderPanels()}
      <div class="lower-grid">
        ${renderProgress()}
        ${renderResults()}
      </div>
    </main>
    ${state.toastMessage ? `<div class="toast">${escapeHtml(state.toastMessage)}</div>` : ''}
  </div>`;
  bindEvents();
}

async function startBrowserIfNeeded(): Promise<void> {
  try {
    const statusResponse = await fetch('/api/browser/status');
    const status = await statusResponse.json();
    if (!status.started) {
      await fetch('/api/browser/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adapters: state.adapters }),
      });
    } else {
      await fetch('/api/browser/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adapters: state.adapters }),
      });
    }
  } catch {
    upsertProgress({ id: 'browser-runtime', label: '有头浏览器', phase: 'system', value: 1, status: 'error', message: '浏览器启动失败，请确保已安装 Playwright' });
  }
}

function captureSelector(selector: string): void {
  if (!state.draftAdapter) return;
  state.draftAdapter = applyGuideCapture(state.draftAdapter, state.guideStep, selector);
  const toastMsg = guideToasts[state.guideStep];
  state.guideStep = nextGuideStep(state.guideStep);

  if (state.guideStep === 'done' && state.draftAdapter) {
    state.adapters = [state.draftAdapter, ...state.adapters.filter((item) => item.id !== state.draftAdapter?.id)];
    showToast(guideToasts.done);
    state.draftAdapter = undefined;
    state.previewUrl = undefined;
    persist();
  } else {
    showToast(toastMsg);
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
  document.getElementById('meta-timeout')?.addEventListener('change', (event) => { state.settings.metadataTimeoutMs = Number((event.target as HTMLInputElement).value); persist(); });

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
    state.draftAdapter = newAdapter(name, parsedHome.href);
    state.guideStep = 'pick_search_input';
    state.previewUrl = parsedHome.href;
    showToast(guideMessages.pick_search_input);
    render();
  });

  document.getElementById('cancel-adapter')?.addEventListener('click', () => {
    state.guideStep = 'idle';
    state.draftAdapter = undefined;
    state.previewUrl = undefined;
    render();
  });

  document.getElementById('manual-selector')?.addEventListener('click', () => {
    const stepLabels: Record<string, string> = {
      pick_search_input: '搜索输入框',
      pick_search_button: '搜索按钮',
      pick_result_item: '搜索结果项',
      pick_magnet_link: '磁力链接',
    };
    const label = stepLabels[state.guideStep] ?? state.guideStep;
    const selector = prompt(`请输入 "${label}" 的 CSS selector`)?.trim();
    if (selector) captureSelector(selector);
  });

  document.getElementById('search')?.addEventListener('click', async () => {
    if (state.running || !state.query.trim()) return;
    state.running = true;
    state.progress = {};
    state.results = [];
    state.hasVerificationPending = false;
    state.verificationPanelIds = [];
    state.needsContinue = {};
    render();

    await startBrowserIfNeeded();

    try {
      const results = await executeSearch(state.query.trim(), state.adapters, state.settings, upsertProgress);
      state.results = results;

      const historyEntry: HistoryEntry = {
        id: crypto.randomUUID(),
        query: state.query.trim(),
        keyword: state.query.trim(),
        createdAt: new Date().toISOString(),
        results: [],
      };
      state.history = pushHistory(historyEntry);
      state.searchHistory = pushSearchHistory(state.query.trim(), results);
    } finally {
      state.running = false;
      render();
    }
  });

  document.querySelectorAll<HTMLButtonElement>('[data-history]').forEach((button) => button.addEventListener('click', () => {
    const entry = state.searchHistory.find((item) => item.id === button.dataset.history);
    if (!entry) return;
    state.query = entry.keyword;
    state.results = entry.results;
    render();
  }));

  document.querySelectorAll<HTMLButtonElement>('.continue-btn').forEach((button) => button.addEventListener('click', async () => {
    const panelId = Number(button.dataset.panel);
    if (Number.isNaN(panelId)) return;

    try {
      const response = await fetch('/api/browser/continue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ panelId }),
      });
      const result = await response.json();

      if (result.needVerification) {
        showToast('仍检测到验证页面，请继续完成验证');
        return;
      }

      if (!result.ok) {
        showToast('继续执行失败');
        return;
      }

      showToast('验证完成，正在继续搜索');
      upsertProgress({
        id: `panel-${panelId}`,
        label: `面板 ${panelId + 1}`,
        phase: 'browser',
        value: 0.8,
        status: 'running',
        message: `继续搜索中`,
      });
    } catch {
      showToast('继续执行失败');
    }
  }));
}

render();
