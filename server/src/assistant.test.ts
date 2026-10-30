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

test('HÜ per Kurznotiz → Eintrag, Erinnerung am Vorabend, Buchseiten-Job', async () => {
  updateUserSettings(user.id, { books: [{ subject: 'Latein', provider: 'digi4school', url: 'https://digi4school.at/ebook/abc' }] });
  const u = getUser(user.id)!;
  const res = await handleChat(u, 'Latein Hü Seite 45 nr 3 in 5 tagen', 'c1');
  assert.equal(res.items.length, 1);
  const item = res.items[0];
  assert.equal(item.title, 'Latein HÜ');
  assert.equal(item.due, addDays(today, 5));
  assert.match(res.messages[0].text, /Notiert.*Latein HÜ.*S\. 45 Nr\. 3/);
  assert.match(res.messages[0].text, /digi4school, lös die Aufgabe und schreib sie dir ins Heft/);

  const reminders = db.prepare('SELECT * FROM reminders WHERE item_id = ?').all(item.id) as { fire_at: string; with_attachments: number }[];
  assert.equal(reminders.length, 1);
  assert.equal(reminders[0].with_attachments, 1);
  const jobs = db.prepare(`SELECT * FROM jobs WHERE type = 'book_page'`).all();
  assert.equal(jobs.length, 1);
});

test('gleiche clientId (offline erneut gesendet) wird nur einmal verarbeitet', async () => {
  const res = await handleChat(getUser(user.id)!, 'Latein Hü Seite 45 nr 3 in 5 tagen', 'c1');
  assert.equal(res.items.length, 0);
  assert.equal(listItems(user.id).filter((i) => i.subject === 'Latein').length, 1);
});

test('Test → Rückfrage nach Stoff → Lernplan', async () => {
  const u = getUser(user.id)!;
  const res = await handleChat(u, 'Mathe SA in 10 tagen', 'c2');
  assert.match(res.messages.at(-1)!.text, /Welcher Stoff/);
  const plan = await handleChat(u, 'Quadratische Gleichungen, Funktionen und Textaufgaben', 'c3');
  const sessions = plan.items.filter((i) => i.kind === 'study');
  assert.ok(sessions.length >= 3, `zu wenige Einheiten: ${sessions.length}`);
  assert.match(plan.messages.at(-1)!.text, /Lernplan/);
  assert.ok(sessions.every((s) => s.due! < addDays(today, 10)));
});

test('erledigt markieren', async () => {
  const res = await handleChat(getUser(user.id)!, 'Latein HÜ erledigt', 'c4');
  assert.equal(res.items[0].status, 'done');
});

test('Agenda', async () => {
  const res = await handleChat(getUser(user.id)!, 'was steht an?', 'c5');
  assert.match(res.messages[0].text, /📝 Mathe Schularbeit/);
});

test('ohne KI: freundlicher Hinweis statt Absturz', async () => {
  const res = await handleChat(getUser(user.id)!, 'Kannst du mir Photosynthese erklären?', 'c6');
  assert.match(res.messages[0].text, /kein KI-Modell/);
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
  assert.match(ics, /SUMMARY:📝 Mathe Schularbeit/);
  assert.match(ics, /DTSTART;VALUE=DATE:\d{8}/);
  assert.ok(ics.split('\r\n').every((l) => [...l].length <= 75));
});
