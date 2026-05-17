import type { BrowserPanelStatus, MagnetExtractResult, SearchExtractResult } from './types.js';

type BrowserBackend = 'electron-panel' | 'playwright-api';
let backend: BrowserBackend = 'electron-panel';

export function setBrowserBackend(b: BrowserBackend) {
  backend = b;
}

function isElectron(): boolean {
  return typeof window !== 'undefined' && !!(window as any).desktopPanels;
}

interface DesktopPanels {
  createPanel(panelId: number): Promise<void>;
  navigatePanel(panelId: number, url: string): Promise<void>;
  resizePanels(layout: number[]): Promise<void>;
  getPanelUrl(panelId: number): Promise<string>;
  getPanelTitle(panelId: number): Promise<string>;
  executeJS(panelId: number, code: string): Promise<any>;
  injectCSS(panelId: number, css: string): Promise<void>;
  startSelectorCapture(panelId: number): Promise<void>;
  stopSelectorCapture(panelId: number): Promise<void>;
  waitForSelector(panelId: number, timeoutMs: number): Promise<string | null>;
}

function dp(): DesktopPanels | null {
  if (!isElectron()) return null;
  return (window as any).desktopPanels as DesktopPanels;
}

export async function startBrowser(): Promise<void> {
  if (isElectron()) return;
  const r = await fetch('/api/browser/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
  if (!r.ok) throw new Error(`startBrowser failed: ${r.status}`);
}

export async function openPanel(panelId: number, url: string): Promise<void> {
  if (isElectron()) {
    await dp()!.createPanel(panelId);
    await dp()!.navigatePanel(panelId, url);
    return;
  }
  const r = await fetch('/api/browser/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ panelId, url }),
  });
  if (!r.ok) throw new Error(`openPanel failed: ${r.status}`);
}

export async function runBrowserSearch(
  adapterId: string,
  keyword: string,
  panelId: number,
): Promise<SearchExtractResult> {
  if (isElectron()) {
    return runElectronPanelSearch(adapterId, keyword, panelId);
  }
  const r = await fetch('/api/browser/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adapterId, keyword, panelId }),
  });
  return r.json() as Promise<SearchExtractResult>;
}

export async function continueAfterVerification(panelId: number): Promise<{ ok: boolean; needVerification?: boolean; results?: any[]; error?: string }> {
  if (isElectron()) {
    return { ok: true };
  }
  const r = await fetch('/api/browser/continue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ panelId }),
  });
  return r.json();
}

export async function extractDetail(
  adapterId: string,
  panelId: number,
  detailUrl: string,
): Promise<MagnetExtractResult> {
  if (isElectron()) {
    return extractDetailElectron(adapterId, panelId, detailUrl);
  }
  const r = await fetch('/api/browser/detail', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adapterId, panelId, detailUrl }),
  });
  return r.json() as Promise<MagnetExtractResult>;
}

export async function getBrowserStatus(): Promise<BrowserPanelStatus[]> {
  if (isElectron()) return [];
  const r = await fetch('/api/browser/status');
  return r.json() as Promise<BrowserPanelStatus[]>;
}

async function runElectronPanelSearch(
  adapterId: string,
  keyword: string,
  panelId: number,
): Promise<SearchExtractResult> {
  const panels = dp();
  if (!panels) return { status: 'failed', results: [], message: 'Electron panels not available' };

  try {
    const adapters = (window as any).__adaptersStore;
    if (!adapters) return { status: 'failed', results: [], message: 'No adapters loaded' };

    const adapter = adapters[adapterId];
    if (!adapter) return { status: 'failed', results: [], message: `Adapter ${adapterId} not found` };

    await panels.navigatePanel(panelId, adapter.homeUrl);

    await new Promise((r) => setTimeout(r, adapter.waitAfterSearchMs || 2000));

    const currentUrl = await panels.getPanelUrl(panelId);
    const currentTitle = await panels.getPanelTitle(panelId);

    const isCF = /just a moment|checking your browser|attention required|verify you are human|checking if the site connection is secure/i.test(currentTitle) ||
      /\/cdn-cgi\/|challenge-platform/i.test(currentUrl);

    if (isCF) {
      return { status: 'need_human_verification', results: [], message: '检测到验证页面，请人工完成验证后继续', panelId, adapterId };
    }

    if (adapter.searchInputSelector) {
      const fillJs = `
        (() => {
          const el = document.querySelector(${JSON.stringify(adapter.searchInputSelector)});
          if (el) { el.value = ${JSON.stringify(keyword)}; el.dispatchEvent(new Event('input', { bubbles: true })); }
        })();
      `;
      await panels.executeJS(panelId, fillJs);
      await new Promise((r) => setTimeout(r, 500));

      if (adapter.searchButtonSelector) {
        const clickJs = `
          (() => {
            const el = document.querySelector(${JSON.stringify(adapter.searchButtonSelector)});
            if (el) el.click();
          })();
        `;
        await panels.executeJS(panelId, clickJs);
      }
      await new Promise((r) => setTimeout(r, adapter.waitAfterSearchMs || 2000));
    }

    const afterUrl = await panels.getPanelUrl(panelId);
    const afterTitle = await panels.getPanelTitle(panelId);
    const afterCF = /just a moment|checking your browser|attention required|verify you are human|checking if the site connection is secure/i.test(afterTitle) ||
      /\/cdn-cgi\/|challenge-platform/i.test(afterUrl);

    if (afterCF) {
      return { status: 'need_human_verification', results: [], message: '搜索后检测到验证页面', panelId, adapterId };
    }

    const extractJs = `
      (() => {
        const magnetSelector = ${JSON.stringify(adapter.magnetLinkSelector?.trim() || 'a[href^="magnet:"]')};
        const resultSelector = ${JSON.stringify(adapter.resultItemSelector || '')};
        const elements = document.querySelectorAll(magnetSelector);
        const results = [];
        elements.forEach((el) => {
          const href = el.href || el.getAttribute('href') || '';
          if (!href.startsWith('magnet:')) return;
          const container = resultSelector ? el.closest(resultSelector) : el.closest('article, li, tr, div');
          const title = (container?.textContent || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 200);
          results.push({ title, magnetUri: href });
        });
        return results;
      })();
    `;

    const rawItems = await panels.executeJS(panelId, extractJs);
    const results = (rawItems || []).map((item: any, idx: number) => ({
      id: `${adapterId}-${Date.now()}-${idx}`,
      sourceAdapterId: adapterId,
      sourceName: adapter.name,
      title: item.title || `Magnet ${idx + 1}`,
      magnetUri: item.magnetUri,
      detailUrl: afterUrl,
    }));

    return { status: 'ok', results, message: `提取到 ${results.length} 条磁力链接`, panelId, adapterId };
  } catch (err: any) {
    return { status: 'failed', results: [], message: err.message, panelId, adapterId };
  }
}

async function extractDetailElectron(
  adapterId: string,
  panelId: number,
  detailUrl: string,
): Promise<MagnetExtractResult> {
  const panels = dp();
  if (!panels) return { status: 'failed', title: '', detailUrl, magnet: '', message: 'Electron panels not available' };

  try {
    await panels.navigatePanel(panelId, detailUrl);
    await new Promise((r) => setTimeout(r, 2000));

    const title = await panels.getPanelTitle(panelId);

    const extractJs = `
      (() => {
        const links = document.querySelectorAll('a[href^="magnet:"]');
        for (const link of links) {
          if (link.href && link.href.startsWith('magnet:')) return link.href;
        }
        return '';
      })();
    `;

    const magnet = await panels.executeJS(panelId, extractJs);
    return { status: 'ok', title, detailUrl, magnet: magnet || '', message: magnet ? '提取成功' : '未找到磁力链接' };
  } catch (err: any) {
    return { status: 'failed', title: '', detailUrl, magnet: '', message: err.message };
  }
}

export function getElectronPanelAPI(): DesktopPanels | null {
  return dp();
}
