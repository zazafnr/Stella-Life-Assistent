// Das Dashboard erkennt daran, dass es in der Desktop-App läuft (Anmeldung bleibt dann über Neustarts erhalten).
const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('evolsiorDesktop', { version: 1, platform: process.platform });
