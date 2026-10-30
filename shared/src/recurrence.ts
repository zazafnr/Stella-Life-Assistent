// Daueraufträge: „jeden Montag“, „täglich“, „jeden 15. des Monats“ als kurzer Text, der in der Datenbank steht.
//   daily · weekly:1,3 (1 = Montag … 7 = Sonntag) · monthly:15

import { addDays, makeYmd, weekdayOf, type Ymd } from './dates.ts';

export type Recurrence =
  | { kind: 'daily' }
  | { kind: 'weekly'; days: number[] }
  | { kind: 'monthly'; day: number };

export function parseRecurrence(s: unknown): Recurrence | null {
  const t = String(s ?? '').trim().toLowerCase();
  if (t === 'daily') return { kind: 'daily' };
  const weekly = /^weekly:([1-7](?:,[1-7])*)$/.exec(t);
  if (weekly) return { kind: 'weekly', days: [...new Set(weekly[1]!.split(',').map(Number))].sort((a, b) => a - b) };
  const monthly = /^monthly:(\d{1,2})$/.exec(t);
  if (monthly && Number(monthly[1]) >= 1 && Number(monthly[1]) <= 31) return { kind: 'monthly', day: Number(monthly[1]) };
  return null;
}

export function formatRecurrence(r: Recurrence): string {
  return r.kind === 'daily' ? 'daily' : r.kind === 'weekly' ? `weekly:${r.days.join(',')}` : `monthly:${r.day}`;
}

const isoWeekdayOf = (ymd: Ymd) => ((weekdayOf(ymd) + 6) % 7) + 1;

/** Erstes Datum ab `from` (einschließlich), das zum Rhythmus passt. Kürzere Monate: letzter Tag des Monats. */
export function nextOccurrence(rec: Recurrence | string, from: Ymd): Ymd {
  const r = typeof rec === 'string' ? parseRecurrence(rec) : rec;
  if (!r || r.kind === 'daily') return from;
  if (r.kind === 'weekly') {
    for (let i = 0; i < 7; i++) {
      const d = addDays(from, i);
      if (r.days.includes(isoWeekdayOf(d))) return d;
    }
    return from;
  }
  const [y, m] = from.split('-').map(Number) as [number, number];
  for (let k = 0; k < 14; k++) {
    const month = ((m - 1 + k) % 12) + 1;
    const year = y + Math.floor((m - 1 + k) / 12);
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const d = makeYmd(year, month, Math.min(r.day, last));
    if (d && d >= from) return d;
  }
  return from;
}

const DAY_NAMES = ['', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

/** „täglich“, „jeden Montag“, „jeden Montag und Donnerstag“, „werktags“, „jeden Monat am 15.“ */
export function describeRecurrence(rec: Recurrence | string): string {
  const r = typeof rec === 'string' ? parseRecurrence(rec) : rec;
  if (!r) return '';
  if (r.kind === 'daily') return 'täglich';
  if (r.kind === 'monthly') return `jeden Monat am ${r.day}.`;
  if (r.days.join(',') === '1,2,3,4,5') return 'werktags';
  if (r.days.join(',') === '6,7') return 'am Wochenende';
  const names = r.days.map((d) => DAY_NAMES[d]!);
  return `jeden ${names.length > 1 ? `${names.slice(0, -1).join(', ')} und ${names.at(-1)}` : names[0]}`;
}
