import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.STELLA_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'stella-hints-'));
process.env.STELLA_SECRET = 'test-secret-1234567890';
process.env.OPENROUTER_API_KEY = '';

const { register } = await import('./auth.ts');
const { db, getItem, getPending, getUser, listItems, recentMessages, updateUserSettings } = await import('./db.ts');
const { addItem } = await import('./planner.ts');
const { acceptHint, deliverHint, dismissHint, findHints, isDelivered } = await import('./hints.ts');
const { briefingTime, buildBriefing } = await import('./briefing.ts');
const { buildLagebild } = await import('./context.ts');
const { handleChat } = await import('./assistant.ts');
const { addDays, todayIn } = await import('@stella/shared');

const { user: created } = register('Lukas', 'lukas@example.com', 'supergeheim', 'Europe/Vienna');
const user = () => getUser(created.id)!;
const today = todayIn('Europe/Vienna');
const keys = () => findHints(user()).map((h) => h.key.split(':')[0]);

test('Test ohne Stoff: wichtiger Hinweis, nach Zustellung beantwortet die nächste Nachricht die Rückfrage', async () => {
  const exam = addItem(user(), { kind: 'exam', title: 'Mathe SA', subject: 'Mathe', due: addDays(today, 4) });
  const h = findHints(user()).find((x) => x.key === `exam_no_material:${exam.id}`)!;
  assert.equal(h.priority, 'high');
  assert.match(h.text, /Mathe SA ist in 4 Tagen/);

  await deliverHint(user(), h, false);
  assert.ok(isDelivered(created.id, h.key));
  assert.equal(getPending(created.id)?.type, 'exam_material');
  await handleChat(user(), 'Funktionen, Ableitungen und Kurvendiskussion', null);
  assert.ok(getItem(created.id, exam.id)!.material?.includes('Ableitungen'));
  assert.ok(listItems(created.id, { kind: 'study' }).length > 0, 'Lernplan ist entstanden');
  assert.ok(!keys().includes('exam_no_material'));
});

test('Test mit Stoff, aber ohne Lernplan → Vorschlag; der Knopf auf „Heute“ legt ihn an', () => {
  const exam = addItem(user(), { kind: 'exam', title: 'Englisch Test', subject: 'Englisch', due: addDays(today, 8), material: 'Unit 3, Unit 4' });
  const h = findHints(user()).find((x) => x.key === `exam_no_plan:${exam.id}`)!;
  assert.equal(h.actionLabel, 'Lernplan machen');
  const r = acceptHint(user(), h.key);
  assert.equal(r.status, 'done');
  assert.ok(listItems(created.id, { kind: 'study' }).some((s) => s.parentId === exam.id));
  assert.ok(!findHints(user()).some((x) => x.key === h.key));
});

test('verpasste Lerneinheit → Vorschlag für einen freien Platz vor dem Test', () => {
  const exam = addItem(user(), { kind: 'exam', title: 'Bio Test', subject: 'Biologie', due: addDays(today, 5), material: 'Zelle' });
  const missed = addItem(user(), { kind: 'study', title: 'Lernen: Bio Test', due: addDays(today, -1), time: '16:30', parentId: exam.id, detail: 'Zelle' });
  const h = findHints(user()).find((x) => x.key === `missed_study:${missed.id}`)!;
  assert.ok(h, 'Hinweis da');
  acceptHint(user(), h.key);
  const moved = getItem(created.id, missed.id)!;
  assert.ok(moved.due! >= today && moved.due! < exam.due!, 'liegt jetzt vor dem Test');
});

test('überfällige HÜ: Abhaken-Vorschlag; „Passt schon“ blendet ihn dauerhaft aus', () => {
  const hw = addItem(user(), { kind: 'homework', title: 'Deutsch HÜ', subject: 'Deutsch', due: addDays(today, -2) });
  const key = `overdue:${hw.id}`;
  assert.ok(findHints(user()).some((h) => h.key === key));
  dismissHint(created.id, key);
  assert.ok(!findHints(user()).some((h) => h.key === key));
});

test('„was hab ich vergessen?“ im Chat: alle Hinweise, mit Karten für Vorschläge', async () => {
  updateUserSettings(created.id, { permissions: { planner: 'ask' } });
  addItem(user(), { kind: 'exam', title: 'Chemie Test', subject: 'Chemie', due: addDays(today, 6), material: 'Atombau' });
  const res = await handleChat(user(), 'hab ich was vergessen?', null);
  assert.match(res.messages[0]!.text, /aufgefallen/);
  const card = res.messages.find((m) => m.actionId && /Chemie Test/.test(m.text));
  assert.ok(card, 'Vorschlag als Karte mit Ja/Nein');
  updateUserSettings(created.id, { permissions: { planner: 'auto' } });
});

