import { contextBridge, ipcRenderer } from 'electron';

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
  resizePanels(layout) {
    return ipcRenderer.invoke('panel:resize', layout);
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
  const panels = document.querySelectorAll('.panel-viewport');
  if (panels.length === 0) return;
  const layout = Array.from(panels).map((el) => {
    return el.getAttribute('data-panel-id');
  });
  if (layout.length > 0) {
    ipcRenderer.invoke('panel:resize', layout);
  }
};
