import { BrowserView } from 'electron';

export class PanelManager {
  constructor(mainWindow, session) {
    this.mainWindow = mainWindow;
    this.session = session;
    this.panels = new Map();
    this.captureCallbacks = new Map();
  }

  createPanel(panelId) {
    if (this.panels.has(panelId)) return;

    const view = new BrowserView({
      webPreferences: {
        session: this.session,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    this.mainWindow.addBrowserView(view);
    view.setAutoResize({ width: false, height: false });
    view.setBounds({ x: 0, y: 0, width: 1, height: 1 });

    view.webContents.on('page-title-updated', () => {
      const title = view.webContents.getTitle();
      this.mainWindow.webContents.executeJavaScript(
        `window.__onPanelTitle && window.__onPanelTitle(${panelId}, ${JSON.stringify(title)})`,
      ).catch(() => {});
    });

    view.webContents.on('did-navigate', (_event, url) => {
      this.mainWindow.webContents.executeJavaScript(
        `window.__onPanelUrl && window.__onPanelUrl(${panelId}, ${JSON.stringify(url)})`,
      ).catch(() => {});
    });

    this.panels.set(panelId, view);
  }

  destroyPanel(panelId) {
    const view = this.panels.get(panelId);
    if (!view) return;
    this.mainWindow.removeBrowserView(view);
    view.webContents.destroy();
    this.panels.delete(panelId);
    this.captureCallbacks.delete(panelId);
  }

  destroyAll() {
    for (const [panelId] of this.panels) {
      this.destroyPanel(panelId);
    }
  }

  navigate(panelId, url) {
    const view = this.panels.get(panelId);
    if (!view) return;
    view.webContents.loadURL(url);
  }

  resize(layout) {
    if (!Array.isArray(layout)) return;

    const visibleIds = new Set();

    for (const item of layout) {
      const panelId = Number(item.id);
      const view = this.panels.get(panelId);
      if (!view) continue;

      const x = Math.max(0, Number(item.x) || 0);
      const y = Math.max(0, Number(item.y) || 0);
      const width = Math.max(1, Number(item.width) || 1);
      const height = Math.max(1, Number(item.height) || 1);

      visibleIds.add(panelId);
      view.setBounds({ x, y, width, height });
    }

    for (const [panelId, view] of this.panels) {
      if (!visibleIds.has(panelId)) {
        view.setBounds({ x: 0, y: 0, width: 1, height: 1 });
      }
    }
  }

  getURL(panelId) {
    const view = this.panels.get(panelId);
    if (!view) return '';
    return view.webContents.getURL();
  }

  getTitle(panelId) {
    const view = this.panels.get(panelId);
    if (!view) return '';
    return view.webContents.getTitle();
  }

  executeJavaScript(panelId, code) {
    const view = this.panels.get(panelId);
    if (!view) return undefined;
    return view.webContents.executeJavaScript(code);
  }

  insertCSS(panelId, css) {
    const view = this.panels.get(panelId);
    if (!view) return undefined;
    return view.webContents.insertCSS(css);
  }

  startSelectorCapture(panelId) {
    const view = this.panels.get(panelId);
    if (!view) return;
    this.captureCallbacks.set(panelId, null);

    view.webContents.executeJavaScript(`
      (() => {
        window.__selectorCaptureResolve = null;
        window.__selectorCaptureActive = true;

        function buildStableSelector(el) {
          if (el.id) return '#' + CSS.escape(el.id);
          if (el.name) return '[name="' + el.name + '"]';
          if (el.className && typeof el.className === 'string') {
            const cls = el.className.split(/\\s+/).slice(0, 2).map(c => '.' + CSS.escape(c)).join('');
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
              part += node.className.split(/\\s+/).slice(0, 2).map(c => '.' + CSS.escape(c)).join('');
            }
            const siblings = Array.from(node.parentElement?.children || []).filter(c => c.tagName === node.tagName);
            if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
            parts.unshift(part);
            node = node.parentElement;
          }
          return parts.join(' > ');
        }

        document.addEventListener('click', event => {
          if (!window.__selectorCaptureActive) return;
          event.preventDefault();
          event.stopPropagation();
          const selector = buildStableSelector(event.target);
          window.__selectorCaptureResult = selector;
          if (window.__selectorCaptureResolve) {
            window.__selectorCaptureResolve(selector);
            window.__selectorCaptureResolve = null;
          }
          window.__selectorCaptureActive = false;
        }, true);
      })();
    `).catch(() => {});
  }

  stopSelectorCapture(panelId) {
    const view = this.panels.get(panelId);
    if (!view) return;
    view.webContents.executeJavaScript(`
      window.__selectorCaptureActive = false;
      if (window.__selectorCaptureResolve) window.__selectorCaptureResolve(null);
    `).catch(() => {});
    this.captureCallbacks.delete(panelId);
  }

  async waitForSelector(panelId, timeoutMs = 30000) {
    const view = this.panels.get(panelId);
    if (!view) return null;

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve(null);
      }, timeoutMs);

      const poll = async () => {
        try {
          const result = await view.webContents.executeJavaScript('window.__selectorCaptureResult');
          if (result) {
            clearTimeout(timer);
            await view.webContents.executeJavaScript('window.__selectorCaptureResult = null');
            resolve(result);
            return;
          }
          setTimeout(poll, 200);
        } catch {
          clearTimeout(timer);
          resolve(null);
        }
      };

      view.webContents.executeJavaScript(`
        window.__selectorCaptureResolve = (selector) => {
          window.__selectorCaptureResult = selector;
        };
      `).then(poll).catch(() => {
        clearTimeout(timer);
        resolve(null);
      });
    });
  }
}
