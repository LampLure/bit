import { app, BrowserWindow, ipcMain, session } from 'electron';
import { resolve } from 'node:path';
import { PanelManager } from './panelManager.mjs';

const PORT = process.env.PORT ?? '4173';
const BACKEND_URL = process.env.ELECTRON_BACKEND_URL ?? `http://127.0.0.1:${PORT}`;

let mainWindow = null;
let panelManager = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    title: 'Bit Resource Finder',
    webPreferences: {
      preload: resolve(import.meta.dirname ?? '.', 'electron/preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: '#0c111d',
  });

  mainWindow.loadURL(BACKEND_URL);

  mainWindow.on('resize', () => {
    if (panelManager) {
      mainWindow.webContents.executeJavaScript(
        `window.__emitPanelLayout && window.__emitPanelLayout()`,
      ).catch(() => {});
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  const persistSession = session.fromPartition('persist:magnet-ai-client');

  createMainWindow();
  panelManager = new PanelManager(mainWindow, persistSession);

  ipcMain.handle('panel:create', (_event, panelId) => {
    panelManager.createPanel(panelId);
  });

  ipcMain.handle('panel:destroy', (_event, panelId) => {
    panelManager.destroyPanel(panelId);
  });

  ipcMain.handle('panel:navigate', (_event, panelId, url) => {
    panelManager.navigate(panelId, url);
  });

  ipcMain.handle('panel:resize', (_event, layout) => {
    if (panelManager) {
      panelManager.resize(layout);
    }
  });

  ipcMain.handle('panel:get-url', (_event, panelId) => {
    return panelManager.getURL(panelId);
  });

  ipcMain.handle('panel:get-title', (_event, panelId) => {
    return panelManager.getTitle(panelId);
  });

  ipcMain.handle('panel:execute-js', (_event, panelId, code) => {
    return panelManager.executeJavaScript(panelId, code);
  });

  ipcMain.handle('panel:inject-css', (_event, panelId, css) => {
    return panelManager.insertCSS(panelId, css);
  });

  ipcMain.handle('panel:capture-selector-start', (_event, panelId) => {
    return panelManager.startSelectorCapture(panelId);
  });

  ipcMain.handle('panel:capture-selector-stop', (_event, panelId) => {
    return panelManager.stopSelectorCapture(panelId);
  });

  ipcMain.handle('panel:capture-selector-wait', (_event, panelId, timeoutMs) => {
    return panelManager.waitForSelector(panelId, timeoutMs);
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  if (panelManager) {
    panelManager.destroyAll();
  }
});
