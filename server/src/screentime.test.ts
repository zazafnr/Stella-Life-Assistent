import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import Fastify from 'fastify';

// Telegram-Mock: merkt sich gesendete Nachrichten
const sent: string[] = [];
const BOT_TOKEN = '123456789:AAEtestTokenAbcdefghijklmnopqrstuvwxyz1234';
const tg = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    if (req.url?.endsWith('/sendMessage')) sent.push(String(body.text));
    res.end(JSON.stringify({ ok: true, result: { message_id: 1 } }));
  });
});
await new Promise<void>((r) => tg.listen(0, r));
after(() => tg.close());

process.env.STELLA_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'stella-screentime-'));
process.env.STELLA_SECRET = 'test-secret-1234567890';
process.env.STELLA_ALLOW_REGISTRATION = 'true';
process.env.TELEGRAM_BASE_URL = `http://127.0.0.1:${(tg.address() as AddressInfo).port}`;
process.env.TELEGRAM_MIN_GAP_MS = '0';

const { register, HttpError, requireUser } = await import('./auth.ts');
const { db, getUser, updateUserSettings } = await import('./db.ts');
const { giftPlan } = await import('./billing.ts');
const { setKey } = await import('./keys.ts');
const tgmod = await import('./channels/telegram.ts');
const st = await import('./screentime.ts');
const { buildBriefing } = await import('./briefing.ts');
const { findHints } = await import('./hints.ts');
const { addDays, todayIn } = await import('@stella/shared');

setKey('telegram', BOT_TOKEN);
const app = Fastify();
app.setErrorHandler((err: Error, _req, reply) => reply.code(err instanceof HttpError ? err.status : 500).send({ error: err.message }));
await app.register(async (api) => { api.addHook('preHandler', requireUser); st.registerScreenTimeRoutes(api); });
await app.ready();
after(() => app.close());

register('Owner', 'owner@example.com', 'supergeheim', 'Europe/Vienna');
let n = 0;
const mk = (plan: 'free' | 'plus', settings: Record<string, unknown> = {}) => {
  const r = register(`Nutzer${++n}`, `s${n}@example.com`, 'supergeheim', 'Europe/Vienna');
  giftPlan(r.user.id, plan, null);
  updateUserSettings(r.user.id, { locale: 'de', tone: 'nett', ...settings });
  return { id: r.user.id, token: r.token, get: () => getUser(r.user.id)! };
};
const auth = (t: string) => ({ authorization: `Bearer ${t}` });
const call = (u: { token: string }, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
  app.inject({ method, url, headers: auth(u.token), ...(payload ? { payload: payload as object } : {}) });
const tz = 'Europe/Vienna';
const iso = (daysAgo: number, hour = 12) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - daysAgo); d.setUTCHours(hour, 0, 0, 0); return d.toISOString(); };

test('Ziele: anlegen, ändern, löschen; Grenzen; nur ab Plus', async () => {
  const u = mk('plus');
  const r = await call(u, 'POST', '/api/screentime/goals', { name: ' TikTok ', limitMinutes: 60, shield: true });
  assert.equal(r.statusCode, 200, r.body);
  const goal = r.json() as { id: string; name: string; limitMinutes: number; shield: boolean };
  assert.deepEqual([goal.name, goal.limitMinutes, goal.shield], ['TikTok', 60, true]);
  assert.equal((await call(u, 'POST', '/api/screentime/goals', { name: '', limitMinutes: 60 })).statusCode, 400);
  assert.equal((await call(u, 'POST', '/api/screentime/goals', { name: 'X', limitMinutes: 2 })).statusCode, 400);
  assert.equal((await call(u, 'POST', '/api/screentime/goals', { name: 'X', limitMinutes: 2000 })).statusCode, 400);
  const put = await call(u, 'PUT', `/api/screentime/goals/${goal.id}`, { limitMinutes: 90, name: 'TikTok & Co' });
  assert.deepEqual([(put.json() as { limitMinutes: number }).limitMinutes, (put.json() as { name: string }).name], [90, 'TikTok & Co']);
  assert.equal(((await call(u, 'GET', '/api/screentime/goals')).json() as { goals: unknown[] }).goals.length, 1);
  assert.equal((await call(u, 'DELETE', `/api/screentime/goals/${goal.id}`)).statusCode, 200);
  assert.equal(((await call(u, 'GET', '/api/screentime/goals')).json() as { goals: unknown[] }).goals.length, 0);

  const free = mk('free');
  const denied = await call(free, 'POST', '/api/screentime/goals', { name: 'TikTok', limitMinutes: 60 });
  assert.equal(denied.statusCode, 402);
  assert.equal((denied.json() as { error: string }).error, 'Bildschirmzeit-Ziele gibt es ab dem Plus-Abo.');
  const view = (await call(free, 'GET', '/api/screentime/goals')).json() as { allowed: boolean };
  assert.equal(view.allowed, false);
  assert.equal((await call(free, 'POST', '/api/screentime/events', { events: [] })).statusCode, 402);
});

test('Ereignisse: nur Ziel-Id, Schwelle und Zeit; Doppelte, fremde Ziele, Zukunft und Altes werden übergangen', async () => {
  const u = mk('plus');
  const other = mk('plus');
  const g = (await call(u, 'POST', '/api/screentime/goals', { name: 'TikTok', limitMinutes: 60 })).json() as { id: string };
  const og = (await call(other, 'POST', '/api/screentime/goals', { name: 'Insta', limitMinutes: 60 })).json() as { id: string };
  const future = new Date(Date.now() + 3600_000).toISOString();
  const r = await call(u, 'POST', '/api/screentime/events', { events: [
    { goalId: g.id, minutes: 30, at: iso(1) }, { goalId: g.id, minutes: 30, at: iso(1, 13) }, // Duplikat (gleicher Tag und Schwelle)
    { goalId: g.id, minutes: 48, at: iso(1) }, { goalId: og.id, minutes: 30, at: iso(1) }, // fremdes Ziel
    { goalId: g.id, minutes: 30, at: future }, { goalId: g.id, minutes: 30, at: iso(30) }, // Zukunft, zu alt
    { goalId: g.id, minutes: -5, at: iso(1) }, { goalId: 'gibt-es-nicht', minutes: 30, at: iso(1) },
  ] });
  assert.equal((r.json() as { stored: number }).stored, 2);
  const cols = Object.keys(db.prepare('SELECT * FROM screentime_events').get() as object).sort();
  assert.deepEqual(cols, ['at', 'day', 'goal_id', 'id', 'minutes', 'percent', 'user_id'], 'keine App-Daten im Server');
  assert.equal((await call(u, 'POST', '/api/screentime/events', {})).statusCode, 400);
});

test('Überblick und Wochenrückblick im Sonntags-Briefing: „3 von 7 Tagen im Limit“, ohne Punkte, Serien oder Abzeichen', async () => {
  const u = mk('plus');
  const g = (await call(u, 'POST', '/api/screentime/goals', { name: 'TikTok', limitMinutes: 60 })).json() as { id: string };
  // Konto/Ziel „vor 10 Tagen“ angelegt, damit alle sieben Tage zählen
  db.prepare('UPDATE screentime_goals SET created_at = ? WHERE id = ?').run(iso(10), g.id);
  const today = todayIn(tz);
  const sunday = (() => { let d = today; for (let i = 0; i < 7; i++) { if (new Date(`${d}T12:00:00Z`).getUTCDay() === 0) return d; d = addDays(d, 1); } return today; })();
  // Ereignisse für vier der sieben Tage vor dem Sonntag: Limit erreicht an 4 Tagen → 3 von 7 im Limit
  db.prepare('INSERT INTO screentime_events (id, user_id, goal_id, day, minutes, percent, at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const back of [1, 2, 4, 5]) {
    const day = addDays(sunday, -back);
    db.prepare('INSERT INTO screentime_events (id, user_id, goal_id, day, minutes, percent, at) VALUES (?, ?, ?, ?, 60, 100, ?)').run(`e${back}-${g.id}`, u.id, g.id, day, `${day}T12:00:00.000Z`);
  }
  const ov = st.screenOverview(u.get(), 7, sunday);
  assert.equal(ov[0]!.days.length, 7);
  assert.equal(ov[0]!.days.filter((d) => d.reachedLimit).length, 4);
  assert.deepEqual(st.screentimeWeekLines(u.get(), sunday), ['TikTok: 3 von 7 Tagen im Limit']);
  assert.deepEqual(st.screentimeWeekLines(u.get(), addDays(sunday, -1)), [], 'nur sonntags');
  const text = st.screentimeWeekLines(u.get(), sunday).join(' ');
  assert.ok(!/Punkte|Serie|Abzeichen|Streak|Badge/i.test(text));
  // Briefing am Sonntag: Abschnitt „Ziele“ enthält die Zeile (das Briefing baut auf heute – nur prüfen, wenn heute Sonntag ist)
  if (sunday === today) assert.ok(buildBriefing(u.get()).sections.find((s) => s.id === 'goals')!.lines.includes('TikTok: 3 von 7 Tagen im Limit'));
  const api = (await call(u, 'GET', '/api/screentime/overview?days=7')).json() as { overview: { days: unknown[] }[] };
  assert.ok(api.overview[0]!.days.length >= 1);
  assert.deepEqual(st.screentimeWeekLines(mk('free').get(), sunday), [], 'Free: nichts');
});

test('Hinweis (im Ton der Person): Limit an mindestens 3 der letzten 4 Tage – einmal pro Woche und Ziel', async () => {
  const u = mk('plus', { tone: 'frech' });
  const g = (await call(u, 'POST', '/api/screentime/goals', { name: 'TikTok', limitMinutes: 60 })).json() as { id: string };
  db.prepare('UPDATE screentime_goals SET created_at = ? WHERE id = ?').run(iso(10), g.id);
  const today = todayIn(tz);
  for (const back of [0, 1, 2]) {
    const day = addDays(today, -back);
    db.prepare('INSERT INTO screentime_events (id, user_id, goal_id, day, minutes, percent, at) VALUES (?, ?, ?, ?, 60, 100, ?)').run(`h${back}-${g.id}`, u.id, g.id, day, `${day}T10:00:00.000Z`);
  }
  const hints = st.screentimeHints(u.get(), today);
  assert.equal(hints.length, 1);
  assert.match(hints[0]!.key, new RegExp(`^screentime_over:${g.id}:\\d{4}-\\d{2}-\\d{2}$`));
  const found = findHints(u.get()).find((h) => h.key.startsWith('screentime_over:'))!;
  assert.equal(found.text, 'TikTok-Limit an 3 der letzten 4 Tage gerissen. Entweder ist das Limit ein Witz oder du.');
  const calm = mk('plus');
  const g2 = (await call(calm, 'POST', '/api/screentime/goals', { name: 'Insta', limitMinutes: 60 })).json() as { id: string };
  db.prepare('UPDATE screentime_goals SET created_at = ? WHERE id = ?').run(iso(10), g2.id);
  assert.deepEqual(st.screentimeHints(calm.get(), today), [], 'ohne Ereignisse kein Hinweis');
});

test('Telegram: „TikTok-Limit erreicht.“ nur wenn verbunden und gewählt, nur beim ersten Mal heute, nicht bei alten Ereignissen', async () => {
  const u = mk('plus', { notifyVia: ['push', 'telegram'] });
  const g = (await call(u, 'POST', '/api/screentime/goals', { name: 'TikTok', limitMinutes: 60 })).json() as { id: string };
  const { token } = tgmod.createLinkToken(u.id);
  db.prepare("INSERT INTO channel_links (user_id, channel, external_id, created_at) VALUES (?, 'telegram', '4711', datetime('now'))").run(u.id);
  void token;
  sent.length = 0;
  const fresh = new Date(Date.now() - 10 * 60_000).toISOString();
  await call(u, 'POST', '/api/screentime/events', { events: [{ goalId: g.id, minutes: 60, at: fresh }] });
  assert.deepEqual(sent, ['TikTok-Limit erreicht.']);
  await call(u, 'POST', '/api/screentime/events', { events: [{ goalId: g.id, minutes: 60, at: fresh }] });
  assert.equal(sent.length, 1, 'gleiches Ereignis noch einmal: keine zweite Nachricht');
  sent.length = 0;
  await call(u, 'POST', '/api/screentime/events', { events: [{ goalId: g.id, minutes: 120, at: fresh }, { goalId: g.id, minutes: 48, at: fresh }] });
  assert.equal(sent.length, 0, 'nur das Limit selbst löst die Nachricht aus');
  const old = mk('plus', { notifyVia: ['push', 'telegram'] });
  const g2 = (await call(old, 'POST', '/api/screentime/goals', { name: 'Insta', limitMinutes: 60 })).json() as { id: string };
  db.prepare("INSERT INTO channel_links (user_id, channel, external_id, created_at) VALUES (?, 'telegram', '4712', datetime('now'))").run(old.id);
  await call(old, 'POST', '/api/screentime/events', { events: [{ goalId: g2.id, minutes: 60, at: iso(2) }] });
  assert.equal(sent.length, 0, 'ältere Ereignisse nach einer Synchronisierung lösen nichts aus');
  const pushOnly = mk('plus');
  const g3 = (await call(pushOnly, 'POST', '/api/screentime/goals', { name: 'YouTube', limitMinutes: 60 })).json() as { id: string };
  await call(pushOnly, 'POST', '/api/screentime/events', { events: [{ goalId: g3.id, minutes: 60, at: fresh }] });
  assert.equal(sent.length, 0, 'Telegram nicht gewählt');
});
