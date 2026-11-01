// Gemeinsame Hilfen für die Oberflächen-Prüfungen. Voraussetzung: ein laufender Demo-Server
// (server/scripts/demo-seed.ts schreibt das Token), Adresse über STELLA_BASE, Standard http://127.0.0.1:8790.
const fs = require('fs');
const path = require('path');
const BASE = process.env.STELLA_BASE || 'http://127.0.0.1:8790';
const DEMO = process.env.STELLA_DEMO_DIR || '/tmp/stella-demo';
const token = () => fs.readFileSync(path.join(DEMO, 'token.txt'), 'utf8').trim();

/** meldet die Seite mit dem Demo-Konto an (Zustand in localStorage) und lädt #tab; optional gespeichertes Wetter */
async function login(page, { tab = 'chat', weather = null } = {}) {
  const t = token();
  const me = await page.evaluate(async (tk) => (await fetch('/api/me', { headers: { authorization: `Bearer ${tk}` } })).json(), t);
  await page.evaluate(({ tk, me, weather, tab }) => {
    localStorage.setItem('evolsiorIntroShown', '1');
    localStorage.setItem('stella.locale', 'de');
    localStorage.setItem('stella-state-v1', JSON.stringify({ token: tk, me, items: {}, messages: [], outbox: [], lastSync: null, online: true, thinking: false, busyItems: [], actions: {}, conversationId: null, pinned: false, current: null, conversations: [] }));
    if (weather) localStorage.setItem('stella.weather', JSON.stringify({ type: weather, day: true, temp: 12, wind: 3, at: Date.now() }));
    else localStorage.removeItem('stella.weather');
    location.hash = '#' + tab;
  }, { tk: t, me, weather, tab });
  await page.reload();
  await page.waitForTimeout(2500);
}

/** Zustand des Wetters auf der Seite: Leinwand da, wirklich gemalt, Chip oben */
async function weatherState(page) {
  return page.evaluate(() => {
    const c = document.querySelector('canvas.weather-canvas');
    let painted = 0;
    if (c) {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < d.length; i += 4 * 97) if (d[i]) painted++;
    }
    const chip = document.querySelector('[data-testid=weather-chip]');
    return { canvas: !!c, painted, chip: chip ? chip.textContent : null, desktopClass: document.documentElement.classList.contains('is-desktop') };
  });
}

let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' – ' + detail : ''}`); if (!ok) failed++; };
const done = () => { console.log(failed ? `${failed} Prüfung(en) fehlgeschlagen` : 'alle Prüfungen bestanden'); process.exit(failed ? 1 : 0); };

module.exports = { BASE, login, weatherState, check, done };
