export type AdapterCaptureStep =
  | 'idle'
  | 'pick_search_input'
  | 'pick_search_button'
  | 'pick_result_item'
  | 'pick_magnet_link'
  | 'done';

export type Adapter = {
  id: string;
  name: string;
  homeUrl: string;

  searchMode: 'browser' | 'url-template';

  searchUrlTemplate?: string;

  searchInputSelector: string;
  searchButtonSelector: string;
  resultItemSelector: string;
  resultTitleSelector?: string;
  resultLinkSelector?: string;

  magnetLinkSelector: string;

  waitAfterSearchMs: number;
  waitAfterDetailMs: number;

  createdAt: number;
  updatedAt: number;
};

export type SiteAdapter = Adapter;

export type GuideStep = AdapterCaptureStep;

export interface FetchedPage {
  url: string;
  status: number;
  ok: boolean;
  title: string;
  html: string;
  cloudflareDetected: boolean;
  error?: string;
}

export type PageFetcher = (url: string) => Promise<FetchedPage>;

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
  name: string;
  size: number;
  extension: string;
  bytes?: number;
}

export type TorrentMetadataStatus =
  | 'ok'
  | 'timeout'
  | 'invalid'
  | 'no_metadata'
  | 'error';

export interface TorrentMetadata {
  magnet: string;
  magnetUri: string;
  infoHash: string;
  name: string;
  displayName?: string;
  files: TorrentFile[];
  totalSize: number;
  totalBytes?: number;
  seeders?: number;
  peers?: number;
  status: TorrentMetadataStatus;
  elapsedMs: number;
  error?: string;
}

export interface RuleScore {
  accepted: boolean;
  score: number;
  reasons: string[];
  hardReject: boolean;
}

export interface AiScore {
  confidence: number;
  verdict: 'excellent' | 'good' | 'uncertain' | 'rejected';
  reasons: string[];
  score: number;
  is_real_video_resource: boolean;
  is_ad_or_trap: boolean;
  reason: string;
}

export interface RankedResult extends RawMagnetResult {
  metadata: TorrentMetadata;
  ruleScore: RuleScore;
  aiScore: AiScore;
  finalScore: number;
}

export interface HistoryEntry {
  id: string;
  query: string;
  keyword: string;
  createdAt: string;
  results: RankedResult[];
}

export interface SearchHistoryEntry {
  id: string;
  keyword: string;
  createdAt: number;
  results: FinalResult[];
}

export interface FinalResult {
  id: string;
  title: string;
  magnet: string;
  finalScore: number;
  ruleScore: number;
  aiScore: number;
  infoHash: string;
  files: TorrentFile[];
  totalSize: number;
  reasons: string[];
}

export interface ProgressItem {
  id: string;
  label: string;
  phase: 'browser' | 'metadata' | 'ai' | 'system';
  value: number;
  status: 'idle' | 'running' | 'waiting' | 'done' | 'error';
  message: string;
}

export type ProgressStage =
  | 'idle'
  | 'opening_site'
  | 'waiting_verification'
  | 'searching'
  | 'extracting_results'
  | 'extracting_magnets'
  | 'fetching_metadata'
  | 'rule_filtering'
  | 'ai_scoring'
  | 'done'
  | 'failed';

export interface ProgressState {
  stage: ProgressStage;
  message: string;
  current: number;
  total: number;
  panels: Array<{
    panelId: number;
    siteName?: string;
    status: string;
    url?: string;
  }>;
}

export interface AppSettings {
  concurrency: number;
  aiEndpoint: string;
  aiModel: string;
  confidenceThreshold: number;
  metadataTimeoutMs: number;
  torrentConcurrency: number;
}

export interface BrowserPanelStatus {
  panelId: number;
  status: 'idle' | 'loading' | 'need_human_verification' | 'extracting' | 'done' | 'failed';
  siteName?: string;
  url?: string;
  adapterId?: string;
  error?: string;
}

export interface SearchExtractResult {
  status: 'ok' | 'need_human_verification' | 'failed';
  results: RawMagnetResult[];
  message?: string;
  panelId?: number;
  adapterId?: string;
}

export interface MagnetExtractResult {
  status: 'ok' | 'need_human_verification' | 'failed';
  title: string;
  detailUrl: string;
  magnet: string;
  message?: string;
}

export interface AiScoreItem {
  id: string;
  score: number;
  is_real_video_resource: boolean;
  is_ad_or_trap: boolean;
  reason: string;
}

export interface AiBatchResponse {
  items: AiScoreItem[];
}
