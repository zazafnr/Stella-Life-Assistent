import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpret, parseEntry } from './parser.ts';
import { buildStudyPlan, planReminders } from './planning.ts';
import { nextWeekday, zonedToUtc } from './dates.ts';

const WED = '2026-10-28'; // Mittwoch

test('das Beispiel aus der Idee: Latein Hü Seite 45 nr 3 Freitag', () => {
  const e = parseEntry('Latein Hü Seite 45 nr 3 Freitag', WED)!;
  assert.equal(e.kind, 'homework');
  assert.equal(e.subject, 'Latein');
  assert.equal(e.page, '45');
  assert.equal(e.exercises, '3');
  assert.equal(e.due, '2026-10-30');
  assert.equal(e.title, 'Latein HÜ');
  assert.equal(e.detail, 'S. 45 Nr. 3');
});

test('Kurzformen', () => {
  const e = parseEntry('M hü s.112 bsp 3a, 4b - 6 bis do', WED)!;
  assert.equal(e.kind, 'homework');
  assert.equal(e.page, '112');
  assert.equal(e.exercises, '3a, 4b–6');
  assert.equal(e.due, '2026-10-29');

  const ah = parseEntry('englisch AH S45 nr 2+3 morgen', WED)!;
  assert.equal(ah.subject, 'Englisch');
  assert.equal(ah.book, 'Arbeitsheft');
  assert.equal(ah.exercises, '2, 3');
  assert.equal(ah.due, '2026-10-29');
});

test('Schularbeiten und Tests', () => {
  const sa = parseEntry('Mathe SA 12.11.', WED)!;
  assert.equal(sa.kind, 'exam');
  assert.equal(sa.kindLabel, 'Schularbeit');
  assert.equal(sa.due, '2026-11-12');

  const t = parseEntry('Bio Test nächste Woche Dienstag Kapitel 4-5', WED)!;
  assert.equal(t.kind, 'exam');
  assert.equal(t.due, '2026-11-03');
  assert.equal(t.rest, 'Kapitel 4-5');

  const v = parseEntry('vokabeltest englisch in 2 wochen', WED)!;
  assert.equal(v.due, '2026-11-11');
  assert.equal(v.title, 'Englisch Vokabeltest');
});

test('Datum ohne Jahr in der Vergangenheit → nächstes Jahr', () => {
  assert.equal(parseEntry('Deutsch Referat 3.2.', WED)!.due, '2027-02-03');
});

test('HÜ ohne Datum → nächster Schultag (angenommen)', () => {
  const e = parseEntry('Physik HÜ S 20 Nr 1', '2026-10-30')!; // Freitag
  assert.equal(e.due, '2026-11-02');
  assert.equal(e.dueAssumed, true);
});

test('"am" vor Datum ist kein Fach', () => {
  const e = parseEntry('Latein Test am 5.11.', WED)!;
  assert.equal(e.subject, 'Latein');
  assert.equal(e.rest, '');
});

test('Freitag am Freitag heißt nächster Freitag', () => {
  assert.equal(nextWeekday('2026-10-30', 5), '2026-11-06');
});

test('normale Sätze gehen an die KI', () => {
  assert.equal(interpret('Wie wird das Wetter morgen?', WED), null);
  assert.equal(interpret('Erzähl mir einen Witz', WED), null);
  assert.equal(interpret('hallo', WED), null);
});

test('Erledigt- und Agenda-Befehle', () => {
  assert.deepEqual(interpret('Latein HÜ erledigt', WED), { type: 'done', subject: 'Latein', kind: 'homework' });
  assert.equal(interpret('was steht an?', WED)?.type, 'agenda');
  assert.equal(interpret('Was habe ich diese Woche', WED)?.type, 'agenda');
});

test('Erinnerungen: HÜ am Vorabend mit Bild, Test 7 und 1 Tag vorher', () => {
  const hw = planReminders({ kind: 'homework', title: 'Latein HÜ', detail: 'S. 45 Nr. 3', due: '2026-10-30' }, WED);
  assert.deepEqual(hw.map((r) => [r.date, r.time, r.withAttachments]), [['2026-10-29', '19:00', true]]);

  const ex = planReminders({ kind: 'exam', title: 'Mathe Schularbeit', due: '2026-11-12' }, WED);
  assert.deepEqual(ex.map((r) => r.date), ['2026-11-05', '2026-11-11']);

  // Vergangene Erinnerungen werden übersprungen
  const soon = planReminders({ kind: 'exam', title: 'Test', due: '2026-10-30' }, WED);
  assert.deepEqual(soon.map((r) => r.date), ['2026-10-29']);
});

test('Lernplan: verteilt, endet mit Wiederholung, nie am Prüfungstag', () => {
  const plan = buildStudyPlan('2026-11-12', WED, 'Kapitel 5, Vokabeln L12 und AcI');
  assert.ok(plan.length >= 3 && plan.length <= 6);
  assert.ok(plan.every((s) => s.date > WED && s.date < '2026-11-12'));
  assert.equal(plan.at(-1)!.focus, 'Alles wiederholen + Probe-Test unter Zeitdruck');
  assert.ok(plan.some((s) => s.focus.includes('AcI')));
  assert.equal(new Set(plan.map((s) => s.date)).size, plan.length);
});

test('Zeitzonen inkl. Sommerzeit', () => {
  assert.equal(zonedToUtc('2026-10-29', '19:00', 'Europe/Vienna').toISOString(), '2026-10-29T18:00:00.000Z');
  assert.equal(zonedToUtc('2026-07-01', '19:00', 'Europe/Vienna').toISOString(), '2026-07-01T17:00:00.000Z');
});
