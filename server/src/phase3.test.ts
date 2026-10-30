import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.STELLA_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'stella-p3-'));
process.env.STELLA_SECRET = 'test-secret-1234567890';
process.env.OPENROUTER_API_KEY = '';

const { register } = await import('./auth.ts');
const { db, getItem, getUser, listItems } = await import('./db.ts');
const { handleChat } = await import('./assistant.ts');
const { listMemories } = await import('./memory.ts');
const { addDays, nextWeekday, todayIn } = await import('@stella/shared');

const { user: created } = register('Lukas', 'lukas@example.com', 'supergeheim', 'Europe/Vienna');
const user = () => getUser(created.id)!;
const today = todayIn('Europe/Vienna');
const say = (text: string) => handleChat(user(), text, null);

test('Alltagstermin + "nein, Donnerstag" korrigiert ihn + Rückgängig-Karte', async () => {
  const res = await say('Freitag 15 Uhr Friseur');
  const item = res.items[0]!;
  assert.equal(item.kind, 'event');
  assert.equal(item.time, '15:00');
  assert.ok(res.messages[0]!.actionId, 'Bestätigung trägt eine Aktion (Rückgängig)');

  const fix = await say('nein, Donnerstag');
  assert.equal(getItem(created.id, item.id)!.due, nextWeekday(today, 4));
  assert.match(fix.messages[0]!.text, /Friseur/);
  assert.equal(listItems(created.id, {}).filter((i) => i.title === 'Friseur').length, 1, 'kein zweiter Eintrag');
});

test('verschieben trifft den vorhandenen Eintrag statt einen neuen anzulegen', async () => {
  const hw = (await say('Mathe HÜ S. 12 Nr. 4 Freitag')).items[0]!;
  await say('verschieb die Mathe HÜ auf Montag');
  assert.equal(getItem(created.id, hw.id)!.due, nextWeekday(today, 1));
  assert.equal(listItems(created.id, { kind: 'homework' }).filter((i) => i.subject === 'Mathe').length, 1);
});

test('absagen/löschen mit Rückgängig', async () => {
  const res = await say('Friseur absagen');
  assert.match(res.messages[0]!.text, /Friseur.*gelöscht/);
  assert.equal(listItems(created.id, {}).filter((i) => i.title === 'Friseur').length, 0);
  await say('mach das rückgängig');
  assert.equal(listItems(created.id, {}).filter((i) => i.title === 'Friseur').length, 1);
  const nothing = await say('Klavierstunde absagen');
  assert.match(nothing.messages[0]!.text, /finde nichts|Gibt's bei mir nicht|Nix gefunden/);
});

test('Erinnerung "in 2 Stunden" feuert genau dann', async () => {
  const res = await say('erinnere mich in 2 Stunden an die Wäsche');
  const item = res.items[0]!;
  assert.equal(item.kind, 'reminder');
  const r = db.prepare('SELECT fire_at, message FROM reminders WHERE item_id = ?').get(item.id) as { fire_at: string; message: string };
  const diffMin = (Date.parse(r.fire_at) - Date.now()) / 60_000;
  assert.ok(diffMin > 115 && diffMin < 121, `in ~2 h, war ${diffMin}`);
  assert.match(r.message, /Wäsche/);
});

test('"merk dir" speichert sofort, "vergiss" löscht', async () => {
  await say('merk dir, dass ich Erdnussallergie habe');
  const m = listMemories(created.id).find((x) => x.text === 'Ich habe Erdnussallergie')!;
  assert.equal(m.category, 'health');
  assert.equal(m.source, 'user');
  await say('vergiss das mit der Erdnussallergie');
  assert.ok(!listMemories(created.id).some((x) => x.text.includes('Erdnuss')));
});

test('„Latein HÜ auf Freitag“ ohne vorhandene HÜ legt eine neue an', async () => {
  const res = await say('Latein HÜ auf Freitag');
  assert.equal(res.items[0]?.subject, 'Latein');
  assert.equal(res.items[0]?.due, nextWeekday(today, 5));
  assert.ok(addDays(today, 0));
});
