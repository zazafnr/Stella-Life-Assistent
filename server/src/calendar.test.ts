import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.STELLA_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'stella-cal-'));
process.env.STELLA_SECRET = 'test-secret-1234567890';
process.env.OPENROUTER_API_KEY = '';
process.env.STELLA_ALLOW_REGISTRATION = 'true';

const { register, requireUser, HttpError } = await import('./auth.ts');
const { db, getItem, updateUserSettings } = await import('./db.ts');
const { addItem } = await import('./planner.ts');
const { addMemory } = await import('./memory.ts');
const { registerCalendarRoutes, buildCalendar } = await import('./calendar.ts');
const { registerEdition, resetEditions } = await import('./editions/registry.ts');
const { createGoal } = await import('./goals.ts');
const { addDays, todayIn, weekdayOf } = await import('@stella/shared');
const Fastify = (await import('fastify')).default;

const reg = register('Mia', 'mia@example.com', 'supergeheim', 'Europe/Vienna');
const user = () => (db.prepare('SELECT id FROM users').get() as { id: string }) && reg.user;
const token = reg.token;
const today = todayIn('Europe/Vienna');
const tomorrow = addDays(today, 1);
const later = addDays(today, 3);

const app = Fastify();
app.setErrorHandler((err, _req, reply) => (err instanceof HttpError ? reply.code(err.status).send({ ...err.extra, error: err.message }) : reply.code(500).send({ error: (err as Error).message })));
await app.register(async (api) => { api.addHook('preHandler', requireUser); registerCalendarRoutes(api); });
await app.ready();
const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) => app.inject({ method, url, payload: payload as object, headers: { authorization: `Bearer ${token}` } });

test('Blöcke je Tag: Termine mit Dauer, To-dos ohne Uhrzeit, Routinen als Hintergrund – sortiert, mit Auslastung', async () => {
  const dentist = addItem(user(), { kind: 'event', title: 'Zahnarzt', due: tomorrow, time: '14:30', duration: 90, location: 'Praxis Dr. Huber' });
  addItem(user(), { kind: 'todo', title: 'Paket abholen', due: tomorrow });
  addItem(user(), { kind: 'exam', title: 'Prüfung Statistik', due: later, time: '09:00' });
  addMemory(user().id, { category: 'routine', text: 'Arbeit', source: 'user', schedule: { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' } });

  const res = await call('GET', `/api/calendar?from=${today}&to=${later}`);
  assert.equal(res.statusCode, 200, res.body);
  const cal = res.json();
  assert.equal(cal.today, today);
  assert.deepEqual(cal.days.map((d: { date: string }) => d.date), [today, tomorrow, addDays(today, 2), later]);
  const d1 = cal.days[1];
  const timed = d1.blocks.find((b: { id: string }) => b.id === dentist.id);
  assert.deepEqual([timed.start, timed.end, timed.location, timed.kind], ['14:30', '16:00', 'Praxis Dr. Huber', 'event']);
  const untimed = d1.blocks.find((b: { title: string }) => b.title === 'Paket abholen');
  assert.deepEqual([untimed.start, untimed.end], [null, null]);
  assert.equal(d1.blocks.at(-1).title, 'Paket abholen', 'ohne Uhrzeit ganz am Ende');
  const wd = (weekdayOf(tomorrow) + 6) % 7 + 1;
  assert.equal(d1.blocks.some((b: { kind: string; soft?: boolean }) => b.kind === 'routine' && b.soft), wd <= 5, 'Arbeit als sanfter Streifen an Werktagen');
  assert.ok(d1.load > 0 && d1.load <= 1);
  assert.ok(cal.days[3].blocks.some((b: { kind: string }) => b.kind === 'exam'));
});

test('freie Zeitfenster stehen nur für heute und später da und sparen belegte Zeiten aus', async () => {
  const cal = (await call('GET', `/api/calendar?from=${addDays(today, -2)}&to=${tomorrow}`)).json();
  assert.deepEqual(cal.days.slice(0, 2).map((d: { free: unknown[] }) => d.free.length), [0, 0], 'Vergangenheit: keine freien Fenster');
  const d = cal.days.at(-1);
  assert.ok(d.free.length > 0);
  assert.ok(d.free.every((f: { start: string; end: string }) => !(f.start < '16:00' && f.end > '14:30')), 'der Zahnarzttermin 14:30–16:00 ist belegt');
  assert.ok(d.freeMinutes > 0);
});

test('Ziel-Check-ins erscheinen am richtigen Wochentag', async () => {
  const sunday = addDays(today, (7 - weekdayOf(today)) % 7 || 7);
  createGoal(user().id, { title: 'Laufen gehen', target: 3, cadence: 'weekly:3', checkIn: 'So 18:00', minutes: 20 });
  const cal = buildCalendar(user(), today, addDays(today, 7));
  const hits = cal.days.filter((d) => d.blocks.some((b) => b.kind === 'goal'));
  assert.deepEqual(hits.map((d) => d.date), [sunday]);
  const goal = hits[0]!.blocks.find((b) => b.kind === 'goal')!;
  assert.deepEqual([goal.start, goal.end], ['18:00', '18:20']);
});

test('Unterricht und Fristen des Plugins erscheinen als Hintergrund bzw. Block', async () => {
  resetEditions();
  registerEdition({ id: 'demo', edition: 'students', context: { lessons: (_id, from) => [{ date: from, start: '08:00', end: '08:50', subject: 'Mathe', code: 'M', status: 'normal', info: null }, { date: from, start: '09:00', end: '09:50', subject: 'Latein', code: 'L', status: 'cancelled', info: 'Entfall' }] } });
  const day = buildCalendar(user(), tomorrow, tomorrow).days[0]!;
  const lessons = day.blocks.filter((b) => b.kind === 'lesson');
  assert.deepEqual(lessons.map((b) => [b.title, b.status, b.soft]), [['Mathe', 'open', true], ['Latein', 'cancelled', true]]);
  resetEditions();
});

test('Anlegen und Verschieben laufen über Aktionen mit Rückgängig', async () => {
  const created = await call('POST', '/api/calendar/items', { title: 'Lerngruppe', due: tomorrow, time: '18:00', duration: 45, location: 'Bibliothek' });
  assert.equal(created.statusCode, 200, created.body);
  const { item, actionId } = created.json();
  assert.equal(item.duration, 45);
  assert.equal(item.location, 'Bibliothek');
  assert.ok(actionId);
  assert.equal((db.prepare('SELECT type FROM actions WHERE id = ?').get(actionId) as { type: string }).type, 'item.create');

  const moved = await call('PATCH', `/api/calendar/items/${item.id}`, { due: later, time: '10:15', duration: 120 });
  assert.equal(moved.statusCode, 200, moved.body);
  const after = getItem(reg.user.id, item.id)!;
  assert.deepEqual([after.due, after.time, after.duration], [later, '10:15', 120]);
  // Rückgängig über das Protokoll (wie in der App)
  const { undo } = await import('./actions.ts');
  undo(reg.user.id, moved.json().actionId);
  const back = getItem(reg.user.id, item.id)!;
  assert.deepEqual([back.due, back.time, back.duration], [tomorrow, '18:00', 45]);
});

test('ungültige Eingaben: klare Fehler statt Absturz', async () => {
  assert.equal((await call('GET', '/api/calendar?from=morgen&to=heute')).statusCode, 400);
  assert.equal((await call('GET', `/api/calendar?from=${later}&to=${today}`)).statusCode, 400);
  assert.equal((await call('GET', `/api/calendar?from=${today}&to=${addDays(today, 90)}`)).statusCode, 400, 'höchstens 62 Tage');
  assert.equal((await call('POST', '/api/calendar/items', { title: '', due: today })).statusCode, 400);
  assert.equal((await call('POST', '/api/calendar/items', { title: 'X', due: 'gestern' })).statusCode, 400);
  assert.equal((await call('POST', '/api/calendar/items', { title: 'X', due: today, time: '25:00' })).statusCode, 400);
  assert.equal((await call('PATCH', '/api/calendar/items/gibt-es-nicht', { due: today })).statusCode, 404);
  const it = addItem(user(), { kind: 'todo', title: 'Test', due: today });
  assert.equal((await call('PATCH', `/api/calendar/items/${it.id}`, { duration: 2 })).statusCode, 400);
  assert.equal((await call('PATCH', `/api/calendar/items/${it.id}`, {})).statusCode, 400);
  // fremde Einträge sind für andere Nutzer unsichtbar
  const other = register('Sam', 'sam@example.com', 'supergeheim', 'Europe/Vienna').token;
  const foreign = await app.inject({ method: 'PATCH', url: `/api/calendar/items/${it.id}`, payload: { due: later }, headers: { authorization: `Bearer ${other}` } });
  assert.equal(foreign.statusCode, 404);
  updateUserSettings(reg.user.id, {});
});
