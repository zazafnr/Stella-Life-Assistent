// Brücke zwischen Web-App und PC-App. Die Web-App erkennt daran, dass sie in der PC-App läuft.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('stellaDesktop', {
  platform: process.platform,
  notify: (title, body) => ipcRenderer.send('stella:notify', { title: String(title).slice(0, 80), body: String(body).slice(0, 300) }),
  setBadge: (count) => ipcRenderer.send('stella:badge', Number(count) || 0),
  /** Farbe hinter den Fensterknöpfen (Windows/Linux), passend zur aktuellen Seite */
  setTitleBarColor: (color) => ipcRenderer.send('stella:titlebar', String(color)),
});
