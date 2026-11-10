// EVOLSIOR Dashboard für den PC: eigenes Fenster mit dashboard.evolsior.com, ohne Browser.
// Die App rechnet nichts selbst – Anmeldung und Zahlen kommen wie im Browser vom Stella-Server.
const { app, BrowserWindow, Menu, shell, screen } = require('electron');
const fs = require('fs');
const path = require('path');

const DASHBOARD = process.env.EVOLSIOR_DASHBOARD_URL || 'https://dashboard.evolsior.com';
const ICON = path.join(__dirname, '..', 'build', 'icon.png');
const isMac = process.platform === 'darwin';
let win = null;
let lastLoad = 0;

if (!app.requestSingleInstanceLock()) app.quit();
else app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });

app.setAppUserModelId('com.evolsior.dashboard');

// Fenstergröße und -position merken
const stateFile = () => path.join(app.getPath('userData'), 'window.json');
function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    const visible = screen.getAllDisplays().some((d) => s.x >= d.bounds.x - 50 && s.y >= d.bounds.y - 50 && s.x < d.bounds.x + d.bounds.width && s.y < d.bounds.y + d.bounds.height);
    return visible ? s : { width: s.width, height: s.height };
  } catch { return { width: 1360, height: 900 }; }
}
function saveState() {
  if (!win || win.isDestroyed()) return;
  try { fs.writeFileSync(stateFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() })); } catch { /* egal */ }
}

const sameOrigin = (url) => { try { return new URL(url).origin === new URL(DASHBOARD).origin; } catch { return false; } };

function load() {
  lastLoad = Date.now();
  win.loadURL(DASHBOARD).catch(() => {});
}

function createWindow() {
  const st = loadState();
  win = new BrowserWindow({
    width: st.width || 1360, height: st.height || 900, x: st.x, y: st.y,
    minWidth: 420, minHeight: 560,
    title: 'EVOLSIOR Dashboard', icon: ICON, backgroundColor: '#09090B', show: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  if (st.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  load();

  // Kein Netz → Offline-Seite mit „Erneut versuchen“
  win.webContents.on('did-fail-load', (_e, code, _d, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    win.loadFile(path.join(__dirname, 'offline.html'), { query: { url } }).catch(() => {});
  });
  // Links zur Website, zu Stella usw. im normalen Browser öffnen
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => {
    if (sameOrigin(url) || url.startsWith('file:')) return;
    e.preventDefault();
    if (/^(https?|mailto):/.test(url)) shell.openExternal(url);
  });
  // F5 / Strg+R: neu laden (Zahlen aktualisieren), Strg+Plus/Minus: Zoom
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const mod = input.control || input.meta;
    if (input.key === 'F5' || (mod && input.key.toLowerCase() === 'r')) { e.preventDefault(); load(); }
  });
  // Nach längerer Pause beim Zurückkommen frische Zahlen holen
  win.on('focus', () => { if (Date.now() - lastLoad > 15 * 60_000 && sameOrigin(win.webContents.getURL())) load(); });
  win.on('close', saveState);
  win.on('closed', () => { win = null; });
}

function buildMenu() {
  if (!isMac) return Menu.setApplicationMenu(null);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ label: 'Reload numbers', accelerator: 'CmdOrCtrl+R', click: () => win && load() }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ]));
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => { if (!win) createWindow(); });
});
app.on('window-all-closed', () => { if (!isMac) app.quit(); });
