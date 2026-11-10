// CI-Rauchtest: lädt die Module in einer echten Electron-Laufzeit und beendet sich.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

try {
  for (const f of ['main.js', 'preload.js', 'offline.html']) fs.accessSync(path.join(__dirname, '..', 'src', f));
  for (const f of ['icon.png', 'icon.ico']) fs.accessSync(path.join(__dirname, '..', 'build', f));
  new Function(fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8').replace(/^#!.*\n/, ''));
} catch (err) {
  console.error('SMOKE FAIL', err);
  process.exit(1);
}
app.whenReady().then(() => { console.log('SMOKE OK', process.versions.electron); app.quit(); });
