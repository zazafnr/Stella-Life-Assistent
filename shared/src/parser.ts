// Versteht Schul-Kurznotizen wie "Latein Hü Seite 45 nr 3 Freitag" ohne KI.
// Läuft auf dem Server UND offline in der App – spart außerdem KI-Anfragen.

import {
  addDays, makeYmd, nextSchoolDay, nextWeekday, weekdayNextWeek, type Ymd,
} from './dates.ts';

export type ItemKind = 'homework' | 'exam' | 'assignment' | 'event' | 'todo' | 'study' | 'reminder';

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

/** Welcher Eintrag gemeint ist: Fach/Art (Mathe HÜ) oder freie Wörter (Zahnarzt) */
export interface ItemQuery { subject: string | null; kind: ItemKind | null; words: string[] }

export type Intent =
  | { type: 'create'; entry: ParsedEntry }
  | { type: 'done'; subject: string | null; kind: ItemKind | null }
  | { type: 'agenda'; days: number }
  /** "verschieb die Mathe-HÜ auf Montag", "Zahnarzt auf 16 Uhr" */
  | { type: 'move'; query: ItemQuery; due: Ymd | null; time: string | null }
  /** "lösch die Deutsch-HÜ", "Zahnarzt absagen" */
  | { type: 'delete'; query: ItemQuery }
  /** "erinnere mich in 2 Stunden an die Wäsche" */
  | { type: 'remind'; due: Ymd; time: string; text: string }
  /** "merk dir, dass …" / "vergiss, dass …" */
  | { type: 'remember'; text: string }
  | { type: 'forget'; text: string }
  /** "nein, Donnerstag" – bezieht sich auf den zuletzt angelegten/geänderten Eintrag */
  | { type: 'correct'; due: Ymd | null; time: string | null };

// Muss mit 'u'-Flag benutzt werden: \b kennt kein ü/ä/ö.
const B = '(?<![\\p{L}\\p{N}])';
const E = '(?![\\p{L}\\p{N}])';

export const SUBJECTS: [string, string[]][] = [
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

/** Kürzel aus WebUntis o. Ä. (oft nur ein Buchstabe) → Fachname wie im Planer */
const SINGLE_LETTER: Record<string, string> = {
  m: 'Mathe', d: 'Deutsch', e: 'Englisch', l: 'Latein', f: 'Französisch', s: 'Spanisch', i: 'Italienisch',
};

export function normalizeSubject(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const clean = raw.trim().toLowerCase();
  if (!clean) return null;
  const words = clean.split(/[\s_\-/.]+/u);
  for (const w of [clean, ...words]) {
    const hit = SUBJECTS.find(([name, aliases]) => name.toLowerCase() === w || aliases.includes(w));
    if (hit) return hit[0];
  }
  if (SINGLE_LETTER[words[0]]) return SINGLE_LETTER[words[0]];
  // Präfix-Treffer, z. B. "MAM" (Mathematik), "BSPK" (Bewegung und Sport)
  const prefix = clean.length <= 5 && /^[a-zäöü]+$/u.test(clean)
    ? SUBJECTS.find(([, aliases]) => aliases.some((a) => a.length >= 2 && clean.startsWith(a)))
    : undefined;
  return prefix ? prefix[0] : raw.trim();
}

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

const STOP = new Set(['die', 'der', 'das', 'den', 'dem', 'meine', 'meinen', 'mein', 'bitte', 'mal', 'noch', 'doch', 'auf', 'nach', 'zum', 'zur',
  'am', 'um', 'ein', 'eine', 'einen', 'termin', 'eintrag', 'heute', 'morgen', 'von', 'für', 'fuer', 'es', 'ihn', 'sie', 'schon', 'jetzt']);

/** Welcher Eintrag ist gemeint? Fach/Art erkennen, sonst bedeutungstragende Wörter */
export function itemQuery(raw: string): ItemQuery {
  let subject: string | null = null;
  let kind: ItemKind | null = null;
  const words: string[] = [];
  for (const w0 of raw.toLowerCase().split(/[\s,.!?:;-]+/u).filter(Boolean)) {
    const k = KINDS.find(([, , ws]) => ws.includes(w0));
    const subj = SUBJECTS.find(([, ws]) => ws.includes(w0));
    if (k && !kind) { kind = k[0]; continue; }
    if (subj && !subject) { subject = subj[0]; continue; }
    if (!STOP.has(w0) && w0.length > 1 && !/^\d+$/.test(w0)) words.push(w0);
  }
  return { subject, kind, words };
}

const MOVE_RE = new RegExp(`${B}(verschieb(e|en|t)?|verleg(e|en|t)?|umlegen|legen?\\s+.*\\s+auf)${E}`, 'iu');
const DELETE_RE = new RegExp(`${B}(lösch(e|en|t)?|loesch(e|en|t)?|entfern(e|en|t)?|streich(e|en|t)?|absagen|sag\\s+.+\\s+ab|abgesagt|fällt\\s+aus|faellt\\s+aus|fällt\\s+weg)${E}`, 'iu');
const REMEMBER_RE = /^\s*(bitte\s+)?merk(e)?\s*(dir|dir\s+mal)\s*(,\s*)?(dass\s+|:\s*)?(.+)$/iu;
const FORGET_RE = /^\s*(bitte\s+)?vergiss\s*(,\s*)?(dass\s+|das\s+mit\s+|:\s*)?(.+)$/iu;
const REMIND_RE = /^\s*(bitte\s+)?(erinner(e|n)?\s+mich|sag\s+mir\s+bescheid|remind\s+me)\b(.*)$/iu;
const RELATIVE_RE = new RegExp(`${B}in\\s+(\\d+|einer|einem|einer\\s+halben|zwei|drei)\\s*(min|minuten|minute|std|stunden|stunde|h)${E}`, 'iu');
const CORRECT_RE = /^\s*(nein|ne|nö|noe|nee|sorry|doch|lieber|eher|ich\s+meinte|meinte|falsch)?[\s,!.]*(?:(erst|schon|doch|lieber|eher)\s+)?(?:am|um|auf|bis)?\s*(.+?)\s*[!.]?$/iu;

/** "in 2 Stunden" / "in 30 min" → Datum + Uhrzeit ab `now` */
function relative(text: string, today: Ymd, now: string): { due: Ymd; time: string; rest: string } | null {
  const m = RELATIVE_RE.exec(text);
  if (!m) return null;
  const words: Record<string, number> = { einer: 1, einem: 1, zwei: 2, drei: 3, 'einer halben': 0.5 };
  const n = words[m[1]!.toLowerCase().replace(/\s+/g, ' ')] ?? Number(m[1]);
  const minutes = /^(std|stunde|stunden|h)$/iu.test(m[2]!) ? n * 60 : n;
  const [h, mi] = now.split(':').map(Number);
  const total = (h ?? 0) * 60 + (mi ?? 0) + Math.round(minutes);
  const due = addDays(today, Math.floor(total / 1440));
  const t = total % 1440;
  const time = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  return { due, time, rest: (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim() };
}

/** Nur Datum/Uhrzeit (für Korrekturen und Verschieben) */
export function parseWhen(input: string, today: Ymd): { due: Ymd | null; time: string | null; rest: string } {
  const ctx: Ctx = { text: ` ${input.trim()} `, today };
  const time = takeTime(ctx);
  const due = takeDate(ctx);
  return { due, time, rest: ctx.text.trim() };
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Schnelle, KI-freie Erkennung der häufigsten Befehle. `null` → an die KI weitergeben. */
export function interpret(input: string, today: Ymd, now = '12:00'): Intent | null {
  const text = input.trim();
  if (!text) return null;

  // merk dir / vergiss
  let m = REMEMBER_RE.exec(text);
  if (m && m[6]!.trim().length > 2) {
    let fact = m[6]!.trim().replace(/[.!]+$/u, '');
    // "dass ich Erdnussallergie habe" → "Ich habe Erdnussallergie" (Verb vom Ende nach vorne)
    if (m[5]?.trim().toLowerCase() === 'dass') {
      const w = fact.split(/\s+/);
      if (w.length >= 3 && /^(ich|er|sie|wir|mein|meine)$/iu.test(w[0]!)) fact = [w[0], w.at(-1), ...w.slice(1, -1)].join(' ');
    }
    return { type: 'remember', text: capitalize(fact) };
  }
  m = FORGET_RE.exec(text);
  if (m && m[4]!.trim().length > 2 && !/^(es|das)\s*[.!]?$/iu.test(m[4]!.trim())) return { type: 'forget', text: m[4]!.trim().replace(/[.!]+$/u, '') };

  // Erinnerungen: "erinnere mich in 2 Stunden an X", "in 30 min Pizza raus"
  m = REMIND_RE.exec(text);
  const rel = relative(m ? m[4]! : text, today, now);
  if (m || (rel && /^\s*in\s/iu.test(text))) {
    const body = m ? m[4]! : text;
    let due: Ymd | null = null;
    let time: string | null = null;
    let rest = body;
    if (rel) ({ due, time, rest } = relative(body, today, now)!);
    else ({ due, time, rest } = parseWhen(body, today));
    if (time) {
      due ??= time > now ? today : addDays(today, 1);
      const what = rest.replace(/^\s*(an|daran|dass|zu|bitte)\s+/iu, '').replace(/^(den|die|das|meine|mein)\s+/iu, (w) => w).replace(/[.!?]+$/u, '').trim();
      if (what) return { type: 'remind', due, time, text: capitalize(what) };
    }
  }

  // verschieben / löschen – vor "create", sonst wird aus "verschieb die Mathe-HÜ" eine neue HÜ
  if (DELETE_RE.test(text) && text.split(/\s+/).length <= 10) {
    const query = itemQuery(text.replace(DELETE_RE, ' '));
    if (query.subject || query.kind || query.words.length) return { type: 'delete', query };
  }
  if (MOVE_RE.test(text) || /\bauf\s+(\S+\s+)?(\d{1,2}(:\d{2})?\s*uhr|\d{1,2}\.\d{1,2}\.?|morgen|übermorgen|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)/iu.test(text) && !/\b(hü|hausübung|test|sa|schularbeit|referat)\b.*\b(s\.|seite|nr)/iu.test(text)) {
    const when = parseWhen(text.replace(MOVE_RE, ' '), today);
    if (when.due || when.time) {
      const query = itemQuery(when.rest);
      if (query.subject || query.kind || query.words.length) return { type: 'move', query, due: when.due, time: when.time };
    }
  }

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

  // Korrektur: nur ein Datum/eine Uhrzeit, evtl. mit "nein," davor
  if (text.split(/\s+/).length <= 6) {
    const c = CORRECT_RE.exec(text);
    if (c && (c[1] || c[2] || /^\s*(am|um|auf)\s/iu.test(text))) {
      const when = parseWhen(c[3]!, today);
      if ((when.due || when.time) && !when.rest.replace(/[\s,.!]/gu, '')) return { type: 'correct', due: when.due, time: when.time };
    }
  }

  // Lange, ausformulierte Sätze lieber der KI geben
  if (text.split(/\s+/).length > 14) return null;
  if (/\?\s*$/.test(text)) return null;
  const entry = parseEntry(text, today);
  if (entry) return { type: 'create', entry };

  // Alltag: "Freitag 15 Uhr Friseur", "morgen 17:00 Zahnarzt", "Geburtstag Mia 15.11."
  const when = parseWhen(text, today);
  const title = when.rest.replace(/^(am|um|ist|hab|habe|ich|hab'?\s*ich)\s+/iu, '').replace(/[.!]+$/u, '').trim();
  const words = title.split(/\s+/).filter(Boolean);
  if ((when.due || when.time) && words.length >= 1 && words.length <= 6 && !/^(und|oder|aber|weil|wenn|was|wie|wer|wann|warum)$/iu.test(words[0]!)) {
    const due = when.due ?? (when.time && when.time <= now ? addDays(today, 1) : today);
    const kind: ItemKind = when.time ? 'event' : 'todo';
    return {
      type: 'create',
      entry: { kind, kindLabel: kind === 'event' ? 'Termin' : 'To-do', subject: null, page: null, exercises: null, book: null,
        due, dueAssumed: false, time: when.time, rest: '', title: capitalize(title), detail: '' },
    };
  }
  return null;
}
