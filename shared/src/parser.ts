// Versteht Schul-Kurznotizen wie "Latein Hü Seite 45 nr 3 Freitag" ohne KI.
// Läuft auf dem Server UND offline in der App – spart außerdem KI-Anfragen.

import {
  addDays, makeYmd, nextSchoolDay, nextWeekday, weekdayNextWeek, type Ymd,
} from './dates.ts';

export type ItemKind = 'homework' | 'exam' | 'assignment' | 'event' | 'todo' | 'study';

export interface ParsedEntry {
  kind: ItemKind;
  /** z. B. "Schularbeit", "Test", "HÜ" – so wie es dem Nutzer vertraut ist */
  kindLabel: string;
  subject: string | null;
  page: string | null;
  exercises: string | null;
  /** Buch, Arbeitsheft, Arbeitsblatt … */
  book: string | null;
  due: Ymd | null;
  /** true, wenn kein Datum genannt wurde und wir eins angenommen haben */
  dueAssumed: boolean;
  time: string | null;
  /** übrig gebliebene Wörter, z. B. "Kapitel 5-7" */
  rest: string;
  title: string;
  detail: string;
}

export type Intent =
  | { type: 'create'; entry: ParsedEntry }
  | { type: 'done'; subject: string | null; kind: ItemKind | null }
  | { type: 'agenda'; days: number };

// Muss mit 'u'-Flag benutzt werden: \b kennt kein ü/ä/ö.
const B = '(?<![\\p{L}\\p{N}])';
const E = '(?![\\p{L}\\p{N}])';

const SUBJECTS: [string, string[]][] = [
  ['Mathe', ['mathe', 'mathematik', 'ma']],
  ['Deutsch', ['deutsch', 'de', 'dt']],
  ['Englisch', ['englisch', 'english', 'engl', 'en']],
  ['Latein', ['latein', 'lat', 'la']],
  ['Französisch', ['französisch', 'franzoesisch', 'franz', 'frz']],
  ['Spanisch', ['spanisch', 'spa', 'span']],
  ['Italienisch', ['italienisch', 'ita', 'ital']],
  ['Griechisch', ['griechisch', 'gr']],
  ['Physik', ['physik', 'ph']],
  ['Chemie', ['chemie', 'ch']],
  ['Biologie', ['biologie', 'bio', 'bu']],
  ['Geschichte', ['geschichte', 'gsk', 'gs', 'ge']],
  ['Geografie', ['geografie', 'geographie', 'geo', 'gwk', 'gw']],
  ['Informatik', ['informatik', 'info', 'inf']],
  ['Musik', ['musik', 'mu', 'me']],
  ['Kunst', ['kunst', 'be', 'bildnerische']],
  ['Religion', ['religion', 'reli', 'rk', 'rel']],
  ['Ethik', ['ethik', 'eth']],
  ['Psychologie & Philosophie', ['psychologie', 'philosophie', 'psy', 'philo', 'pup', 'pp']],
  ['Sport', ['sport', 'bsp', 'turnen']],
  ['Wirtschaft', ['wirtschaft', 'bwl', 'rw', 'rechnungswesen']],
];

const KINDS: [ItemKind, string, string[]][] = [
  ['homework', 'HÜ', ['hü', 'hue', 'hüs', 'hausübung', 'hausuebung', 'hausaufgabe', 'hausaufgaben', 'ha', 'hausi', 'hausis']],
  ['exam', 'Schularbeit', ['sa', 'schularbeit', 'klausur', 'ka']],
  ['exam', 'Test', ['test', 'vokabeltest', 'quiz', 'lzk', 'lernzielkontrolle']],
  ['exam', 'Prüfung', ['prüfung', 'pruefung', 'mündliche', 'mü', 'swh', 'stundenwiederholung']],
  ['assignment', 'Referat', ['referat', 'präsentation', 'praesentation', 'präsi']],
  ['assignment', 'Abgabe', ['abgabe', 'projekt', 'portfolio']],
];

/** Spezifischere Bezeichnung behalten, z. B. "Vokabeltest" statt nur "Test" */
const LABEL_OVERRIDE: Record<string, string> = {
  vokabeltest: 'Vokabeltest', quiz: 'Quiz', swh: 'Stundenwiederholung', stundenwiederholung: 'Stundenwiederholung',
  mü: 'Mitarbeitsüberprüfung', mündliche: 'Mündliche Prüfung', präsentation: 'Präsentation', praesentation: 'Präsentation',
  präsi: 'Präsentation', projekt: 'Projekt', portfolio: 'Portfolio', klausur: 'Klausur',
};

const WEEKDAY_WORDS: [number, string[]][] = [
  [1, ['montag', 'mo']],
  [2, ['dienstag', 'di']],
  [3, ['mittwoch', 'mi']],
  [4, ['donnerstag', 'do']],
  [5, ['freitag', 'fr']],
  // "sa" ist für Schularbeit reserviert – Samstag nur ausgeschrieben
  [6, ['samstag']],
  [0, ['sonntag', 'so']],
];

const BOOKS: [string, string[]][] = [
  ['Arbeitsheft', ['arbeitsheft', 'ah']],
  ['Arbeitsblatt', ['arbeitsblatt', 'ab']],
  ['Schulbuch', ['schulbuch', 'buch', 'sb']],
  ['Heft', ['heft']],
];

const alt = (words: string[]) => words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length).join('|');

function lookup<T>(table: [T, ...unknown[]][], words: (t: [T, ...unknown[]]) => string[], token: string) {
  return table.find((row) => words(row).includes(token));
}

const WEEKDAY_RE = alt(WEEKDAY_WORDS.flatMap(([, w]) => w));
const weekdayNumber = (word: string) => WEEKDAY_WORDS.find(([, w]) => w.includes(word))![0];

interface Ctx { text: string; today: Ymd }

/** Entfernt den ersten Treffer aus dem Text und liefert die Gruppen. */
function take(ctx: Ctx, pattern: string): RegExpExecArray | null {
  const re = new RegExp(pattern, 'iu');
  const m = re.exec(ctx.text);
  if (m) ctx.text = (ctx.text.slice(0, m.index) + ' ' + ctx.text.slice(m.index + m[0].length)).replace(/\s+/g, ' ');
  return m;
}

function takeDate(ctx: Ctx): Ymd | null {
  const { today } = ctx;
  let m = take(ctx, `${B}(\\d{1,2})\\.(\\d{1,2})\\.(\\d{4}|\\d{2})?${E}|${B}(\\d{1,2})\\.(\\d{1,2})${E}(?!\\s*uhr)`);
  if (m) {
    const day = Number(m[1] ?? m[4]);
    const month = Number(m[2] ?? m[5]);
    let year = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : Number(today.slice(0, 4));
    let ymd = makeYmd(year, month, day);
    if (ymd && !m[3] && ymd < today) ymd = makeYmd(++year, month, day);
    if (ymd) return ymd;
  }
  m = take(ctx, `${B}in\\s+(\\d+|einer|einem|zwei|drei)\\s+(tag|tagen|woche|wochen)${E}`);
  if (m) {
    const words: Record<string, number> = { einer: 1, einem: 1, zwei: 2, drei: 3 };
    const n = words[m[1].toLowerCase()] ?? Number(m[1]);
    return addDays(today, m[2].toLowerCase().startsWith('woche') ? n * 7 : n);
  }
  if (take(ctx, `${B}übermorgen${E}|${B}uebermorgen${E}`)) return addDays(today, 2);
  if (take(ctx, `${B}morgen${E}`)) return addDays(today, 1);
  if (take(ctx, `${B}heute${E}`)) return today;
  m = take(ctx, `${B}(?:nächste|naechste|kommende)\\s+woche\\s+(${WEEKDAY_RE})\\.?${E}`);
  if (m) return weekdayNextWeek(today, weekdayNumber(m[1].toLowerCase()));
  m = take(ctx, `${B}(?:(?:am|bis|nächsten|naechsten|kommenden|diesen)\\s+)*(${WEEKDAY_RE})\\.?${E}`);
  if (m) return nextWeekday(today, weekdayNumber(m[1].toLowerCase()));
  if (take(ctx, `${B}(?:nächste|naechste|kommende)\\s+woche${E}`)) return weekdayNextWeek(today, 1);
  return null;
}

function takeTime(ctx: Ctx): string | null {
  const m = take(ctx, `${B}(?:um\\s+)?(\\d{1,2})(?::(\\d{2})|\\.(\\d{2})\\s*uhr|\\s*uhr)${E}|${B}um\\s+(\\d{1,2})${E}`);
  if (!m) return null;
  const h = Number(m[1] ?? m[4]);
  const min = Number(m[2] ?? m[3] ?? 0);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function normalizeNumbers(raw: string): string {
  return raw
    .replace(/\s*(?:bis|–|-)\s*/giu, '–')
    .replace(/\s*(?:,|\+|&|\/|und)\s*/giu, ', ')
    .trim();
}

export function parseEntry(input: string, today: Ymd): ParsedEntry | null {
  const ctx: Ctx = { text: ` ${input.trim()} `, today };

  const pageM = take(ctx, `${B}(?:seiten?|s\\.?)\\s*(\\d+)(?:\\s*(?:-|–|bis)\\s*(\\d+))?${E}`);
  const page = pageM ? (pageM[2] ? `${pageM[1]}–${pageM[2]}` : pageM[1]) : null;

  const exM = take(ctx,
    `${B}(?:nr\\.?|nummer[n]?|aufgabe[n]?|aufg\\.?|bsp\\.?|beispiel[e]?|übung(?:en)?|ü\\.?)\\s*` +
    `(\\d+[a-z]?(?:\\s*(?:,|\\+|&|/|-|–|und|bis)\\s*\\d+[a-z]?)*)${E}`);
  const exercises = exM ? normalizeNumbers(exM[1]) : null;

  const time = takeTime(ctx);
  let due = takeDate(ctx);

  const bookM = take(ctx, `${B}(${alt(BOOKS.flatMap(([, w]) => w))})${E}`);
  const book = bookM ? lookup(BOOKS, (r) => r[1] as string[], bookM[1].toLowerCase())![0] : null;

  // Fach und Art aus den übrigen Wörtern holen
  let subject: string | null = null;
  let kind: ItemKind | null = null;
  let kindLabel = '';
  const restWords: string[] = [];
  for (const raw of ctx.text.split(/\s+/).filter(Boolean)) {
    const word = raw.toLowerCase().replace(/[.,:;!?]+$/u, '');
    const k = KINDS.find(([, , words]) => words.includes(word));
    const s = SUBJECTS.find(([, words]) => words.includes(word));
    if (k && !kind) { kind = k[0]; kindLabel = LABEL_OVERRIDE[word] ?? k[1]; continue; }
    if (s && !subject) { subject = s[0]; continue; }
    if (['bis', 'für', 'fuer', 'am', 'zum', 'zur', 'die', 'der', 'das', 'in'].includes(word) && !restWords.length) continue;
    restWords.push(raw);
  }

  if (!kind && (page || exercises) && (subject || due)) { kind = 'homework'; kindLabel = 'HÜ'; }
  if (!kind) return null;
  if (!subject && !page && !exercises && !due) return null;

  let dueAssumed = false;
  if (!due && kind === 'homework') { due = nextSchoolDay(today); dueAssumed = true; }

  const rest = restWords.join(' ').trim();
  const title = [subject, kindLabel].filter(Boolean).join(' ');
  const detail = [
    book,
    page && `S. ${page}`,
    exercises && `Nr. ${exercises}`,
    rest,
  ].filter(Boolean).join(' ');

  return { kind, kindLabel, subject, page, exercises, book, due, dueAssumed, time, rest, title, detail };
}

const DONE_RE = new RegExp(`${B}(erledigt|fertig|gemacht|done|abgehakt|geschafft)${E}`, 'iu');
const AGENDA_RE = new RegExp(
  '^\\s*(was\\s+steht(\\s+\\S+){0,3}\\s+an|was\\s+hab(e)?\\s+ich(\\s+(heute|morgen|diese\\s+woche|nächste\\s+woche|so|noch|zu\\s+tun|auf|an))*' +
  '|agenda|übersicht|uebersicht|meine\\s+(termine|hüs?|hausübungen|aufgaben|tests)|termine|hausübungen)\\s*[?!.]?\\s*$', 'iu');

/** Schnelle, KI-freie Erkennung der häufigsten Befehle. `null` → an die KI weitergeben. */
export function interpret(input: string, today: Ymd): Intent | null {
  const text = input.trim();
  if (!text) return null;

  if (DONE_RE.test(text) && text.split(/\s+/).length <= 6) {
    const words = text.toLowerCase().split(/\s+/).map((w) => w.replace(/[.,!?]+$/u, ''));
    const subject = SUBJECTS.find(([, ws]) => words.some((w) => ws.includes(w)))?.[0] ?? null;
    const kind = KINDS.find(([, , ws]) => words.some((w) => ws.includes(w)))?.[0] ?? null;
    if (subject || kind) return { type: 'done', subject, kind };
  }

  if (AGENDA_RE.test(text)) {
    const week = /woche/iu.test(text);
    return { type: 'agenda', days: week ? 7 : 14 };
  }

  // Lange, ausformulierte Sätze lieber der KI geben
  if (text.split(/\s+/).length > 14) return null;
  if (/\?\s*$/.test(text)) return null;
  const entry = parseEntry(text, today);
  return entry ? { type: 'create', entry } : null;
}
