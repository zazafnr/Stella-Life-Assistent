// Echte Electron-Laufzeit gegen den Demo-Server (Wetter in der PC-App).
// Voraussetzung: Electron installiert (z. B. `cd desktop && npm ci`), unter Linux xvfb:  xvfb-run -a node scripts/ui-check/electron.cjs
const { _electron } = require('playwright');
const path = require('path');
const { BASE, login, weatherState, check, done } = require('./common.cjs');

(async () => {
  const electronPath = process.env.ELECTRON_PATH || require(path.join(__dirname, '..', '..', 'desktop', 'node_modules', 'electron'));
  const app = await _electron.launch({
    executablePath: electronPath,
    args: [path.join(__dirname, '..', '..', 'desktop'), '--no-sandbox', '--disable-gpu', `--user-data-dir=${process.env.TMPDIR || '/tmp'}/stella-ui-check`],
    env: { ...process.env, STELLA_SERVER: BASE.replace('127.0.0.1', 'localhost') },
  });
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(2000);
  check('Brücke window.stellaDesktop vorhanden', (await win.evaluate(() => typeof window.stellaDesktop)) === 'object');
  await login(win, { tab: 'chat', weather: 'rain' });
  const w = await weatherState(win);
  check('Electron: Wetter-Leinwand gemalt', w.canvas && w.painted > 100, `${w.painted} Punkte`);
  check('Electron: Wetter-Chip', !!w.chip, w.chip || '');
  check('Electron: keine Skriptfehler', errors.length === 0, errors.join(' | '));
  await win.screenshot({ path: '/tmp/ui-check-electron.png' });
  await app.close();
  done();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
