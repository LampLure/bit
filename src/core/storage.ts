import type { AppSettings, HistoryEntry, SearchHistoryEntry, FinalResult, Adapter, RankedResult } from './types.js';

const ADAPTERS_KEY = 'bit.adapters.v2';
const HISTORY_KEY = 'bit.history.v2';
const SETTINGS_KEY = 'bit.settings.v2';

export const defaultSettings: AppSettings = {
  concurrency: 2,
  aiEndpoint: 'http://127.0.0.1:8080/completion',
  aiModel: 'llamacpp-local-4b',
  confidenceThreshold: 55,
  metadataTimeoutMs: 45_000,
  torrentConcurrency: 4,
};

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export function loadAdapters(): Adapter[] {
  return readJson<Adapter[]>(ADAPTERS_KEY, []);
}

export function saveAdapters(adapters: Adapter[]): void {
  writeJson(ADAPTERS_KEY, adapters);
}

export function loadHistory(): HistoryEntry[] {
  return readJson<HistoryEntry[]>(HISTORY_KEY, []);
}

export function saveHistory(history: HistoryEntry[]): void {
  writeJson(HISTORY_KEY, history.slice(0, 5));
}

export function pushHistory(entry: HistoryEntry): HistoryEntry[] {
  const existing = loadHistory();
  const next = [entry, ...existing].slice(0, 5);
  saveHistory(next);
  return next;
}

export function loadSearchHistory(): SearchHistoryEntry[] {
  try {
    const raw = localStorage.getItem('bit.search_history.v1');
    return raw ? (JSON.parse(raw) as SearchHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

export function saveSearchHistory(history: SearchHistoryEntry[]): void {
  const trimmed = history.slice(0, 5);
  localStorage.setItem('bit.search_history.v1', JSON.stringify(trimmed));
}

export function pushSearchHistory(keyword: string, results: FinalResult[]): SearchHistoryEntry[] {
  const existing = loadSearchHistory();
  const entry: SearchHistoryEntry = {
    id: crypto.randomUUID(),
    keyword,
    createdAt: Date.now(),
    results,
  };
  const next = [entry, ...existing].slice(0, 5);
  saveSearchHistory(next);
  return next;
}

export function loadSettings(): AppSettings {
  return { ...defaultSettings, ...readJson<Partial<AppSettings>>(SETTINGS_KEY, {}) };
}

export function saveSettings(settings: AppSettings): void {
  writeJson(SETTINGS_KEY, settings);
}
