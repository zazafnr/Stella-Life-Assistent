// Kalender-Arithmetik auf reinen Datumsstrings ('YYYY-MM-DD').
// So hängt "Freitag" nie davon ab, in welcher Zeitzone der Server läuft –
// nur beim Umrechnen in einen echten Zeitpunkt (Erinnerung) kommt die Zeitzone ins Spiel.

export type Ymd = string;

export const WEEKDAYS_DE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

function toUtcMs(ymd: Ymd): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtcMs(ms: number): Ymd {
  return new Date(ms).toISOString().slice(0, 10);
}

export function makeYmd(y: number, m: number, d: number): Ymd | null {
  const ms = Date.UTC(y, m - 1, d);
  const out = new Date(ms);
  if (out.getUTCFullYear() !== y || out.getUTCMonth() !== m - 1 || out.getUTCDate() !== d) return null;
  return fromUtcMs(ms);
}

export function addDays(ymd: Ymd, n: number): Ymd {
  return fromUtcMs(toUtcMs(ymd) + n * 86_400_000);
}

export function diffDays(a: Ymd, b: Ymd): number {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / 86_400_000);
}

/** 0 = Sonntag … 6 = Samstag */
export function weekdayOf(ymd: Ymd): number {
  return new Date(toUtcMs(ymd)).getUTCDay();
}

/** Nächstes Vorkommen des Wochentags, strikt nach `from` (am Freitag heißt "Freitag" also nächste Woche). */
export function nextWeekday(from: Ymd, weekday: number): Ymd {
  const delta = (weekday - weekdayOf(from) + 7) % 7 || 7;
  return addDays(from, delta);
}

/** Wochentag in der kommenden Kalenderwoche (Mo–So). */
export function weekdayNextWeek(from: Ymd, weekday: number): Ymd {
  const mondayThisWeek = addDays(from, -((weekdayOf(from) + 6) % 7));
  return addDays(mondayThisWeek, 7 + ((weekday + 6) % 7));
}

/** Nächster Schultag (Mo–Fr) nach `from`. */
export function nextSchoolDay(from: Ymd): Ymd {
  let d = addDays(from, 1);
  while (weekdayOf(d) === 0 || weekdayOf(d) === 6) d = addDays(d, 1);
  return d;
}

export function todayIn(timeZone: string, now: Date = new Date()): Ymd {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function timeIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('de-AT', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
}

function tzOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - utcMs;
}

/** Lokale Uhrzeit (z. B. Donnerstag 19:00 in Europe/Vienna) → echter Zeitpunkt. */
export function zonedToUtc(ymd: Ymd, hhmm: string, timeZone: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let result = guess - tzOffsetMs(guess, timeZone);
  // zweiter Durchlauf korrigiert Zeitumstellungs-Grenzfälle
  result = guess - tzOffsetMs(result, timeZone);
  return new Date(result);
}

export function formatDateDe(ymd: Ymd, today?: Ymd): string {
  if (today) {
    const diff = diffDays(today, ymd);
    if (diff === 0) return 'heute';
    if (diff === 1) return 'morgen';
    if (diff === 2) return 'übermorgen';
  }
  const [, m, d] = ymd.split('-').map(Number);
  return `${WEEKDAYS_DE[weekdayOf(ymd)]}, ${d}.${m}.`;
}
