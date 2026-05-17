import type { BrowserPanelStatus, MagnetExtractResult, SearchExtractResult } from './types.js';

const API = '/api/browser';

export async function startBrowser(adapters?: any[]): Promise<void> {
  const r = await fetch(`${API}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adapters }),
  });
  if (!r.ok) throw new Error(`startBrowser failed: ${r.status}`);
}

export async function openPanel(panelId: number, url: string): Promise<void> {
  const r = await fetch(`${API}/open`, {
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
  const r = await fetch(`${API}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adapterId, keyword, panelId }),
  });
  return r.json() as Promise<SearchExtractResult>;
}

export async function continueAfterVerification(panelId: number): Promise<{ ok: boolean; needVerification?: boolean; results?: any[]; error?: string }> {
  const r = await fetch(`${API}/continue`, {
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
  const r = await fetch(`${API}/detail`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adapterId, panelId, detailUrl }),
  });
  return r.json() as Promise<MagnetExtractResult>;
}

export async function getBrowserStatus(): Promise<BrowserPanelStatus[]> {
  const r = await fetch(`${API}/status`);
  return r.json() as Promise<BrowserPanelStatus[]>;
}
