// Gespeicherte Einstellungen der PC-App (Server-Adresse, Autostart).
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULT_SERVER = 'https://stella.5-189-157-214.sslip.io';
const file = () => path.join(app.getPath('userData'), 'stella-desktop.json');

function read() {
  try {
    return JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch {
    return {};
  }
}

function write(patch) {
  const next = { ...read(), ...patch };
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(next, null, 2));
  return next;
}

/** "stella.example.at" → "https://stella.example.at" (ohne Schrägstrich am Ende) */
function normalizeServer(raw) {
  let s = String(raw || '').trim().replace(/\/+$/, '');
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    return u.hostname.includes('.') || u.hostname === 'localhost' ? u.origin : null;
  } catch {
    return null;
  }
}

module.exports = {
  DEFAULT_SERVER,
  serverUrl: () => normalizeServer(process.env.STELLA_SERVER) || normalizeServer(read().server) || DEFAULT_SERVER,
  setServer: (raw) => {
    const s = normalizeServer(raw);
    if (!s) throw new Error('Ungültige Adresse');
    write({ server: s });
    return s;
  },
  normalizeServer,
};
