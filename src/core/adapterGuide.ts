import type { Adapter, AdapterCaptureStep } from './types.js';

export const guideMessages: Record<AdapterCaptureStep, string> = {
  idle: '点击"添加资源站"后开始半自动指引。',
  pick_search_input: '请点击搜索框',
  pick_search_button: '已保存搜索框。请点击搜索按钮',
  pick_result_item: '已保存搜索按钮。请点击一条搜索结果项',
  pick_magnet_link: '已保存结果项。请点击磁力链接所在元素',
  done: '资源站 adapter 已完成保存，后续搜索将自动使用。',
};

export const guideToasts: Record<AdapterCaptureStep, string> = {
  idle: '',
  pick_search_input: '搜索框已保存',
  pick_search_button: '搜索按钮已保存',
  pick_result_item: '搜索结果项已保存',
  pick_magnet_link: '磁力链接已保存',
  done: '全部录制完成',
};

const stepOrder: AdapterCaptureStep[] = ['pick_search_input', 'pick_search_button', 'pick_result_item', 'pick_magnet_link', 'done'];

export function nextGuideStep(current: AdapterCaptureStep): AdapterCaptureStep {
  if (current === 'idle') return 'pick_search_input';
  const index = stepOrder.indexOf(current);
  return stepOrder[Math.min(index + 1, stepOrder.length - 1)] ?? 'done';
}

export function selectorFromElement(element: Element): string {
  if (element.id) return `#${CSS.escape(element.id)}`;
  const parts: string[] = [];
  let node: Element | null = element;
  while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
    const tag = node.tagName.toLowerCase();
    const className = Array.from(node.classList).slice(0, 2).map((item) => `.${CSS.escape(item)}`).join('');
    const sameTagSiblings = Array.from(node.parentElement?.children ?? []).filter((child) => child.tagName === node?.tagName);
    const nth = sameTagSiblings.length > 1 ? `:nth-of-type(${sameTagSiblings.indexOf(node) + 1})` : '';
    parts.unshift(`${tag}${className}${nth}`);
    node = node.parentElement;
  }
  return parts.join(' > ');
}

export function applyGuideCapture(adapter: Adapter, step: AdapterCaptureStep, selector: string): Adapter {
  const next = { ...adapter, updatedAt: Date.now() };
  if (step === 'pick_search_input') next.searchInputSelector = selector;
  if (step === 'pick_search_button') next.searchButtonSelector = selector;
  if (step === 'pick_result_item') next.resultItemSelector = selector;
  if (step === 'pick_magnet_link') next.magnetLinkSelector = selector;
  return next;
}

export function isAdapterReady(adapter: Adapter): boolean {
  return Boolean(
    adapter.homeUrl &&
      (adapter.searchMode === 'url-template'
        ? adapter.searchUrlTemplate
        : adapter.searchInputSelector && adapter.searchButtonSelector) &&
      adapter.resultItemSelector &&
      adapter.magnetLinkSelector,
  );
}
