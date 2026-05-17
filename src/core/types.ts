export type GuideStep = 'idle' | 'searchInput' | 'searchButton' | 'resultItem' | 'magnetLink' | 'done';

export interface SiteAdapter {
  id: string;
  name: string;
  homeUrl: string;
  searchInputSelector?: string;
  searchButtonSelector?: string;
  resultItemSelector?: string;
  magnetLinkSelector?: string;
  searchUrlTemplate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RawMagnetResult {
  id: string;
  sourceAdapterId: string;
  sourceName: string;
  title: string;
  magnetUri: string;
  detailUrl?: string;
}

export interface TorrentFile {
  path: string;
  bytes: number;
}

export interface TorrentMetadata {
  magnetUri: string;
  infoHash?: string;
  displayName?: string;
  files: TorrentFile[];
  totalBytes: number;
  seeders?: number;
  status: 'pending' | 'analyzing' | 'complete' | 'timeout' | 'failed';
  error?: string;
}

export interface RuleScore {
  accepted: boolean;
  score: number;
  reasons: string[];
}

export interface AiScore {
  confidence: number;
  verdict: 'excellent' | 'good' | 'uncertain' | 'rejected';
  reasons: string[];
}

export interface RankedResult extends RawMagnetResult {
  metadata: TorrentMetadata;
  ruleScore: RuleScore;
  aiScore: AiScore;
}

export interface HistoryEntry {
  id: string;
  query: string;
  createdAt: string;
  results: RankedResult[];
}

export interface ProgressItem {
  id: string;
  label: string;
  phase: 'browser' | 'metadata' | 'ai' | 'system';
  value: number;
  status: 'idle' | 'running' | 'waiting' | 'done' | 'error';
  message: string;
}

export interface AppSettings {
  concurrency: number;
  aiEndpoint: string;
  aiModel: string;
  confidenceThreshold: number;
  metadataTimeoutMs: number;
}
