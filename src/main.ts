import { applyGuideCapture, guideMessages, guideToasts, nextGuideStep } from './core/adapterGuide.js';
import { executeSearch } from './core/search.js';
import { defaultSettings, loadAdapters, loadHistory, loadSearchHistory, loadSettings, pushHistory, pushSearchHistory, saveAdapters, saveSettings } from './core/storage.js';
import { startBrowser, continueAfterVerification, getElectronPanelAPI } from './core/browserClient.js';
import type { Adapter, AdapterCaptureStep, AppSettings, FinalResult, HistoryEntry, ProgressItem, SearchHistoryEntry } from './core/types.js';

declare global {
  interface Window {
    desktopPanels?: any;
    __adaptersStore?: Record<string, Adapter>;
    __onPanelTitle?: (panelId: number, title: string) => void;
    __onPanelUrl?: (panelId: number, url: string) => void;
  }
}

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
  panelCount: number;
  panelUrls: Record<number, string>;
  panelTitles: Record<number, string>;
  panelStatuses: Record<number, string>;
  adapterFormVisible: boolean;
  adapterHomeUrl: string;
  adapterName: string;
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
  panelCount: 1,
  panelUrls: {},
  panelTitles: {},
  panelStatuses: {},
  adapterFormVisible: false,
  adapterHomeUrl: '',
  adapterName: '',
};

(window as any).__adaptersStore = Object.fromEntries(state.adapters.map((a) => [a.id, a]));

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

function updateSearchButtonState(): void {
  const button = document.getElementById('search') as HTMLButtonElement | null;
  if (!button) return;
  button.disabled = state.running || !state.query.trim() || state.adapters.length === 0;
}

function upsertProgress(item: ProgressItem): void {
  state.progress[item.id] = item;
  render();
}

function persist(): void {
  saveAdapters(state.adapters);
  saveSettings(state.settings);
  (window as any).__adaptersStore = Object.fromEntries(state.adapters.map((a) => [a.id, a]));
}

function showToast(message: string): void {
  state.toastMessage = message;
  render();
  setTimeout(() => {
    state.toastMessage = '';
    render();
  }, 2000);
}

function renderAdapterForm(): string {
  if (!state.adapterFormVisible) return '';

  return `<section class="panel compact adapter-form">
    <h2>新增资源站</h2>
    <label class="field small"><span>首页 URL</span><input id="adapter-home-url" value="${escapeHtml(state.adapterHomeUrl)}" placeholder="https://example.org" /></label>
    <label class="field small"><span>资源站名称</span><input id="adapter-name" value="${escapeHtml(state.adapterName)}" placeholder="留空则使用域名" /></label>
    <button class="primary" id="save-adapter">保存并开始录制</button>
    <button class="secondary" id="hide-adapter-form">取消</button>
  </section>`;
}

function renderSidebar(): string {
  return `
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-icon">⌁</div>
        <div><h1>Bit Resource Finder</h1><p>本地 metadata + 规则 + LLaMACpp 评分</p></div>
      </div>
      <label class="field"><span>搜索关键字</span><input id="query" value="${escapeHtml(state.query)}" placeholder="例如：开源纪录片 1080p" /></label>
      <label class="field"><span>并发数：${state.panelCount}</span><input id="concurrency" type="range" min="1" max="4" value="${state.panelCount}" /></label>
      <button class="primary" id="search" ${state.running || !state.query.trim() || state.adapters.length === 0 ? 'disabled' : ''}>${state.running ? '搜索中…' : '▶ 开始搜索'}</button>
      <button class="secondary" id="add-adapter">＋ 添加资源站</button>
      ${renderAdapterForm()}
      ${state.guideStep !== 'idle' && state.guideStep !== 'done' ? `<button class="secondary" id="cancel-adapter">取消录制</button>` : ''}
      <section class="panel"><h2>资源站 adapters</h2>${state.adapters.length === 0 ? '<p class="muted">暂无资源站。</p>' : ''}${state.adapters.map((adapter) => `<div class="adapter-chip"><strong>${escapeHtml(adapter.name)}</strong><span>${escapeHtml(adapter.homeUrl)}</span></div>`).join('')}</section>
      <section class="panel"><h2>最近 5 次搜索</h2>${state.searchHistory.length === 0 ? '<p class="muted">暂无历史。</p>' : ''}${state.searchHistory.map((entry) => `<button class="history-item" data-history="${entry.id}"><strong>${escapeHtml(entry.keyword)}</strong><span>${new Date(entry.createdAt).toLocaleString()} · ${entry.results.length} 条</span></button>`).join('')}</section>
      <section class="panel compact"><h2>AI 设置</h2><label class="field small"><span>LLaMACpp endpoint</span><input id="ai-endpoint" value="${escapeHtml(state.settings.aiEndpoint)}" /></label><label class="field small"><span>展示阈值：${state.settings.confidenceThreshold}</span><input id="threshold" type="range" min="10" max="100" step="5" value="${state.settings.confidenceThreshold}" /></label></section>
    </aside>`;
}

function renderMainContent(): string {
  const panels = Array.from({ length: state.panelCount }, (_, index) => ({
    index,
    adapter: index === 0 && state.draftAdapter ? state.draftAdapter : state.adapters[index],
    progress: Object.values(state.progress).find((p) => p.id === `panel-${index}`),
  }));

  const isGuideActive = state.guideStep !== 'idle' && state.guideStep !== 'done';

  return `
    <main>
      <div class="panel-area">
        <div class="panel-header">
          <h2>浏览器面板</h2>
          ${isGuideActive ? `<div class="guide-toast"><strong>录制指引</strong><span>${guideMessages[state.guideStep]}</span><button id="manual-selector">手动填写</button></div>` : ''}
        </div>
        <div class="desktop-panel-grid panes-${state.panelCount}" id="panel-grid">
          ${panels.map((panel) => {
            const prog = panel.progress;
            const isCF = prog?.status === 'waiting' && prog?.message?.includes('验证');
            return `<div class="desktop-panel" data-panel-id="${panel.index}">
              <div class="desktop-panel-bar">
                <span class="status-dot ${prog?.status === 'running' ? 'running' : prog?.status === 'done' ? 'done' : prog?.status === 'error' ? 'error' : prog?.status === 'waiting' ? 'waiting' : 'idle'}"></span>
                <strong>${escapeHtml(panel.adapter?.name ?? `面板 ${panel.index + 1}`)}</strong>
                <span class="panel-url">${escapeHtml(state.panelUrls[panel.index] ?? '')}</span>
              </div>
              <div class="panel-viewport" data-panel-id="${panel.index}">
                ${isCF ? `<div class="verification-overlay">
                  <p>检测到验证页面</p>
                  <button class="continue-btn" data-panel="${panel.index}">我已完成验证，继续</button>
                </div>` : ''}
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>

      <div class="bottom-area">
        <div class="progress-section">
          <div class="section-head"><h2>进度</h2></div>
          ${(() => {
            const items = Object.values(state.progress);
            const systemItems = items.filter((i) => i.id.startsWith('system-'));
            const done = systemItems.filter((i) => i.status === 'done').length;
            const total = Math.max(1, systemItems.length);
            const currentStage = systemItems.find((i) => i.status === 'running');
            return `<div class="progress-bar-container"><div class="progress-bar" style="width:${Math.round((done / total) * 100)}%"></div></div>
            <p class="progress-text">${currentStage?.message ?? (state.running ? '准备中…' : state.results.length > 0 ? '完成' : '等待任务')}</p>`;
          })()}
        </div>
        <div class="results-section">
          <div class="section-head"><h2>结果列表</h2></div>
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
                  <span>最终评分：${result.finalScore}</span><span>规则评分：${result.ruleScore}</span>
                  <span>AI 评分：${result.aiScore}</span><span>总大小：${formatBytes(result.totalSize)}</span>
                </div>
                ${result.files.length > 0 ? `<h4>文件列表</h4><ul>${result.files.map((file) => `<li>${escapeHtml(file.path)} <span>${formatBytes(file.size)}</span></li>`).join('')}</ul>` : ''}
                ${result.reasons.length > 0 ? `<h4>评分理由</h4><ul>${result.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('')}</ul>` : ''}
              </div>
            </details>`).join('')}
          </div>
        </div>
      </div>
    </main>
    ${state.toastMessage ? `<div class="toast">${escapeHtml(state.toastMessage)}</div>` : ''}
  `;
}

function render(): void {
  rootElement!.innerHTML = `<div class="app-shell desktop-layout">${renderSidebar()}${renderMainContent()}</div>`;
  bindEvents();
  requestPanelResize();
}

function requestPanelResize() {
  const api = (window as any).desktopPanels;
  if (!api) return;

  requestAnimationFrame(() => {
    api.resizePanels();
  });
}

async function ensurePanelsCreated() {
  const api = getElectronPanelAPI();
  if (!api) return;
  for (let i = 0; i < state.panelCount; i++) {
    await api.createPanel(i);
  }
}

async function startBrowserIfNeeded(): Promise<void> {
  try {
    await ensurePanelsCreated();
    requestPanelResize();
    await startBrowser();
  } catch {
    upsetSimpleProgress('browser-runtime', '浏览器', 'error', '浏览器启动失败');
  }
}

function upsetSimpleProgress(id: string, label: string, status: ProgressItem['status'], message: string) {
  upsertProgress({ id, label, phase: 'system', value: 1, status, message });
}

function captureSelectorFromElectron(selector: string): void {
  if (!state.draftAdapter || state.guideStep === 'idle' || state.guideStep === 'done') return;
  state.draftAdapter = applyGuideCapture(state.draftAdapter, state.guideStep, selector);
  const toastMsg = guideToasts[state.guideStep];
  state.guideStep = nextGuideStep(state.guideStep);

  if (state.guideStep === 'done' && state.draftAdapter) {
    state.adapters = state.adapters.map((item) =>
      item.id === state.draftAdapter?.id ? state.draftAdapter : item,
    );

    showToast(guideToasts.done);
    state.draftAdapter = undefined;
    state.previewUrl = undefined;
    persist();
  } else {
    showToast(toastMsg);
    startElectronCapture(state.guideStep);
  }
  render();
}

async function startElectronCapture(step: AdapterCaptureStep) {
  const api = getElectronPanelAPI();
  if (!api || !state.draftAdapter) return;

  await api.createPanel(0);
  requestPanelResize();

  await api.navigatePanel(0, state.draftAdapter.homeUrl);
  await new Promise((r) => setTimeout(r, 1500));
  await api.startSelectorCapture(0);

  const selector = await api.waitForSelector(0, 120000);
  await api.stopSelectorCapture(0);

  if (selector) {
    captureSelectorFromElectron(selector);
  }
}

function createDraftAdapterFromForm(): void {
  const homeUrl = state.adapterHomeUrl.trim();
  if (!homeUrl) {
    showToast('请先填写资源站首页 URL');
    return;
  }

  let parsedHome: URL;
  try {
    parsedHome = new URL(homeUrl);
    if (!['http:', 'https:'].includes(parsedHome.protocol)) throw new Error('unsupported protocol');
  } catch {
    showToast('请输入有效的 http/https URL');
    return;
  }

  const name = state.adapterName.trim() || parsedHome.host;
  state.draftAdapter = newAdapter(name, parsedHome.href);
  state.adapters = [
    state.draftAdapter,
    ...state.adapters.filter((item) => item.id !== state.draftAdapter?.id),
  ];
  state.panelCount = Math.max(1, state.panelCount);
  state.guideStep = 'pick_search_input';
  state.previewUrl = parsedHome.href;
  state.adapterFormVisible = false;
  state.adapterHomeUrl = '';
  state.adapterName = '';

  persist();
  showToast(guideMessages.pick_search_input);
  render();
  startElectronCapture('pick_search_input');
}

(window as any).__onPanelTitle = (panelId: number, title: string) => {
  state.panelTitles[panelId] = title;
};
(window as any).__onPanelUrl = (panelId: number, url: string) => {
  state.panelUrls[panelId] = url;
};

function bindEvents(): void {
  document.getElementById('query')?.addEventListener('input', (event) => {
    state.query = (event.target as HTMLInputElement).value;
    updateSearchButtonState();
  });
  document.getElementById('concurrency')?.addEventListener('input', (event) => { state.panelCount = Number((event.target as HTMLInputElement).value); persist(); render(); });
  document.getElementById('ai-endpoint')?.addEventListener('change', (event) => { state.settings.aiEndpoint = (event.target as HTMLInputElement).value; persist(); });
  document.getElementById('threshold')?.addEventListener('input', (event) => { state.settings.confidenceThreshold = Number((event.target as HTMLInputElement).value); persist(); });
  document.getElementById('adapter-home-url')?.addEventListener('input', (event) => { state.adapterHomeUrl = (event.target as HTMLInputElement).value; });
  document.getElementById('adapter-name')?.addEventListener('input', (event) => { state.adapterName = (event.target as HTMLInputElement).value; });

  document.getElementById('add-adapter')?.addEventListener('click', () => {
    state.adapterFormVisible = true;
    render();
  });

  document.getElementById('hide-adapter-form')?.addEventListener('click', () => {
    state.adapterFormVisible = false;
    state.adapterHomeUrl = '';
    state.adapterName = '';
    render();
  });

  document.getElementById('save-adapter')?.addEventListener('click', createDraftAdapterFromForm);

  document.getElementById('cancel-adapter')?.addEventListener('click', () => {
    if (state.draftAdapter) {
      const draftId = state.draftAdapter.id;
      state.adapters = state.adapters.filter((item) => item.id !== draftId);
      persist();
    }

    state.guideStep = 'idle';
    state.draftAdapter = undefined;
    state.previewUrl = undefined;

    const api = getElectronPanelAPI();
    if (api) api.stopSelectorCapture(0);

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
    if (selector) captureSelectorFromElectron(selector);
  });

  document.getElementById('search')?.addEventListener('click', async () => {
    if (state.running || !state.query.trim()) return;
    state.running = true;
    state.progress = {};
    state.results = [];
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
      const result = await continueAfterVerification(panelId);

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
