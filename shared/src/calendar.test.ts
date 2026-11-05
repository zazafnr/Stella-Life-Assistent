import { test } from 'node:test';
import assert from 'node:assert/strict';
import { axisRange, blocksForItems, dayDots, dayLoad, layoutDay, monthGrid, rangeFor, realMinutes, snap, stepAnchor, weekStart, type CalendarBlock } from './calendar.ts';
import type { Item } from './types.ts';

const item = (o: Partial<Item>): Item => ({
  id: 'x', kind: 'event', subject: null, title: 'T', detail: null, notes: null, page: null, exercises: null, due: '2026-11-05', time: null, status: 'open',
  material: null, parentId: null, attachments: [], updatedAt: '', deleted: false, ...o,
});
const blk = (start: string | null, end: string | null, extra: Partial<CalendarBlock> = {}): CalendarBlock => ({ id: `${start}-${end}`, kind: 'event', title: 'x', date: '2026-11-05', start, end, status: 'open', ...extra });

test('Einträge werden zu Blöcken: mit Uhrzeit und Dauer, ohne Uhrzeit als Tagesblock; Gelöschtes und Abgesagtes fehlt', () => {
  const blocks = blocksForItems([
    item({ id: 'a', time: '14:30', duration: 90 }),
    item({ id: 'b', kind: 'exam', time: '09:00' }),
    item({ id: 'c', kind: 'todo' }),
    item({ id: 'd', deleted: true, time: '10:00' }),
    item({ id: 'e', status: 'cancelled', time: '11:00' }),
    item({ id: 'f', due: null, time: '12:00' }),
    item({ id: 'g', status: 'done', time: '23:30', duration: 120 }),
  ]);
  assert.deepEqual(blocks.map((b) => b.id), ['a', 'b', 'c', 'g']);
  assert.deepEqual([blocks[0]!.start, blocks[0]!.end], ['14:30', '16:00']);
  assert.deepEqual([blocks[1]!.start, blocks[1]!.end], ['09:00', '10:00'], 'Standarddauer je Art');
  assert.deepEqual([blocks[2]!.start, blocks[2]!.end], [null, null]);
  assert.equal(blocks[3]!.end, '23:59', 'nie über Mitternacht hinaus');
  assert.equal(blocks[3]!.status, 'done');
});

test('Monatsraster: volle Wochen von Montag bis Sonntag, Wochenenden und Nachbarmonate markiert', () => {
  const g = monthGrid('2026-11-05');
  assert.equal(g.length, 6, 'der November 2026 beginnt an einem Sonntag und endet in der sechsten Woche');
  assert.equal(g[0]![0]!.date, '2026-10-26');
  assert.equal(g[0]![0]!.inMonth, false);
  assert.equal(g[0]![6]!.date, '2026-11-01');
  assert.equal(g[0]![6]!.inMonth, true);
  assert.equal(g.at(-1)!.at(-1)!.date, '2026-12-06');
  assert.deepEqual(g[1]!.map((c) => c.weekend), [false, false, false, false, false, true, true]);
  assert.equal(monthGrid('2027-02-10').length, 4, 'Februar 2027 (Montag bis Sonntag) passt in vier Wochen');
  assert.equal(monthGrid('2026-02-10').length, 5);
  assert.equal(monthGrid('2026-03-31')[0]![0]!.date, '2026-02-23');
  assert.equal(weekStart('2026-11-08'), '2026-11-02', 'Sonntag gehört zur Woche davor');
});

test('Zeitraum und Blättern je Ansicht: Tag ±1, Woche ±7, Monat zum Monatsersten', () => {
  assert.deepEqual(rangeFor('day', '2026-11-05'), { from: '2026-11-05', to: '2026-11-05' });
  assert.deepEqual(rangeFor('week', '2026-11-05'), { from: '2026-11-02', to: '2026-11-08' });
  assert.deepEqual(rangeFor('month', '2026-11-05'), { from: '2026-10-26', to: '2026-12-06' });
  assert.equal(stepAnchor('day', '2026-11-30', 1), '2026-12-01');
  assert.equal(stepAnchor('week', '2026-11-05', -1), '2026-10-29');
  assert.equal(stepAnchor('month', '2026-12-15', 1), '2027-01-01');
  assert.equal(stepAnchor('month', '2026-01-31', -1), '2025-12-01');
});

test('Punkte im Monat: höchstens drei, nach Wichtigkeit, Hintergrundstreifen zählen nicht', () => {
  const dots = dayDots([blk('09:00', '10:00', { kind: 'todo' }), blk('10:00', '11:00', { kind: 'exam' }), blk('11:00', '12:00', { kind: 'study' }), blk('11:00', '12:00', { kind: 'event' }),
    blk('07:00', '08:00', { kind: 'routine', soft: true }), blk(null, null, { kind: 'todo' })]);
  assert.deepEqual(dots, [{ kind: 'exam', count: 1 }, { kind: 'study', count: 1 }, { kind: 'event', count: 1 }]);
});

test('Zeitachse: von der ersten bis zur letzten Belegung, sonst 7–22 Uhr', () => {
  assert.deepEqual(axisRange([]), { startMin: 7 * 60, endMin: 22 * 60 });
  assert.deepEqual(axisRange([blk('05:30', '06:15'), blk('22:00', '23:20')]), { startMin: 5 * 60, endMin: 24 * 60 });
  assert.deepEqual(axisRange([blk('09:00', '10:00'), blk(null, null)]), { startMin: 7 * 60, endMin: 22 * 60 });
});

test('Überlappungen: nebeneinander in Spalten, Nachbarn ohne Überlappung teilen sich nichts', () => {
  const placed = layoutDay([blk('09:00', '10:30', { id: 'a' }), blk('10:00', '11:00', { id: 'b' }), blk('10:15', '10:45', { id: 'c' }), blk('11:00', '12:00', { id: 'd' }), blk(null, null, { id: 'e' })]);
  const by = Object.fromEntries(placed.map((p) => [p.block.id, p]));
  assert.deepEqual([by.a!.column, by.b!.column, by.c!.column], [0, 1, 2]);
  assert.equal(by.a!.columns, 3);
  assert.deepEqual([by.d!.column, by.d!.columns], [0, 1], 'd beginnt, wenn b endet – eigene Gruppe');
  assert.equal(by.e, undefined, 'ohne Uhrzeit gehört nicht auf die Zeitachse');
  const tiny = layoutDay([blk('09:00', '09:00', { id: 'z' })])[0]!;
  assert.equal(tiny.endMin - tiny.startMin, 15, 'Mindesthöhe 15 Minuten');
});

test('Auslastung: belegte Minuten im Tagesfenster, Überlappungen zählen einmal', () => {
  assert.equal(dayLoad([]), 0);
  const half = (21 * 60 + 30 - 7 * 60) / 2;
  assert.ok(Math.abs(dayLoad([blk('07:00', '14:15')]) - half / (14.5 * 60)) < 0.01);
  assert.equal(dayLoad([blk('09:00', '11:00'), blk('10:00', '12:00')]), dayLoad([blk('09:00', '12:00')]));
  assert.equal(dayLoad([blk('09:00', '12:00', { soft: true })]), 0);
  assert.equal(dayLoad([blk('00:00', '23:59')]), 1);
});

test('Raster: 15-Minuten-Schritte', () => {
  assert.equal(snap(7), 0);
  assert.equal(snap(8), 15);
  assert.equal(snap(14 * 60 + 52), 14 * 60 + 45);
  assert.equal(snap(100, 30), 90);
});

test('Zeiten über die Sommerzeit hinweg: die Uhr zeigt 2 Stunden, echt vergeht 1 bzw. 3', () => {
  // Wien: 2026-03-29 springt von 02:00 auf 03:00, 2026-10-25 von 03:00 auf 02:00
  assert.equal(realMinutes('2026-03-29', '01:30', '03:30', 'Europe/Vienna'), 60);
  assert.equal(realMinutes('2026-10-25', '01:30', '03:30', 'Europe/Vienna'), 180);
  assert.equal(realMinutes('2026-11-05', '01:30', '03:30', 'Europe/Vienna'), 120);
  assert.equal(realMinutes('2026-03-29', '01:30', '03:30', 'UTC'), 120, 'ohne Umstellung 120');
  assert.equal(realMinutes('2026-03-08', '01:30', '03:30', 'America/New_York'), 60, 'USA: anderes Datum');
});
