import type { GuideStep, SiteAdapter } from './types.js';

export const guideMessages: Record<GuideStep, string> = {
  idle: '点击“添加资源站”后开始半自动指引。',
  searchInput: '请在右侧浏览器中点击资源站的搜索输入框。',
  searchButton: '已保存搜索框。请点击搜索按钮。',
  resultItem: '已保存搜索按钮。请点击一条搜索结果，标记结果元素。',
  magnetLink: '已保存结果元素。请进入详情页并点击磁力链接所在元素。',
  done: '资源站 adapter 已完成保存，后续搜索将自动使用。',
};

const stepOrder: GuideStep[] = ['searchInput', 'searchButton', 'resultItem', 'magnetLink', 'done'];

export function nextGuideStep(current: GuideStep): GuideStep {
  if (current === 'idle') return 'searchInput';
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

export function applyGuideCapture(adapter: SiteAdapter, step: GuideStep, selector: string): SiteAdapter {
  const next = { ...adapter, updatedAt: new Date().toISOString() };
  if (step === 'searchInput') next.searchInputSelector = selector;
  if (step === 'searchButton') next.searchButtonSelector = selector;
  if (step === 'resultItem') next.resultItemSelector = selector;
  if (step === 'magnetLink') next.magnetLinkSelector = selector;
  return next;
}

export function isAdapterReady(adapter: SiteAdapter): boolean {
  return Boolean(
    adapter.homeUrl &&
      (adapter.searchUrlTemplate || (adapter.searchInputSelector && adapter.searchButtonSelector)) &&
      adapter.resultItemSelector &&
      adapter.magnetLinkSelector,
  );
}
