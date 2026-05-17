import { contextBridge, ipcRenderer } from 'electron';

function collectPanelLayout() {
  const panels = document.querySelectorAll('.panel-viewport');

  return Array.from(panels).map((el) => {
    const rect = el.getBoundingClientRect();

    return {
      id: Number(el.getAttribute('data-panel-id')),
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }).filter((item) =>
    Number.isFinite(item.id) &&
    item.width > 0 &&
    item.height > 0
  );
}

contextBridge.exposeInMainWorld('desktopPanels', {
  createPanel(panelId) {
    return ipcRenderer.invoke('panel:create', panelId);
  },

  destroyPanel(panelId) {
    return ipcRenderer.invoke('panel:destroy', panelId);
  },

  navigatePanel(panelId, url) {
    return ipcRenderer.invoke('panel:navigate', panelId, url);
  },

  resizePanels() {
    return ipcRenderer.invoke('panel:resize', collectPanelLayout());
  },

  getPanelUrl(panelId) {
    return ipcRenderer.invoke('panel:get-url', panelId);
  },

  getPanelTitle(panelId) {
    return ipcRenderer.invoke('panel:get-title', panelId);
  },

  executeJS(panelId, code) {
    return ipcRenderer.invoke('panel:execute-js', panelId, code);
  },

  injectCSS(panelId, css) {
    return ipcRenderer.invoke('panel:inject-css', panelId, css);
  },

  startSelectorCapture(panelId) {
    return ipcRenderer.invoke('panel:capture-selector-start', panelId);
  },

  stopSelectorCapture(panelId) {
    return ipcRenderer.invoke('panel:capture-selector-stop', panelId);
  },

  waitForSelector(panelId, timeoutMs) {
    return ipcRenderer.invoke('panel:capture-selector-wait', panelId, timeoutMs);
  },
});

window.__emitPanelLayout = () => {
  ipcRenderer.invoke('panel:resize', collectPanelLayout());
};
