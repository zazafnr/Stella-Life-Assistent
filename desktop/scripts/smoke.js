// CI-Rauchtest: lädt alle Module in einer echten Electron-Laufzeit und beendet sich.
const { app } = require('electron');
const path = require('path');

const src = path.join(__dirname, '..', 'src');
try {
  const config = require(path.join(src, 'config.js'));
  const ok = config.normalizeServer('stella.example.at') === 'https://stella.example.at'
    && config.normalizeServer('http://localhost:8795/') === 'http://localhost:8795'
    && config.normalizeServer('quatsch') === null;
  if (!ok) throw new Error('normalizeServer liefert falsche Werte');
  for (const f of ['main.js', 'preload.js', 'server-preload.js', 'offline.html', 'setup.html']) {
    require('fs').accessSync(path.join(src, f));
  }
  for (const f of ['icon.png', 'icon.ico', 'tray.png', 'tray@2x.png']) {
    require('fs').accessSync(path.join(__dirname, '..', 'build', f));
  }
} catch (err) {
  console.error('SMOKE FAIL', err);
  process.exit(1);
}
app.whenReady().then(() => {
  console.log('SMOKE OK', process.versions.electron);
  app.quit();
});
