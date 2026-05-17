import { contextBridge } from 'electron';

const panels = new Map();
const panelReady = new Map();
const selectorPollDelayMs = 200;

function getViewport(panelId) {
  return document.querySelector(`.panel-viewport[data-panel-id="${panelId}"]`);
}

function markPanelStatus(panelId, status) {
  window.__onPanelStatus && window.__onPanelStatus(panelId, status);
}

function createWebview(panelId) {
  const viewport = getViewport(panelId);
  if (!viewport) return null;

  let view = panels.get(panelId);
  if (view && view.isConnected) return view;

  view = document.createElement('webview');
  view.setAttribute('partition', 'persist:magnet-ai-client');
  view.setAttribute('allowpopups', 'true');
  view.setAttribute('webpreferences', 'contextIsolation=yes,nodeIntegration=no');
  view.style.width = '100%';
  view.style.height = '100%';
  view.style.display = 'flex';
  view.style.border = '0';
  view.style.background = '#ffffff';

  panelReady.set(panelId, false);

  view.addEventListener('dom-ready', () => {
    panelReady.set(panelId, true);
    markPanelStatus(panelId, '页面已加载，可以在这里点击要录制的元素');
  });

  view.addEventListener('did-start-loading', () => {
    panelReady.set(panelId, false);
    markPanelStatus(panelId, '正在加载网页...');
  });

  view.addEventListener('did-finish-load', () => {
    panelReady.set(panelId, true);
    markPanelStatus(panelId, '页面加载完成，可以点击搜索框');
  });

  view.addEventListener('did-fail-load', (event) => {
    panelReady.set(panelId, true);
    markPanelStatus(panelId, `页面加载失败：${event.errorDescription || event.errorCode}`);
  });

  view.addEventListener('page-title-updated', (event) => {
    window.__onPanelTitle && window.__onPanelTitle(panelId, event.title || '');
  });

  view.addEventListener('did-navigate', (event) => {
    window.__onPanelUrl && window.__onPanelUrl(panelId, event.url || '');
  });

  view.addEventListener('did-navigate-in-page', (event) => {
    window.__onPanelUrl && window.__onPanelUrl(panelId, event.url || '');
  });

  viewport.replaceChildren(view);
  panels.set(panelId, view);
  return view;
}

function waitForWebview(panelId, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();

    const tick = () => {
      const view = panels.get(panelId) || createWebview(panelId);
      if (view && typeof view.executeJavaScript === 'function') {
        resolve(view);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Panel ${panelId} webview is not available`));
        return;
      }
      setTimeout(tick, 100);
    };

    tick();
  });
}

function waitForDomReady(panelId, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const start = Date.now();

    const tick = () => {
      if (panelReady.get(panelId)) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        resolve();
        return;
      }
      setTimeout(tick, 100);
    };

    tick();
  });
}

async function executeInPanel(panelId, code) {
  const view = await waitForWebview(panelId);
  await waitForDomReady(panelId);
  return view.executeJavaScript(code);
}

contextBridge.exposeInMainWorld('desktopPanels', {
  async createPanel(panelId) {
    createWebview(panelId);
  },

  async destroyPanel(panelId) {
    const view = panels.get(panelId);
    if (view) view.remove();
    panels.delete(panelId);
    panelReady.delete(panelId);
  },

  async navigatePanel(panelId, url) {
    const view = createWebview(panelId) || await waitForWebview(panelId);
    panelReady.set(panelId, false);
    markPanelStatus(panelId, `正在打开 ${url}`);
    view.src = url;
  },

  async resizePanels() {
    for (const [panelId, view] of panels) {
      const viewport = getViewport(panelId);
      if (viewport && view.parentElement !== viewport) {
        viewport.replaceChildren(view);
      }
    }
  },

  async getPanelUrl(panelId) {
    const view = panels.get(panelId);
    return view?.getURL?.() || view?.src || '';
  },

  async getPanelTitle(panelId) {
    const view = panels.get(panelId);
    return view?.getTitle?.() || '';
  },

  async executeJS(panelId, code) {
    return executeInPanel(panelId, code);
  },

  async injectCSS(panelId, css) {
    const view = await waitForWebview(panelId);
    if (typeof view.insertCSS === 'function') return view.insertCSS(css);
    return undefined;
  },

  async startSelectorCapture(panelId) {
    return executeInPanel(panelId, `
      (() => {
        if (window.__selectorCaptureHandler) {
          document.removeEventListener('click', window.__selectorCaptureHandler, true);
        }

        window.__selectorCaptureResult = null;
        window.__selectorCaptureActive = true;

        function buildStableSelector(el) {
          if (!el || el.nodeType !== 1) return '';
          if (el.id) return '#' + CSS.escape(el.id);
          if (el.name) return '[name="' + el.name + '"]';
          if (el.className && typeof el.className === 'string') {
            const cls = el.className.split(/\\s+/).filter(Boolean).slice(0, 2).map(c => '.' + CSS.escape(c)).join('');
            if (cls) {
              const sel = el.tagName.toLowerCase() + cls;
              if (document.querySelectorAll(sel).length === 1) return sel;
            }
          }
          const href = el.getAttribute('href');
          if (href) {
            const sel = 'a[href="' + href.replace(/"/g, '\\\\"') + '"]';
            if (document.querySelectorAll(sel).length === 1) return sel;
          }
          const parts = [];
          let node = el;
          while (node && node.nodeType === 1 && parts.length < 5) {
            let part = node.tagName.toLowerCase();
            if (node.className && typeof node.className === 'string') {
              part += node.className.split(/\\s+/).filter(Boolean).slice(0, 2).map(c => '.' + CSS.escape(c)).join('');
            }
            const siblings = Array.from(node.parentElement?.children || []).filter(c => c.tagName === node.tagName);
            if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
            parts.unshift(part);
            node = node.parentElement;
          }
          return parts.join(' > ');
        }

        window.__selectorCaptureHandler = event => {
          if (!window.__selectorCaptureActive) return;
          event.preventDefault();
          event.stopPropagation();
          window.__selectorCaptureResult = buildStableSelector(event.target);
          window.__selectorCaptureActive = false;
          document.removeEventListener('click', window.__selectorCaptureHandler, true);
        };

        document.addEventListener('click', window.__selectorCaptureHandler, true);
      })();
    `);
  },

  async stopSelectorCapture(panelId) {
    return executeInPanel(panelId, `
      (() => {
        window.__selectorCaptureActive = false;
        if (window.__selectorCaptureHandler) {
          document.removeEventListener('click', window.__selectorCaptureHandler, true);
        }
      })();
    `).catch(() => undefined);
  },

  async waitForSelector(panelId, timeoutMs) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      const result = await executeInPanel(panelId, 'window.__selectorCaptureResult || null').catch(() => null);
      if (result) {
        await executeInPanel(panelId, 'window.__selectorCaptureResult = null').catch(() => undefined);
        return result;
      }
      await new Promise((resolve) => setTimeout(resolve, selectorPollDelayMs));
    }

    return null;
  },
});

window.__emitPanelLayout = () => {
  for (const [panelId, view] of panels) {
    const viewport = getViewport(panelId);
    if (viewport && view.parentElement !== viewport) {
      viewport.replaceChildren(view);
    }
  }
};
