import type { ProgressStage, ProgressState } from './types.js';

export type { ProgressStage, ProgressState };

export function createProgressState(): ProgressState {
  return {
    stage: 'idle',
    message: '',
    current: 0,
    total: 0,
    panels: [],
  };
}

export const stageMessages: Record<ProgressStage, string> = {
  idle: '',
  opening_site: '正在打开资源站',
  waiting_verification: '等待用户完成人机验证',
  searching: '正在提取搜索结果',
  extracting_results: '正在提取搜索结果',
  extracting_magnets: '正在进入详情页',
  fetching_metadata: '正在获取 metadata',
  rule_filtering: '正在规则预筛',
  ai_scoring: '正在 AI 评分',
  done: '完成',
  failed: '失败',
};

export function updateProgress(state: ProgressState, partial: Partial<ProgressState>): ProgressState {
  return { ...state, ...partial };
}

export function setPanelStatus(
  state: ProgressState,
  panelId: number,
  status: string,
  siteName?: string,
  url?: string,
): ProgressState {
  const panels = [...state.panels];
  const idx = panels.findIndex((p) => p.panelId === panelId);
  const panel = { panelId, status, siteName, url };
  if (idx >= 0) {
    panels[idx] = panel;
  } else {
    panels.push(panel);
  }
  return { ...state, panels };
}
