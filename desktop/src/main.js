// Stella für den PC: eigenes Fenster mit der Stella-Oberfläche, Symbol in der Taskleiste,
// Windows-/macOS-Mitteilungen und Start mit dem System.
const { app, BrowserWindow, Menu, Notification, Tray, ipcMain, nativeImage, session, shell } = require('electron');
const path = require('path');
const config = require('./config.js');

const isMac = process.platform === 'darwin';
const ICON = path.join(__dirname, '..', 'build', 'icon.png');
const TRAY_ICON = path.join(__dirname, '..', 'build', isMac ? 'tray.png' : 'tray@2x.png');

let win = null;
let setupWin = null;
let tray = null;
let quitting = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
}

app.setAppUserModelId('app.stella.desktop');

function showWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function sameOrigin(url) {
  try {
    return new URL(url).origin === new URL(config.serverUrl()).origin;
  } catch {
    return false;
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 420,
    minHeight: 560,
    title: 'Stella',
    icon: ICON,
    backgroundColor: '#F5F9FF',
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: isMac ? false : { color: '#D2E7FE', symbolColor: '#2C4566', height: 34 },
    trafficLightPosition: { x: 14, y: 12 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  win.once('ready-to-show', () => win.show());
  win.loadURL(config.serverUrl()).catch(() => {});

  // Kein Netz oder Server weg → freundliche Offline-Seite statt weißem Fenster
  win.webContents.on('did-fail-load', (_e, code, _desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 = abgebrochen (z. B. Weiterleitung)
    win.loadFile(path.join(__dirname, 'offline.html'), { query: { url } }).catch(() => {});
  });

  // Fremde Links im normalen Browser öffnen, Stella bleibt im Fenster
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!sameOrigin(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!sameOrigin(url) && !url.startsWith('file:')) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  // Schließen = in die Taskleiste, damit Erinnerungen weiter ankommen
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => { win = null; });
}

function openSetup() {
  if (setupWin) return setupWin.focus();
  setupWin = new BrowserWindow({
    width: 440,
    height: 320,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'Stella – Server',
    icon: ICON,
    backgroundColor: '#F5F9FF',
    parent: win ?? undefined,
    modal: !!win,
    webPreferences: { preload: path.join(__dirname, 'server-preload.js'), contextIsolation: true, sandbox: true },
  });
  setupWin.setMenu(null);
  setupWin.loadFile(path.join(__dirname, 'setup.html'));
  setupWin.on('closed', () => { setupWin = null; });
}

function autostartEnabled() {
  return app.getLoginItemSettings().openAtLogin;
}

function buildTray() {
  const image = nativeImage.createFromPath(TRAY_ICON);
  if (isMac) image.setTemplateImage(false);
  tray = new Tray(image);
  tray.setToolTip('Stella');
  const menu = () => Menu.buildFromTemplate([
    { label: 'Stella öffnen', click: showWindow },
    { type: 'separator' },
    {
      label: 'Mit dem Computer starten',
      type: 'checkbox',
      checked: autostartEnabled(),
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] });
        tray.setContextMenu(menu());
      },
    },
    { label: 'Server ändern …', click: openSetup },
    { type: 'separator' },
    { label: 'Beenden', click: () => { quitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu());
  tray.on('click', showWindow);
}

function buildAppMenu() {
  // Unter Windows/Linux kein Menüband – die Oberfläche hat ihre eigene Navigation
  if (!isMac) return Menu.setApplicationMenu(null);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { label: 'Ansicht', submenu: [{ role: 'reload', label: 'Neu laden' }, { role: 'togglefullscreen', label: 'Vollbild' }] },
    { role: 'windowMenu' },
  ]));
}

ipcMain.on('stella:notify', (_e, { title, body }) => {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: title || 'Stella', body: body || '', icon: ICON, silent: false });
  n.on('click', showWindow);
  n.show();
});

ipcMain.on('stella:badge', (_e, count) => {
  if (isMac || process.platform === 'linux') app.setBadgeCount(count);
  if (win && process.platform === 'win32') win.flashFrame(count > 0 && !win.isFocused());
});

ipcMain.on('stella:titlebar', (_e, color) => {
  if (!win || isMac || !/^#[0-9a-f]{6}$/i.test(color)) return;
  try { win.setTitleBarOverlay({ color, symbolColor: '#2C4566', height: 34 }); } catch { /* ältere Systeme */ }
});

// Schulbuch-Login: echtes Anmeldefenster des Anbieters (inkl. Schul-/Microsoft-Login) in einer
// frischen, nur dafür angelegten Sitzung. Beim Schließen gehen deren Cookies an die Web-App,
// die sie verschlüsselt auf dem Stella-Server ablegt. Passwörter sieht Stella dabei nie.
let bookWin = null;
ipcMain.handle('stella:book-login', async (event, { provider, url, domains }) => {
  if (!sameOrigin(event.senderFrame?.url ?? '')) throw new Error('Nur aus Stella heraus erlaubt');
  if (!/^https:\/\//.test(url)) throw new Error('Ungültige Anmeldeseite');
  let domainRe;
  try { domainRe = new RegExp(domains, 'i'); } catch { throw new Error('Ungültige Domains'); }
  if (bookWin) { bookWin.focus(); return null; }

  const partition = `book-login-${provider}-${Date.now()}`; // ohne "persist:" → nur im Speicher
  const name = provider === 'scook' ? 'scook' : 'digi4school';
  bookWin = new BrowserWindow({
    width: 1100,
    height: 820,
    parent: win ?? undefined,
    title: `Bei ${name} anmelden – danach dieses Fenster schließen`,
    icon: ICON,
    backgroundColor: '#FFFFFF',
    autoHideMenuBar: false,
    webPreferences: { partition, contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  const ses = bookWin.webContents.session;
  const finish = () => bookWin?.close();
  // "Fertig" oben im Fenster (Windows/Linux) – Schließen geht genauso
  bookWin.setMenu(Menu.buildFromTemplate([
    { label: '✓ Fertig – Anmeldung übernehmen', click: finish },
    { label: 'Abbrechen', click: () => { bookWin?.destroy(); } },
  ]));
  // Titel nicht von der Seite überschreiben lassen, damit der Hinweis stehen bleibt
  bookWin.on('page-title-updated', (e) => e.preventDefault());
  bookWin.webContents.setWindowOpenHandler(({ url: u }) => {
    bookWin?.loadURL(u).catch(() => {});
    return { action: 'deny' };
  });
  bookWin.loadURL(url).catch(() => {});

  return new Promise((resolve) => {
    let cookies = null;
    bookWin.on('close', async (e) => {
      if (cookies !== null) return;
      e.preventDefault();
      const all = await ses.cookies.get({}).catch(() => []);
      cookies = all.filter((c) => domainRe.test(String(c.domain ?? '').replace(/^\./, '')));
      bookWin.destroy();
    });
    bookWin.on('closed', () => {
      bookWin = null;
      ses.clearStorageData().catch(() => {});
      resolve(cookies && cookies.length ? cookies : null);
    });
  });
});

ipcMain.handle('stella:get-server', () => config.serverUrl());
ipcMain.handle('stella:set-server', (_e, raw) => {
  const url = config.setServer(raw);
  setupWin?.close();
  if (win) win.loadURL(url).catch(() => {});
  else createWindow();
  return url;
});
ipcMain.on('stella:retry', () => win?.loadURL(config.serverUrl()).catch(() => {}));

app.whenReady().then(() => {
  // Mikrofon für Sprachnachrichten (und Mitteilungen): nur für die eigene Stella-Seite, sonst nichts
  session.defaultSession.setPermissionRequestHandler((wc, _permission, callback) => callback(sameOrigin(wc.getURL())));
  session.defaultSession.setPermissionCheckHandler((_wc, _permission, origin) => sameOrigin(origin));

  buildAppMenu();
  createWindow();
  buildTray();
  // Beim Autostart unsichtbar in der Taskleiste starten
  if (process.argv.includes('--hidden')) win.once('ready-to-show', () => win.hide());
});

app.on('activate', showWindow);
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { /* läuft in der Taskleiste weiter */ });
