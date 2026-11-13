import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.STELLA_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'stella-test-'));
process.env.OPENROUTER_API_KEY = '';
process.env.STELLA_SECRET = 'test-secret-1234567890';

const { register, setSecret, getSecret } = await import('./auth.ts');
const { db, getUser, listItems, updateUserSettings } = await import('./db.ts');
const { handleChat } = await import('./assistant.ts');
const { addDays, todayIn } = await import('@stella/shared');

const { user } = register('Lukas', 'lukas@example.com', 'supergeheim', 'Europe/Vienna');
const today = todayIn('Europe/Vienna');

test('gleiche clientId (offline erneut gesendet) wird nur einmal verarbeitet', async () => {
  const first = await handleChat(getUser(user.id)!, 'Zahnarzt in 5 tagen um 14 uhr', 'c1');
  assert.equal(first.items.length, 1);
  const res = await handleChat(getUser(user.id)!, 'Zahnarzt in 5 tagen um 14 uhr', 'c1');
  assert.equal(res.items.length, 0);
  assert.equal(listItems(user.id).filter((i) => /Zahnarzt/i.test(i.title)).length, 1);
});

test('Test → Rückfrage nach Stoff → Lernplan', async () => {
  const u = getUser(user.id)!;
  const res = await handleChat(u, 'Klausur in 10 tagen', 'c2');
  assert.match(res.messages.at(-1)!.text, /Welcher Stoff/);
  const plan = await handleChat(u, 'Quadratische Gleichungen, Funktionen und Textaufgaben', 'c3');
  const sessions = plan.items.filter((i) => i.kind === 'study');
  assert.ok(sessions.length >= 3, `zu wenige Einheiten: ${sessions.length}`);
  assert.match(plan.messages.at(-1)!.text, /Lernplan/);
  assert.ok(sessions.every((s) => s.due! < addDays(today, 10)));
});

test('erledigt markieren', async () => {
  await handleChat(getUser(user.id)!, 'Bericht Abgabe Freitag', 'c4a');
  const res = await handleChat(getUser(user.id)!, 'Abgabe erledigt', 'c4');
  assert.equal(res.items[0].status, 'done');
});

test('Agenda', async () => {
  const res = await handleChat(getUser(user.id)!, 'was steht an?', 'c5');
  assert.match(res.messages[0].text, /📝 Klausur/);
});

test('ohne KI: freundlicher Hinweis statt Absturz', async () => {
  const res = await handleChat(getUser(user.id)!, 'Kannst du mir Photosynthese erklären?', 'c6');
  assert.match(res.messages[0].text, /KI-Kopf ist gerade offline/);
});

test('Zugangsdaten werden verschlüsselt gespeichert', () => {
  setSecret(user.id, 'digi4school', { email: 'a@b.at', password: 'pw123' });
  const raw = (db.prepare('SELECT value FROM secrets').get() as { value: string }).value;
  assert.ok(!raw.includes('pw123'));
  assert.deepEqual(getSecret(user.id, 'digi4school'), { email: 'a@b.at', password: 'pw123' });
});

test('Kalender-Abo enthält Einträge', async () => {
  const { toICalendar } = await import('./ical.ts');
  const ics = toICalendar(listItems(user.id, { includeDone: true }), 'Europe/Vienna');
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /SUMMARY:📝 Klausur/);
  assert.match(ics, /DTSTART;VALUE=DATE:\d{8}/);
  assert.ok(ics.split('\r\n').every((l) => [...l].length <= 75));
});
