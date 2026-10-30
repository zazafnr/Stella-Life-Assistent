// Nur für das kleine Fenster "Server ändern" und die Offline-Seite.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('stellaSetup', {
  current: () => ipcRenderer.invoke('stella:get-server'),
  save: (url) => ipcRenderer.invoke('stella:set-server', url),
  retry: () => ipcRenderer.send('stella:retry'),
});
