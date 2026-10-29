import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.STELLA_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'stella-actions-'));
process.env.STELLA_SECRET = 'test-secret-1234567890';
process.env.OPENROUTER_API_KEY = '';

const { register } = await import('./auth.ts');
const { db, getItem, getUser, recentMessages, updateUserSettings } = await import('./db.ts');
const { approve, levelFor, listActions, perform, reject, undo } = await import('./actions.ts');
const { addMemory, listMemories } = await import('./memory.ts');
const { buildLagebild, freeSlots, lagebildPrompt } = await import('./context.ts');
const { handleChat } = await import('./assistant.ts');
const { addDays, todayIn } = await import('@stella/shared');

const { user: created } = register('Lukas', 'lukas@example.com', 'supergeheim', 'Europe/Vienna');
const user = () => getUser(created.id)!;
const today = todayIn('Europe/Vienna');

test('Standard-Rechte: Planer selbst, Löschen fragt, alte Schalter zählen weiter', () => {
  assert.equal(levelFor(user(), 'planner'), 'auto');
  assert.equal(levelFor(user(), 'delete'), 'ask');
  updateUserSettings(created.id, { homeworkAutopilot: false });
  assert.equal(levelFor(user(), 'homework'), 'never');
  updateUserSettings(created.id, { homeworkAutopilot: true, permissions: { homework: 'ask' } });
  assert.equal(levelFor(user(), 'homework'), 'ask');
});

test('Aktion im Auftrag: wird ausgeführt, protokolliert und lässt sich rückgängig machen', () => {
  const r = perform(user(), 'item.create', { kind: 'event', title: 'Zahnarzt', due: addDays(today, 2), time: '15:00' }, { source: 'chat' });
  assert.equal(r.status, 'done');
  const id = (r as { result: { id: string } }).result.id;
  assert.equal(getItem(created.id, id)!.title, 'Zahnarzt');

  const moved = perform(user(), 'item.update', { id, patch: { due: addDays(today, 3) } }, { source: 'chat' });
  assert.equal(moved.status, 'done');
  assert.match(listActions(created.id)[0]!.summary, /Zahnarzt auf .* verschieben/);

  undo(created.id, (moved as { actionId: string }).actionId);
  assert.equal(getItem(created.id, id)!.due, addDays(today, 2), 'Verschieben ist zurückgenommen');
  assert.throws(() => undo(created.id, (moved as { actionId: string }).actionId), /schon rückgängig/);
});

test('Von sich aus und "fragt vorher": Vorschlag mit Karte, erst nach Ja ausgeführt', () => {
  const item = perform(user(), 'item.create', { kind: 'todo', title: 'Altes To-do', due: today }, { source: 'chat' }) as { result: { id: string } };
  const r = perform(user(), 'item.delete', { id: item.result.id }, { source: 'auto' });
  assert.equal(r.status, 'proposed');
  assert.equal(getItem(created.id, item.result.id)!.deleted, false, 'noch nicht gelöscht');
  const card = recentMessages(created.id, 1)[0]!;
  assert.equal(card.actionId, (r as { actionId: string }).actionId);
  assert.match(card.text, /Darf ich Altes To-do löschen\?/);

  const { entry } = approve(created.id, (r as { actionId: string }).actionId);
  assert.equal(entry.status, 'done');
  assert.ok(entry.canUndo);
  assert.equal(getItem(created.id, item.result.id)!.deleted, true, 'gelöscht');
  assert.throws(() => approve(created.id, entry.id), /Schon entschieden/);

  const r2 = perform(user(), 'item.delete', { id: item.result.id }, { source: 'auto' }) as { actionId: string };
  assert.equal(reject(created.id, r2.actionId).status, 'rejected');
});

test('"nie" wird nie ausgeführt – auch nicht auf Bitte im Chat', () => {
  updateUserSettings(created.id, { permissions: { ...user().settings.permissions, planner: 'never' } });
  const r = perform(user(), 'item.create', { kind: 'todo', title: 'X', due: today }, { source: 'chat' });
  assert.equal(r.status, 'refused');
  updateUserSettings(created.id, { permissions: { ...user().settings.permissions, planner: 'auto' } });
});

test('"rückgängig" im Chat nimmt die letzte Aktion zurück', async () => {
  const r = perform(user(), 'item.create', { kind: 'todo', title: 'Fenster putzen', due: today }, { source: 'chat' }) as { result: { id: string } };
  const res = await handleChat(user(), 'mach das rückgängig', null);
  assert.match(res.messages[0]!.text, /Rückgängig: Fenster putzen/);
  assert.equal(getItem(created.id, r.result.id)!.deleted, true);
});

test('Gedächtnis: keine Doppelten, Routinen mit Zeiten, im Lagebild als belegt', () => {
  addMemory(created.id, { category: 'routine', text: 'Fußballtraining', source: 'learned', schedule: { days: [1, 2, 3, 4, 5, 6, 7], start: '17:00', end: '18:30' } });
  addMemory(created.id, { category: 'routine', text: 'Fußballtraining', source: 'learned', schedule: { days: [1, 2, 3, 4, 5, 6, 7], start: '17:00', end: '18:30' } });
  addMemory(created.id, { category: 'person', text: 'Frau Huber ist Klassenvorstand', source: 'user' });
  assert.equal(listMemories(created.id).length, 2);

  const lb = buildLagebild(user(), 3);
  const tomorrow = lb.days[1]!;
  assert.ok(tomorrow.busy.some((b) => b.label === 'Fußballtraining'));
  assert.ok(!tomorrow.free.some((f) => f.start < '18:30' && f.end > '17:00'), 'Training ist nicht frei');
  const prompt = lagebildPrompt(lb);
  assert.match(prompt, /Frau Huber ist Klassenvorstand/);
  assert.match(prompt, /\(m:[0-9a-f]{8}\)/);
});

test('freie Zeitfenster: Lücken zwischen belegten Zeiten, zu kurze fallen weg', () => {
  assert.deepEqual(freeSlots({ start: '07:00', end: '21:00' }, [
    { start: '07:30', end: '13:20' }, { start: '13:30', end: '14:00' }, { start: '17:00', end: '18:30' },
  ]), [{ start: '07:00', end: '07:30' }, { start: '14:00', end: '17:00' }, { start: '18:30', end: '21:00' }]);
});

test('Gedächtnis-Werkzeug: Lukas sagt "merk dir" → wird ohne Rückfrage gespeichert', () => {
  updateUserSettings(created.id, { permissions: { ...user().settings.permissions, memory: 'ask' } });
  const explicit = perform(user(), 'memory.add', { category: 'preference', text: 'lernt lieber abends', source: 'user' }, { source: 'chat' });
  assert.equal(explicit.status, 'done');
  const learned = perform(user(), 'memory.add', { category: 'school', text: 'Französisch fällt schwer', source: 'learned' }, { source: 'auto' });
  assert.equal(learned.status, 'proposed', 'selbst Gelerntes fragt, wenn der Nutzer das so eingestellt hat');
  db.prepare('DELETE FROM memories').run();
});
