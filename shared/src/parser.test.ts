import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpret, normalizeSubject, parseEntry } from './parser.ts';
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

test('Fächer aus WebUntis-Kürzeln', () => {
  assert.equal(normalizeSubject('F'), 'Französisch');
  assert.equal(normalizeSubject('M'), 'Mathe');
  assert.equal(normalizeSubject('Latein'), 'Latein');
  assert.equal(normalizeSubject('BSPK'), 'Sport');
  assert.equal(normalizeSubject('Mathematik'), 'Mathe');
  assert.equal(normalizeSubject('Robotik'), 'Robotik');
});

test('Französisch-HÜ aus dem scook-Buch', () => {
  const e = parseEntry('Französisch HÜ S. 45 Nr. 16 Freitag', WED)!;
  assert.equal(e.subject, 'Französisch');
  assert.equal(e.exercises, '16');
});

test('Phase 3: verschieben und löschen sind Befehle, keine neuen Einträge', () => {
  assert.deepEqual(interpret('verschieb die Mathe HÜ auf Montag', WED), {
    type: 'move', query: { subject: 'Mathe', kind: 'homework', words: [] }, due: '2026-11-02', time: null,
  });
  assert.deepEqual(interpret('Zahnarzt auf 16 Uhr verschieben', WED), {
    type: 'move', query: { subject: null, kind: null, words: ['zahnarzt'] }, due: null, time: '16:00',
  });
  assert.equal(interpret('lösch die Deutsch HÜ', WED)?.type, 'delete');
  assert.deepEqual(interpret('Zahnarzt absagen', WED), { type: 'delete', query: { subject: null, kind: null, words: ['zahnarzt'] } });
  assert.equal(interpret('Latein HÜ S. 45 Nr. 3 Freitag', WED)?.type, 'create', 'Kurznotizen bleiben Kurznotizen');
});

test('Phase 3: Erinnerungen mit relativer und fester Zeit', () => {
  assert.deepEqual(interpret('erinnere mich in 2 Stunden an die Wäsche', WED, '20:30'), { type: 'remind', due: '2026-10-28', time: '22:30', text: 'Die Wäsche' });
  assert.deepEqual(interpret('in 30 min Pizza aus dem Ofen', WED, '23:50'), { type: 'remind', due: '2026-10-29', time: '00:20', text: 'Pizza aus dem Ofen' });
  assert.deepEqual(interpret('erinnere mich morgen um 7 an Turnsachen', WED), { type: 'remind', due: '2026-10-29', time: '07:00', text: 'Turnsachen' });
  assert.deepEqual(interpret('erinnere mich um 18 Uhr an Mama anrufen', WED, '19:00'), { type: 'remind', due: '2026-10-29', time: '18:00', text: 'Mama anrufen' });
});

test('Phase 3: Alltagstermine, Gedächtnis und Korrekturen', () => {
  const e = interpret('Freitag 15 Uhr Friseur', WED);
  assert.equal(e?.type, 'create');
  assert.deepEqual(e?.type === 'create' && [e.entry.kind, e.entry.title, e.entry.due, e.entry.time], ['event', 'Friseur', '2026-10-30', '15:00']);
  const g = interpret('Geburtstag Mia 15.11.', WED);
  assert.deepEqual(g?.type === 'create' && [g.entry.kind, g.entry.title, g.entry.due], ['todo', 'Geburtstag Mia', '2026-11-15']);
  assert.deepEqual(interpret('merk dir, dass ich Erdnussallergie habe', WED), { type: 'remember', text: 'Ich habe Erdnussallergie' });
  assert.deepEqual(interpret('merk dir: Frau Huber ist meine Klassenvorständin', WED), { type: 'remember', text: 'Frau Huber ist meine Klassenvorständin' });
  assert.deepEqual(interpret('vergiss das mit dem Training', WED), { type: 'forget', text: 'dem Training' });
  assert.deepEqual(interpret('nein, Donnerstag', WED), { type: 'correct', due: '2026-10-29', time: null });
  assert.deepEqual(interpret('doch erst um 16 Uhr', WED), { type: 'correct', due: null, time: '16:00' });
  assert.equal(interpret('Einkaufen: Milch, Brot', WED), null, 'ohne Datum → KI');
  assert.equal(interpret('Wann ist eigentlich die nächste Mathe SA?', WED), null);
});
