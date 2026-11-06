// Screenshots von Monat, Woche und Tag des Kalenders in einer Sprache (Beispieltermine werden angelegt).
//   Voraussetzung: Server ohne Plugin auf BASE (Standard http://127.0.0.1:8787, frische Datenbank, STELLA_REGISTRATION=open), Web-App gebaut.
//   OUT=/tmp/shots LOC=de W=1280 H=900 node scripts/ui-check/calendar.cjs     (W=390 für das Handy, W=320 für schmale Geräte)
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:8787', OUT = process.env.OUT, LOC = process.env.LOC || 'de';
const W = Number(process.env.W || 1280), H = Number(process.env.H || 900);
const H0 = { 'content-type': 'application/json', 'x-stella-edition': 'life' };
const ymd = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
(async () => {
  const reg = await (await fetch(`${BASE}/api/auth/register`, { method: 'POST', headers: H0, body: JSON.stringify({ name: 'Mia', email: `cal${Date.now()}@example.com`, password: 'supergeheim', timeZone: 'Europe/Vienna', locale: LOC }) })).json();
  const A = { ...H0, authorization: `Bearer ${reg.token}` };
  await fetch(`${BASE}/api/profile`, { method: 'PUT', headers: A, body: JSON.stringify({ situation: 'work', features: ['planner', 'mails', 'goals', 'health'], workHours: { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' } }) });
  await fetch(`${BASE}/api/settings`, { method: 'PATCH', headers: A, body: JSON.stringify({ locale: LOC }) });
  const mk = (title, due, time, duration, extra = {}) => fetch(`${BASE}/api/calendar/items`, { method: 'POST', headers: A, body: JSON.stringify({ title, due, time, duration, ...extra }) });
  const T = [['Team-Standup', 0, '09:30', 30], ['Zahnarzt', 0, '14:30', 90, { location: 'Praxis Dr. Huber' }], ['Lerngruppe', 0, '18:00', 60, { location: 'Bibliothek' }], ['Abendessen mit Anna', 1, '19:00', 120, { location: 'Trattoria Roma' }],
    ['Sprint-Review', 1, '10:00', 60], ['Yoga', 2, '07:30', 60], ['Design-Workshop', 2, '10:00', 180], ['Mittagessen mit Tom', 2, '12:30', 60], ['Kundentermin', 3, '15:00', 90, { location: 'Wien Mitte' }], ['Friseur', 4, '16:30', 60],
    ['Geburtstag Oma', 5, '12:00', 180], ['Wochenmarkt', 5, '09:00', 60], ['Laufen', 6, '08:30', 45], ['Präsentation Q4', 8, '11:00', 60], ['Telefonat Steuerberater', 9, '14:00', 30], ['Kino', 11, '20:00', 150], ['Arzt Kontrolle', 13, '08:15', 45]];
  for (const [t, d, time, dur, x] of T) await mk(t, ymd(d), time, dur, x || {});
  for (const [t, d] of [['Paket abholen', 0], ['Steuererklärung abgeben', 3], ['Geschenk besorgen', 1]]) await fetch(`${BASE}/api/items`, { method: 'POST', headers: A, body: JSON.stringify({ kind: 'todo', title: t, due: ymd(d) }) });
  await fetch(`${BASE}/api/items`, { method: 'POST', headers: A, body: JSON.stringify({ kind: 'exam', title: 'Prüfung Statistik', due: ymd(7), time: '09:00' }) });
  await fetch(`${BASE}/api/items`, { method: 'POST', headers: A, body: JSON.stringify({ kind: 'assignment', title: 'Projektbericht', due: ymd(4) }) });
  const me = await (await fetch(`${BASE}/api/me`, { headers: A })).json();
  const browser = await chromium.launch({ headless: true, executablePath: process.env.STELLA_CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, ...(W < 700 ? { hasTouch: true, isMobile: true } : {}) });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(BASE);
  await page.evaluate(({ tk, me, LOC }) => {
    localStorage.setItem('evolsiorIntroShown', '1'); localStorage.setItem('stella.locale', LOC); localStorage.removeItem('stella.calendarView');
    localStorage.setItem('stella-state-v1', JSON.stringify({ token: tk, me, items: {}, messages: [], outbox: [], lastSync: null, online: true, thinking: false, busyItems: [], actions: {}, conversationId: null, pinned: false, current: null, conversations: [] }));
  }, { tk: reg.token, me, LOC });
  await page.goto(`${BASE}/#calendar`); await page.reload(); await page.waitForTimeout(2500);
  const shot = async (name) => { await page.waitForTimeout(700); await page.screenshot({ path: `${OUT}/cal-${name}-${LOC}-${W}.png`, fullPage: false }); };
  await shot('month');
  const tabs = { week: LOC === 'de' ? 'Woche' : 'Week', day: LOC === 'de' ? 'Tag' : 'Day' };
  await page.getByRole('tab', { name: tabs.week, exact: true }).click(); await shot('week');
  await page.getByRole('tab', { name: tabs.day, exact: true }).click(); await shot('day');
  console.log('Konsolenfehler:', errors.length ? errors.slice(0, 4) : 'keine');
  await browser.close();
})();
