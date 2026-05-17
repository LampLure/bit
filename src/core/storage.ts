import type { AppSettings, HistoryEntry, SiteAdapter } from './types.js';

const ADAPTERS_KEY = 'bit.adapters.v1';
const HISTORY_KEY = 'bit.history.v1';
const SETTINGS_KEY = 'bit.settings.v1';

export const defaultSettings: AppSettings = {
  concurrency: 2,
  aiEndpoint: 'http://127.0.0.1:8080/completion',
  aiModel: 'llamacpp-local-4b',
  confidenceThreshold: 0.55,
  metadataTimeoutMs: 12_000,
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

export function loadAdapters(): SiteAdapter[] {
  return readJson<SiteAdapter[]>(ADAPTERS_KEY, []);
}

export function saveAdapters(adapters: SiteAdapter[]): void {
  writeJson(ADAPTERS_KEY, adapters);
}

export function loadHistory(): HistoryEntry[] {
  return readJson<HistoryEntry[]>(HISTORY_KEY, []);
}

export function saveHistory(history: HistoryEntry[]): void {
  writeJson(HISTORY_KEY, history.slice(0, 5));
}

export function pushHistory(entry: HistoryEntry): HistoryEntry[] {
  const existing = loadHistory().filter((item) => item.query !== entry.query);
  const next = [entry, ...existing].slice(0, 5);
  saveHistory(next);
  return next;
}

export function loadSettings(): AppSettings {
  return { ...defaultSettings, ...readJson<Partial<AppSettings>>(SETTINGS_KEY, {}) };
}

export function saveSettings(settings: AppSettings): void {
  writeJson(SETTINGS_KEY, settings);
}
