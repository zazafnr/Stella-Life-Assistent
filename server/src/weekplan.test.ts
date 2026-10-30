import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.STELLA_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'stella-week-'));
process.env.STELLA_SECRET = 'test-secret-1234567890';
process.env.OPENROUTER_API_KEY = '';

const { register } = await import('./auth.ts');
const { db, getItem, getUser, listItems, recentMessages, updateUserSettings } = await import('./db.ts');
const { addItem } = await import('./planner.ts');
const { approve, getAction, perform, undo } = await import('./actions.ts');
const { addMemory, deleteMemory } = await import('./memory.ts');
const { buildWeekPlan, cleanBlocks, replanMissed } = await import('./weekplan.ts');
const { findHints } = await import('./hints.ts');
const { handleChat } = await import('./assistant.ts');
const { toMin } = await import('./context.ts');
const { addDays, todayIn } = await import('@stella/shared');

const { user: created } = register('Lukas', 'lukas@example.com', 'supergeheim', 'Europe/Vienna');
const user = () => getUser(created.id)!;
const today = todayIn('Europe/Vienna');
const from = addDays(today, 1);
const overlaps = (a: { start: string; end: string }, b: { start: string; end: string }) => toMin(a.start) < toMin(b.end) && toMin(b.start) < toMin(a.end);

test('Test in 6 Tagen: 3 Lerneinheiten an verschiedenen Tagen, Wiederholung am Vortag, nichts am Testtag', () => {
  const exam = addItem(user(), { kind: 'exam', title: 'Bio Test', subject: 'Biologie', due: addDays(from, 5), material: 'Zelle, Mitose, Meiose, Genetik' });
  const plan = buildWeekPlan(user(), { from });
  const mine = plan.blocks.filter((b) => b.parentId === exam.id);
  assert.equal(mine.length, 3);
  assert.equal(new Set(mine.map((b) => b.date)).size, 3, 'verschiedene Tage');
  assert.ok(mine.every((b) => b.date < exam.due! && b.date >= from));
  assert.equal(mine.at(-1)!.date, addDays(exam.due!, -1));
  assert.equal(mine.at(-1)!.focus, 'Alles wiederholen');
  assert.deepEqual(mine.slice(0, 2).map((b) => b.focus), ['Zelle, Mitose', 'Meiose, Genetik']);
  assert.ok(mine.every((b) => toMin(b.end) - toMin(b.start) === 45));
});

test('Blöcke liegen in freien Zeiten: nicht in der Schule, mit Pause zueinander, höchstens 2 h pro Schultag', () => {
  for (let i = 0; i < 4; i++) addItem(user(), { kind: 'homework', title: `HÜ ${i}`, subject: 'Deutsch', due: addDays(from, 2) });
  addItem(user(), { kind: 'assignment', title: 'Geschichte Referat', due: addDays(from, 6) });
  const plan = buildWeekPlan(user(), { from });
  const byDay = new Map<string, typeof plan.blocks>();
  for (const b of plan.blocks) byDay.set(b.date, [...(byDay.get(b.date) ?? []), b]);
  for (const [date, bs] of byDay) {
    const weekend = [0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay());
    if (!weekend) assert.ok(bs.every((b) => !overlaps(b, { start: '07:30', end: '13:30' })), `Schulzeit frei am ${date}`);
    for (let i = 1; i < bs.length; i++) assert.ok(toMin(bs[i]!.start) >= toMin(bs[i - 1]!.end) + 10, `Pause am ${date}`);
    const minutes = bs.reduce((s, b) => s + toMin(b.end) - toMin(b.start), 0);
    assert.ok(minutes <= (weekend ? 150 : 120), `Tageslimit am ${date}: ${minutes}`);
    assert.ok(bs.every((b) => toMin(b.end) <= toMin('21:00')));
  }
  const hw = plan.blocks.filter((b) => b.why === 'homework');
  assert.ok(hw.length >= 2 && hw.every((b) => b.date < addDays(from, 2) && b.title.startsWith('Erledigen:')));
  assert.equal(plan.blocks.filter((b) => b.why === 'assignment').length, 2);
});

test('Vorliebe aus dem Gedächtnis: „lernt lieber abends“ verschiebt die Blöcke nach hinten', () => {
  const before = buildWeekPlan(user(), { from }).blocks.find((b) => b.why === 'exam')!;
  const { memory } = addMemory(created.id, { category: 'preference', text: 'Lukas lernt lieber abends', source: 'user' });
  const after = buildWeekPlan(user(), { from }).blocks.find((b) => b.why === 'exam')!;
  assert.ok(toMin(after.start) > toMin(before.start), `${before.start} → ${after.start}`);
  assert.ok(toMin(after.start) >= toMin('18:00'));
  deleteMemory(created.id, memory.id);
});

test('Übernehmen legt Einträge an (Hinweis „kein Lernplan“ verschwindet), Rückgängig entfernt alle', () => {
  const exam = listItems(created.id, { kind: 'exam' })[0]!;
  assert.ok(findHints(user()).some((h) => h.key === `exam_no_plan:${exam.id}`));
  const plan = buildWeekPlan(user(), { from });
  const r = perform(user(), 'week_plan.apply', { blocks: plan.blocks }, { source: 'chat', quiet: true });
  assert.equal(r.status, 'done');
  const study = listItems(created.id, { kind: 'study' });
  assert.equal(study.length, plan.blocks.length);
  assert.ok(study.some((s) => s.parentId === exam.id && s.time));
  assert.ok(!findHints(user()).some((h) => h.key === `exam_no_plan:${exam.id}`));
  assert.equal(buildWeekPlan(user(), { from }).blocks.filter((b) => b.parentId === exam.id).length, 0, 'schon geplant → nichts Neues');

  undo(created.id, r.actionId!);
  assert.equal(listItems(created.id, { kind: 'study' }).length, 0);
});

test('Blöcke vom Client werden geprüft: fremde/unbekannte Einträge und kaputte Zeiten fliegen raus', () => {
  const plan = buildWeekPlan(user(), { from });
  const blocks = cleanBlocks(created.id, [
    plan.blocks[0],
    { ...plan.blocks[0], parentId: 'gibt-es-nicht' },
    { ...plan.blocks[0], start: '25:00' },
    { ...plan.blocks[0], date: 'morgen' },
  ]);
  assert.equal(blocks.length, 1);
});

test('„Plan meine Woche“ im Chat: immer erst als Karte – auch wenn Stella im Planer alles selbst darf', async () => {
  updateUserSettings(created.id, { permissions: { planner: 'auto' } });
  const res = await handleChat(user(), 'plan meine Woche', null);
  const card = res.messages.find((m) => m.actionId)!;
  assert.ok(card, 'Karte');
  assert.match(card.text, /Vorschlag für deine Woche/);
  assert.match(card.text, /Lernen: Bio Test/);
  assert.match(card.text, /Soll ich das so eintragen\?/);
  assert.equal(getAction(created.id, card.actionId!)!.status, 'proposed');
  assert.equal(listItems(created.id, { kind: 'study' }).length, 0);
  approve(created.id, card.actionId!);
  assert.ok(listItems(created.id, { kind: 'study' }).length > 0);
});

test('Verpasster Block wird von selbst neu eingeplant – vor dem Test, mit Nachricht und Rückgängig', () => {
  const exam = listItems(created.id, { kind: 'exam' })[0]!;
  const missed = addItem(user(), { kind: 'study', title: 'Lernen: Bio Test', subject: 'Biologie', due: addDays(today, -1), time: '16:30', parentId: exam.id, source: 'plan' });
  assert.equal(replanMissed(created.id), 1);
  const moved = getItem(created.id, missed.id)!;
  assert.ok(moved.due! >= today && moved.due! < exam.due!, `liegt jetzt vor dem Test: ${moved.due}`);
  const msg = recentMessages(created.id, 1)[0]!;
  assert.match(msg.text, /verschoben/);
  assert.ok(msg.actionId);
  assert.equal(replanMissed(created.id), 0, 'nicht doppelt');
});

test('Planer auf „fragen“: kein automatisches Verschieben, nur der Hinweis', () => {
  updateUserSettings(created.id, { permissions: { planner: 'ask' } });
  const exam = listItems(created.id, { kind: 'exam' })[0]!;
  const missed = addItem(user(), { kind: 'study', title: 'Lernen: Bio Test', subject: 'Biologie', due: addDays(today, -2), time: '16:30', parentId: exam.id, source: 'plan' });
  assert.equal(replanMissed(created.id), 0);
  assert.equal(getItem(created.id, missed.id)!.due, addDays(today, -2));
  assert.ok(findHints(user()).some((h) => h.key === `missed_study:${missed.id}`));
  updateUserSettings(created.id, { permissions: { planner: 'auto' } });
  db.prepare('DELETE FROM items WHERE id = ?').run(missed.id);
});
