// Kalender: Blöcke, Raster und Anordnung – reine Funktionen für Server (GET /api/calendar) und Web-Apps (Offline-Rechnung).
// Uhrzeiten sind Ortszeit der Person („HH:MM“) pro Datum; Zeitzonen und Sommerzeit spielen nur bei echten Dauern eine Rolle (`realMinutes`).

import { addDays, weekdayOf, zonedToUtc, type Ymd } from './dates.ts';
import type { Item } from './types.ts';

export type CalendarKind = 'event' | 'todo' | 'exam' | 'study' | 'assignment' | 'homework' | 'reminder' | 'lesson' | 'goal' | 'routine';

export interface CalendarBlock {
  id: string;
  kind: CalendarKind;
  title: string;
  date: Ymd;
  /** „HH:MM“; null = ohne Uhrzeit (To-dos, Fristen) */
  start: string | null;
  end: string | null;
  status: 'open' | 'done' | 'cancelled';
  /** Eintrag aus dem Planer: lässt sich öffnen, ziehen, dehnen */
  itemId?: string;
  subject?: string | null;
  location?: string | null;
  detail?: string | null;
  /** Hintergrundstreifen (Routinen, Unterricht) statt voller Block */
  soft?: boolean;
}

export interface CalendarDay {
  date: Ymd;
  blocks: CalendarBlock[];
  /** freie Zeitfenster (nur ab heute) */
  free: { start: string; end: string }[];
  freeMinutes: number;
  /** Auslastung 0–1 (belegte Minuten im Tagesfenster) */
  load: number;
}

export const DEFAULT_MINUTES: Record<string, number> = { study: 45, event: 60, todo: 30, exam: 60, homework: 30, assignment: 60, reminder: 15 };

export const toMin = (hhmm: string): number => { const [h, m] = hhmm.split(':').map(Number); return (h ?? 0) * 60 + (m ?? 0); };
export const toHhmm = (min: number): string => {
  const c = Math.max(0, Math.min(24 * 60 - 1, Math.round(min)));
  return `${String(Math.floor(c / 60)).padStart(2, '0')}:${String(c % 60).padStart(2, '0')}`;
};
/** auf Raster runden (Standard 15 Minuten) */
export const snap = (min: number, step = 15): number => Math.round(min / step) * step;

/** Echte Minuten zwischen zwei Ortszeiten am selben Datum – an Tagen mit Zeitumstellung 60 weniger/mehr als die Uhr zeigt */
export function realMinutes(date: Ymd, start: string, end: string, timeZone: string): number {
  return Math.round((zonedToUtc(date, end, timeZone).getTime() - zonedToUtc(date, start, timeZone).getTime()) / 60_000);
}

/** Einträge → Blöcke (offene, erledigte; gelöschte und abgesagte nicht). Ohne Uhrzeit: start/end = null. */
export function blocksForItems(items: Item[]): CalendarBlock[] {
  const out: CalendarBlock[] = [];
  for (const i of items) {
    if (i.deleted || !i.due || i.status === 'cancelled') continue;
    const timed = !!i.time;
    out.push({
      id: i.id, kind: i.kind === 'reminder' ? 'reminder' : (i.kind as CalendarKind), title: i.title, date: i.due,
      start: i.time, end: timed ? toHhmm(Math.min(toMin(i.time!) + (i.duration ?? DEFAULT_MINUTES[i.kind] ?? 30), 24 * 60 - 1)) : null,
      status: i.status === 'done' ? 'done' : 'open', itemId: i.id, subject: i.subject, location: i.location ?? null, detail: i.detail,
    });
  }
  return out;
}

// ---------- Raster ----------

/** Montag = erster Tag der Woche */
export const weekStart = (ymd: Ymd): Ymd => addDays(ymd, -((weekdayOf(ymd) + 6) % 7));

export interface MonthCell { date: Ymd; inMonth: boolean; weekend: boolean }

/** Monatsraster: volle Wochen (Mo–So), 4–6 Zeilen */
export function monthGrid(anyDayInMonth: Ymd): MonthCell[][] {
  const first = `${anyDayInMonth.slice(0, 7)}-01`;
  const month = anyDayInMonth.slice(0, 7);
  let cursor = weekStart(first);
  const rows: MonthCell[][] = [];
  for (let r = 0; r < 6; r++) {
    const row: MonthCell[] = [];
    for (let c = 0; c < 7; c++) { row.push({ date: cursor, inMonth: cursor.startsWith(month), weekend: c >= 5 }); cursor = addDays(cursor, 1); }
    if (r >= 4 && !row.some((x) => x.inMonth)) break;
    rows.push(row);
  }
  return rows;
}

/** Bis zu `max` Punkte je Tag, nach Art gruppiert (Reihenfolge: Prüfung, Frist, Lerneinheit, Termin, To-do, Ziel) */
export function dayDots(blocks: CalendarBlock[], max = 3): { kind: CalendarKind; count: number }[] {
  const order: CalendarKind[] = ['exam', 'assignment', 'homework', 'study', 'event', 'reminder', 'todo', 'goal'];
  const counts = new Map<CalendarKind, number>();
  for (const b of blocks) if (!b.soft && b.status !== 'cancelled') counts.set(b.kind, (counts.get(b.kind) ?? 0) + 1);
  return order.filter((k) => counts.has(k)).slice(0, max).map((kind) => ({ kind, count: counts.get(kind)! }));
}

/** Sichtbarer Bereich der Zeitachse in Minuten: von der ersten bis zur letzten Belegung (auf volle Stunden), mindestens 7–22 Uhr */
export function axisRange(blocks: CalendarBlock[], dflt: [number, number] = [7, 22]): { startMin: number; endMin: number } {
  let lo = dflt[0] * 60;
  let hi = dflt[1] * 60;
  for (const b of blocks) {
    if (b.start === null || b.end === null) continue;
    lo = Math.min(lo, Math.floor(toMin(b.start) / 60) * 60);
    hi = Math.max(hi, Math.ceil(toMin(b.end) / 60) * 60);
  }
  return { startMin: lo, endMin: Math.min(hi, 24 * 60) };
}

export interface Placed { block: CalendarBlock; startMin: number; endMin: number; column: number; columns: number }

/** Überlappende Blöcke nebeneinander legen (einfache Spaltenverteilung je Überlappungsgruppe) */
export function layoutDay(blocks: CalendarBlock[]): Placed[] {
  const timed = blocks.filter((b) => b.start !== null && b.end !== null)
    .map((b) => ({ block: b, startMin: toMin(b.start!), endMin: Math.max(toMin(b.end!), toMin(b.start!) + 15) }))
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  const placed: Placed[] = [];
  let group: Placed[] = [];
  let groupEnd = -1;
  const flush = () => { const cols = group.reduce((m, p) => Math.max(m, p.column + 1), 1); for (const p of group) p.columns = cols; placed.push(...group); group = []; };
  for (const t of timed) {
    if (t.startMin >= groupEnd) { flush(); groupEnd = -1; }
    const used = new Set(group.filter((p) => p.endMin > t.startMin).map((p) => p.column));
    let column = 0;
    while (used.has(column)) column++;
    group.push({ ...t, column, columns: 1 });
    groupEnd = Math.max(groupEnd, t.endMin);
  }
  flush();
  return placed;
}

/** Auslastung eines Tages: Anteil der belegten Minuten im Fenster (Hintergrundstreifen zählen nicht) */
export function dayLoad(blocks: CalendarBlock[], window: [number, number] = [7 * 60, 21 * 60 + 30]): number {
  const span = window[1] - window[0];
  const taken = blocks.filter((b) => !b.soft && b.start !== null && b.end !== null && b.status !== 'cancelled')
    .map((b) => [Math.max(window[0], toMin(b.start!)), Math.min(window[1], toMin(b.end!))] as const)
    .filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let cursor = window[0];
  for (const [s, e] of taken) { const from = Math.max(s, cursor); if (e > from) { total += e - from; cursor = e; } }
  return Math.min(1, span > 0 ? total / span : 0);
}

/** Datum + Zeitraum des Kalenders je Ansicht */
export type CalendarView = 'month' | 'week' | 'day';
export function rangeFor(view: CalendarView, anchor: Ymd): { from: Ymd; to: Ymd } {
  if (view === 'day') return { from: anchor, to: anchor };
  if (view === 'week') { const s = weekStart(anchor); return { from: s, to: addDays(s, 6) }; }
  const grid = monthGrid(anchor);
  return { from: grid[0]![0]!.date, to: grid.at(-1)!.at(-1)!.date };
}
export function stepAnchor(view: CalendarView, anchor: Ymd, dir: 1 | -1): Ymd {
  if (view === 'day') return addDays(anchor, dir);
  if (view === 'week') return addDays(anchor, 7 * dir);
  const [y, m] = anchor.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + dir, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}
