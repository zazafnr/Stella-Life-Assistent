// Quick notes in English, without AI: "math homework p. 45 no. 3 friday", "remind me in 2 hours to call mom",
// "add milk and eggs to the shopping list", "what's up?", "move the dentist to 4pm", "cancel math homework" …
// Same result type as the German parser (Intent). For other languages the message goes to the AI model instead.

import { addDays, makeYmd, nextSchoolDay, nextWeekday, weekdayNextWeek, type Ymd } from './dates.ts';
import { placeFor } from './places.ts';
import { formatRecurrence, type Recurrence } from './recurrence.ts';
import { vocabulary } from './parser.vocab.ts';
import { type Intent, type ItemKind, type ItemQuery, type ParsedEntry } from './parser.ts';

const B = '(?<![\\p{L}\\p{N}])';
const E = '(?![\\p{L}\\p{N}])';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const monthNumber = (w: string) => MONTHS.findIndex((m) => m.startsWith(w.toLowerCase().slice(0, 3))) + 1;

const WD: Record<string, number> = {
  monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6, sunday: 0, sun: 0,
};
const WD_RE = '(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues?|wed|thu(?:rs?)?|fri|sat|sun)';
const WORD_NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10, half: 0.5 };

interface Ctx { text: string; today: Ymd }

function take(ctx: Ctx, pattern: string): RegExpExecArray | null {
  const m = new RegExp(pattern, 'iu').exec(ctx.text);
  if (m) ctx.text = (ctx.text.slice(0, m.index) + ' ' + ctx.text.slice(m.index + m[0].length)).replace(/\s+/g, ' ');
  return m;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const cut = (text: string, m: RegExpExecArray) => (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();

function takeDate(ctx: Ctx): Ymd | null {
  const { today } = ctx;
  let m = take(ctx, `${B}(\\d{4})-(\\d{2})-(\\d{2})${E}`);
  if (m) { const ymd = makeYmd(Number(m[1]), Number(m[2]), Number(m[3])); if (ymd) return ymd; }
  m = take(ctx, `${B}(\\d{1,2})\\.(\\d{1,2})\\.(\\d{4}|\\d{2})?${E}`);
  if (m) return roll(today, Number(m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : NaN), Number(m[2]), Number(m[1]));
  m = take(ctx, `${B}(?:on\\s+|by\\s+|due\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\.?(?:\\s+(\\d{4}))?${E}`);
  if (m) return roll(today, m[3] ? Number(m[3]) : NaN, monthNumber(m[2]!), Number(m[1]));
  m = take(ctx, `${B}(?:on\\s+|by\\s+|due\\s+)?${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?${E}`);
  if (m) return roll(today, m[3] ? Number(m[3]) : NaN, monthNumber(m[1]!), Number(m[2]));
  m = take(ctx, `${B}in\\s+(\\d+|a|an|one|two|three|four|five)\\s+(day|days|week|weeks)${E}`);
  if (m) {
    const n = WORD_NUM[m[1]!.toLowerCase()] ?? Number(m[1]);
    return addDays(today, m[2]!.toLowerCase().startsWith('week') ? n * 7 : n);
  }
  if (take(ctx, `${B}day\\s+after\\s+tomorrow${E}`)) return addDays(today, 2);
  if (take(ctx, `${B}tomorrow${E}`)) return addDays(today, 1);
  if (take(ctx, `${B}(?:today|tonight|this\\s+(?:evening|afternoon|morning))${E}`)) return today;
  m = take(ctx, `${B}next\\s+week\\s+(?:on\\s+)?(${WD_RE})\\.?${E}`);
  if (m) return weekdayNextWeek(today, WD[m[1]!.toLowerCase()]!);
  m = take(ctx, `${B}(?:(?:on|by|this|next|until|till|due)\\s+)*(${WD_RE})\\.?${E}`);
  if (m) return nextWeekday(today, WD[m[1]!.toLowerCase()]!);
  if (take(ctx, `${B}next\\s+week${E}`)) return weekdayNextWeek(today, 1);
  return null;
}

function roll(today: Ymd, year: number, month: number, day: number): Ymd | null {
  const given = Number.isFinite(year);
  let y = given ? year : Number(today.slice(0, 4));
  let ymd = makeYmd(y, month, day);
  if (ymd && !given && ymd < today) ymd = makeYmd(++y, month, day);
  return ymd;
}

function takeTime(ctx: Ctx): string | null {
  let m = take(ctx, `${B}(?:at\\s+|by\\s+|around\\s+)?(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm|a\\.m\\.|p\\.m\\.)${E}`);
  if (m) {
    let h = Number(m[1]);
    const min = Number(m[2] ?? 0);
    const pm = m[3]!.toLowerCase().startsWith('p');
    if (h < 1 || h > 12 || min > 59) return null;
    h = (h % 12) + (pm ? 12 : 0);
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }
  m = take(ctx, `${B}(?:at\\s+|by\\s+)?(\\d{1,2}):(\\d{2})${E}`);
  if (m) {
    const h = Number(m[1]); const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }
  if (take(ctx, `${B}(?:at\\s+)?noon${E}`)) return '12:00';
  if (take(ctx, `${B}(?:at\\s+)?midnight${E}`)) return '23:59';
  // "at 5": 1–6 meint nachmittags
  m = take(ctx, `${B}at\\s+(\\d{1,2})${E}(?!\\s*(?:th|st|nd|rd))`);
  if (m) {
    let h = Number(m[1]);
    if (h < 1 || h > 23) return null;
    if (h >= 1 && h <= 6) h += 12;
    return `${String(h).padStart(2, '0')}:00`;
  }
  return null;
}

function parseWhen(input: string, today: Ymd): { due: Ymd | null; time: string | null; rest: string } {
  const ctx: Ctx = { text: ` ${input.trim()} `, today };
  const time = takeTime(ctx);
  const due = takeDate(ctx);
  return { due, time, rest: ctx.text.trim() };
}

// ---------- Daueraufträge ----------

const RECUR_WD_LIST = `${WD_RE}(?:\\s*(?:,|and|&)\\s*${WD_RE})*`;

function takeRecurrence(input: string): { recurrence: Recurrence; rest: string } | null {
  let m = new RegExp(`${B}(?:every\\s+month\\s+on\\s+the\\s+|monthly\\s+on\\s+the\\s+|on\\s+the\\s+)(\\d{1,2})(?:st|nd|rd|th)(?:\\s+of\\s+(?:every|each)\\s+month)?${E}`, 'iu').exec(input);
  if (m && /every|monthly|each/i.test(m[0])) { const day = Number(m[1]); if (day >= 1 && day <= 31) return { recurrence: { kind: 'monthly', day }, rest: cut(input, m) }; }
  m = new RegExp(`${B}(?:every|each)\\s+(${RECUR_WD_LIST})${E}`, 'iu').exec(input);
  if (m) return { recurrence: { kind: 'weekly', days: weekdays(m[1]!) }, rest: cut(input, m) };
  m = new RegExp(`${B}on\\s+((?:${WD_RE}s)(?:\\s*(?:,|and|&)\\s*${WD_RE}s)*)${E}`, 'iu').exec(input);
  if (m) return { recurrence: { kind: 'weekly', days: weekdays(m[1]!) }, rest: cut(input, m) };
  m = new RegExp(`${B}(?:every\\s+weekday|on\\s+weekdays|weekdays)${E}`, 'iu').exec(input);
  if (m) return { recurrence: { kind: 'weekly', days: [1, 2, 3, 4, 5] }, rest: cut(input, m) };
  m = new RegExp(`${B}(?:every\\s+weekend|on\\s+weekends)${E}`, 'iu').exec(input);
  if (m) return { recurrence: { kind: 'weekly', days: [6, 7] }, rest: cut(input, m) };
  m = new RegExp(`${B}(?:every\\s+(?:day|morning|evening|night)|daily)${E}`, 'iu').exec(input);
  if (m) return { recurrence: { kind: 'daily' }, rest: cut(input, m) };
  return null;
}

function weekdays(list: string): number[] {
  return [...new Set([...list.toLowerCase().matchAll(new RegExp(WD_RE, 'g'))].map((m) => { const n = WD[m[0].replace(/s$/, '')] ?? WD[m[0]]!; return n === 0 ? 7 : n; }))].sort((a, b) => a - b);
}

// ---------- Relative Zeit: "in 2 hours" ----------

const RELATIVE_RE = new RegExp(`${B}in\\s+(\\d+(?:[.,]\\d+)?|a|an|one|two|three|half\\s+an?|an?\\s+half)\\s*(min|mins|minutes?|hrs?|hours?|h)${E}`, 'iu');

function relative(text: string, today: Ymd, now: string): { due: Ymd; time: string; rest: string } | null {
  const m = RELATIVE_RE.exec(text);
  if (!m) return null;
  const key = m[1]!.toLowerCase().replace(/\s+/g, ' ');
  const n = key.startsWith('half') || key.endsWith('half') ? 0.5 : WORD_NUM[key] ?? Number(key.replace(',', '.'));
  const minutes = /^(hrs?|hours?|h)$/iu.test(m[2]!) ? n * 60 : n;
  const [h, mi] = now.split(':').map(Number);
  const total = (h ?? 0) * 60 + (mi ?? 0) + Math.round(minutes);
  const due = addDays(today, Math.floor(total / 1440));
  const t = total % 1440;
  return { due, time: `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`, rest: cut(text, m) };
}

// ---------- Einträge ----------

const STOP = new Set(['the', 'a', 'an', 'my', 'our', 'please', 'for', 'to', 'on', 'of', 'in', 'at', 'is', 'are', 'it', 'that', 'this', 'with', 'about', 'and']);

function itemQuery(raw: string): ItemQuery {
  let subject: string | null = null;
  let kind: ItemKind | null = null;
  const words: string[] = [];
  for (const w of raw.toLowerCase().split(/[\s,.!?:;-]+/u).filter(Boolean)) {
    const k = vocabulary().kindsEn.find(([, , ws]) => ws.includes(w));
    const s = vocabulary().subjects.find(([, ws]) => ws.includes(w));
    if (k && !kind) { kind = k[0]; continue; }
    if (s && !subject) { subject = s[0]; continue; }
    if (!STOP.has(w) && w.length > 1 && !/^\d+$/.test(w)) words.push(w);
  }
  return { subject, kind, words };
}

function parseEntry(input: string, today: Ymd): ParsedEntry | null {
  const ctx: Ctx = { text: ` ${input.trim()} `, today };
  const pageM = take(ctx, `${B}(?:pages?|p\\.?)\\s*(\\d+)(?:\\s*(?:-|–|to)\\s*(\\d+))?${E}`);
  const page = pageM ? (pageM[2] ? `${pageM[1]}–${pageM[2]}` : pageM[1]!) : null;
  const exM = take(ctx, `${B}(?:no\\.?|number|nr\\.?|ex\\.?|exercises?|problems?|questions?|q\\.?|tasks?)\\s*(\\d+[a-z]?(?:\\s*(?:,|\\+|&|/|-|–|and|to)\\s*\\d+[a-z]?)*)${E}`);
  const exercises = exM ? exM[1]!.replace(/\s*(?:-|–|to)\s*/giu, '–').replace(/\s*(?:,|\+|&|\/|and)\s*/giu, ', ').trim() : null;
  const time = takeTime(ctx);
  let due = takeDate(ctx);

  let subject: string | null = null;
  let kind: ItemKind | null = null;
  let kindLabel = '';
  const rest: string[] = [];
  for (const raw of ctx.text.split(/\s+/).filter(Boolean)) {
    const word = raw.toLowerCase().replace(/[.,:;!?]+$/u, '');
    const k = vocabulary().kindsEn.find(([, , ws]) => ws.includes(word));
    const s = vocabulary().subjects.find(([, ws]) => ws.includes(word));
    if (k && !kind) { kind = k[0]; kindLabel = k[1]; continue; }
    if (s && !subject) { subject = s[0]; continue; }
    if (STOP.has(word) && !rest.length) continue;
    rest.push(raw);
  }
  if (!kind && vocabulary().homework && (page || exercises) && (subject || due)) { kind = 'homework'; kindLabel = 'Homework'; }
  if (!kind) return null;
  if (!subject && !page && !exercises && !due) return null;

  let dueAssumed = false;
  if (!due && kind === 'homework') { due = nextSchoolDay(today); dueAssumed = true; }
  const shown = subject ? (vocabulary().subjectNamesEn[subject] ?? subject) : null;
  const restText = rest.join(' ').trim();
  return {
    kind, kindLabel, subject: shown, page, exercises, book: null, due, dueAssumed, time, rest: restText,
    title: [shown, kindLabel].filter(Boolean).join(' '),
    detail: [page && `p. ${page}`, exercises && `no. ${exercises}`, restText].filter(Boolean).join(' '),
  };
}

// ---------- Einkaufsliste ----------

const UNIT = '(?:x|l|liters?|litres?|kg|kilos?|g|grams?|ml|packs?|packages?|bottles?|cans?|bags?|boxes|box|bunch(?:es)?|loaf|loaves|dozen)';
const ARTICLES = /^(the|a|an|some|more|another|please)\s+/iu;
const WORD_QTY: Record<string, string> = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', ten: '10', dozen: '12' };

function splitListItems(raw: string): { text: string; qty: string | null }[] {
  const out: { text: string; qty: string | null }[] = [];
  for (let part of raw.replace(/[.!?]+$/u, '').split(/\s*(?:,|;|&|\band\b|\bplus\b)\s*/iu)) {
    part = part.trim();
    while (ARTICLES.test(part)) part = part.replace(ARTICLES, '');
    if (!part) continue;
    let qty: string | null = null;
    const num = new RegExp(`^(\\d+(?:[.,]\\d+)?|${Object.keys(WORD_QTY).join('|')})\\s*(${UNIT}\\b\\.?)?\\s+(?:of\\s+)?(.+)$`, 'iu').exec(part);
    if (num && (num[2] || /^\d/.test(num[1]!))) {
      qty = `${WORD_QTY[num[1]!.toLowerCase()] ?? num[1]}${num[2] ? ` ${num[2].replace(/\.$/u, '')}` : ''}`;
      part = num[3]!.replace(ARTICLES, '');
    }
    if (part.length >= 2 && part.length <= 60) out.push({ text: capitalize(part), qty });
  }
  return out.slice(0, 20);
}

const NOT_SHOPPING = /^(help|time|peace|rest|holiday|vacation|break|patience|courage|luck|clue|nerves|sleep|support|answers?|info|ideas?|plan|motivation)\b/iu;
const LIST_ADD_RE = /^(?:please\s+)?(?:add|put|write|stick|throw)\s+(.+?)\s+(?:to|on|onto|in|into)\s+(?:the|my|our)\s+(?:shopping\s+|grocery\s+)?(?:list|cart)\b/iu;
const LIST_ADD2_RE = /^(?:shopping\s+list|grocery\s+list|list)\s*[:,-]\s*(.+)$/iu;
const LIST_NEED_RE = /^(?:we|i)\s+(?:need|are\s+out\s+of|ran\s+out\s+of|have\s+no|don'?t\s+have\s+any|still\s+need)\s+(.+)$/iu;
const LIST_SHOW_RE = /^\W*(?:what'?s\s+(?:still\s+)?(?:on|in)\s+(?:the|my|our)\s+(?:shopping\s+|grocery\s+)?list|(?:show|give)\s+(?:me\s+)?(?:the|my|our)\s+(?:shopping\s+|grocery\s+)?list|(?:my\s+|our\s+|the\s+)?(?:shopping|grocery)\s+list\s*\??|what\s+(?:do\s+)?(?:i|we)\s+(?:still\s+)?need\s+to\s+buy)\s*[?!.]*\s*$/iu;
const LIST_ALL_DONE_RE = /^\W*(?:(?:i\s+)?(?:got|bought|picked\s+up)\s+(?:everything|all\s+of\s+it|it\s+all)|shopping\s+(?:is\s+)?done|done\s+shopping|all\s+(?:bought|shopped))\s*[.!]*\s*$/iu;
const LIST_DONE_RE = /^(?:(?:i\s+)?(?:got|bought|picked\s+up)\s+(?:the\s+)?(.+?)|(.+?)\s+(?:is|are)\s+(?:bought|done|checked\s+off|sorted))\s*[.!]*\s*$/iu;
const ERRAND_VERB = '(?:buy|get|pick\\s+up|grab|bring|collect|purchase)';
const ERRAND_CUE = '(after\\s+work|after\\s+school|on\\s+my\\s+way\\s+home|tonight|this\\s+evening)';
const ERRAND_PRE_RE = new RegExp(`^(?:i\\s+(?:need|have|want|must|should)\\s+to\\s+)?${ERRAND_CUE}[,:]?\\s*(?:i\\s+(?:need|have|want|must|should)\\s+to\\s+)?(.*\\b${ERRAND_VERB}\\b.*)$`, 'iu');
const ERRAND_POST_RE = new RegExp(`^(?:i\\s+(?:need|have|want|must|should)\\s+to\\s+)?(.*\\b${ERRAND_VERB}\\b.*?)\\s+${ERRAND_CUE}\\s*[.!]*\\s*$`, 'iu');

function errandWhen(cue: string): 'after_work' | 'after_school' | 'evening' {
  const c = cue.toLowerCase();
  return /school/u.test(c) ? 'after_school' : /evening|tonight/u.test(c) ? 'evening' : 'after_work';
}

function listIntent(text: string): Intent | null {
  if (text.split(/\s+/).length > 20) return null;
  let m = ERRAND_PRE_RE.exec(text);
  if (m) {
    const task = m[2]!.replace(/\s+/g, ' ').replace(/[.!]+$/u, '').trim();
    return { type: 'errand', text: capitalize(task), place: placeFor(task), when: errandWhen(m[1]!) };
  }
  m = ERRAND_POST_RE.exec(text);
  if (m) return { type: 'errand', text: capitalize(m[1]!.trim()), place: placeFor(m[1]!), when: errandWhen(m[2]!) };
  if (LIST_SHOW_RE.test(text)) return { type: 'list_show' };
  m = LIST_ADD_RE.exec(text) ?? LIST_ADD2_RE.exec(text);
  if (m) { const items = splitListItems(m[1]!); if (items.length) return { type: 'list_add', items }; }
  m = LIST_NEED_RE.exec(text);
  if (m && !NOT_SHOPPING.test(m[1]!.trim())) { const items = splitListItems(m[1]!); if (items.length) return { type: 'list_add', items }; }
  if (LIST_ALL_DONE_RE.test(text)) return { type: 'list_done', items: 'all' };
  m = LIST_DONE_RE.exec(text);
  const words = text.toLowerCase().split(/\s+/).map((w) => w.replace(/[.,!?]+$/u, ''));
  const schoolish = vocabulary().subjects.some(([, ws]) => words.some((w) => ws.includes(w))) || vocabulary().kindsEn.some(([, , ws]) => words.some((w) => ws.includes(w)));
  const what = (m?.[1] ?? m?.[2] ?? '').trim();
  if (m && what && !schoolish && what.split(/\s+/).length <= 6 && !/^(it|that|this|everything|all|homework|the homework)$/iu.test(what)) {
    const items = splitListItems(what).map((i) => i.text);
    if (items.length) return { type: 'list_done', items };
  }
  return null;
}

// ---------- Hauptfunktion ----------

const REMEMBER_RE = /^\s*(?:please\s+)?remember\s+(?:that\s+|:\s*)?(.+)$/iu;
const FORGET_RE = /^\s*(?:please\s+)?forget\s+(?:that\s+|about\s+|:\s*)?(.+)$/iu;
const REMIND_RE = /^\s*(?:please\s+)?remind\s+me\s*(.*)$/iu;
const DONE_RE = new RegExp(`${B}(done|finished|completed|did|handed\\s+in|submitted)${E}`, 'iu');
const AGENDA_RE = /^\s*(?:what'?s\s+(?:up|on|next|coming\s+up|due|happening)|what\s+(?:do\s+i|have\s+i\s+got|am\s+i\s+supposed\s+to)\s+(?:have|do)?|agenda|my\s+(?:schedule|agenda|tasks|homework|tests|appointments)|schedule|appointments)(?:\s+(?:today|tomorrow|this\s+week|next\s+week|now|soon))*\s*[?!.]?\s*$/iu;
const DELETE_RE = /^\s*(?:please\s+)?(?:delete|remove|cancel|scrap|drop|get\s+rid\s+of)\s+(.+)$/iu;
const DELETE2_RE = /^\s*(.+?)\s+(?:got\s+|is\s+|was\s+)?cancell?ed\s*[.!]*\s*$/iu;
const MOVE_RE = /^\s*(?:please\s+)?(?:move|reschedule|postpone|push|shift)\s+(.+?)\s+(?:to|until|till|for|by|back\s+to)\s+(.+)$/iu;
const CORRECT_RE = /^\s*(?:no|nope|sorry|actually|i\s+meant|make\s+it|rather|wait)[\s,!.:]+(?:i\s+meant\s+|make\s+it\s+|rather\s+)?(.+?)\s*[!.]?$/iu;

/** Schnelle, KI-freie Erkennung der häufigsten englischen Befehle. `null` → an die KI weitergeben. */
export function interpretEn(input: string, today: Ymd, now = '12:00'): Intent | null {
  const text = input.trim();
  if (!text) return null;

  let m = REMEMBER_RE.exec(text);
  if (m && m[1]!.trim().length > 2) return { type: 'remember', text: capitalize(m[1]!.trim().replace(/[.!]+$/u, '')) };
  m = FORGET_RE.exec(text);
  if (m && m[1]!.trim().length > 2 && !/^(it|that)\s*[.!]?$/iu.test(m[1]!.trim())) return { type: 'forget', text: m[1]!.trim().replace(/[.!]+$/u, '') };

  const listed = listIntent(text);
  if (listed) return listed;

  // Erinnerungen und Daueraufträge
  m = REMIND_RE.exec(text);
  const body = m ? m[1]! : text;
  const rec = takeRecurrence(body);
  if (rec && (m || /\d/.test(rec.rest))) {
    const when = parseWhen(rec.rest, today);
    if (m || when.time) {
      const what = cleanWhat(when.rest);
      if (what.length >= 2) return { type: 'recurring', recurrence: formatRecurrence(rec.recurrence), time: when.time, text: capitalize(what) };
    }
  }
  const rel = relative(body, today, now);
  if (m || (rel && /^\s*in\s/iu.test(text))) {
    let due: Ymd | null = null; let time: string | null = null; let rest = body;
    if (rel) ({ due, time, rest } = rel); else ({ due, time, rest } = parseWhen(body, today));
    if (time) {
      due ??= time > now ? today : addDays(today, 1);
      const what = cleanWhat(rest);
      if (what) return { type: 'remind', due, time, text: capitalize(what) };
    }
  }

  // verschieben / löschen vor "create"
  if (text.split(/\s+/).length <= 12) {
    m = MOVE_RE.exec(text);
    if (m) {
      const when = parseWhen(m[2]!, today);
      const query = itemQuery(m[1]!);
      if ((when.due || when.time) && (query.subject || query.kind || query.words.length)) return { type: 'move', query, due: when.due, time: when.time };
    }
    m = DELETE_RE.exec(text) ?? DELETE2_RE.exec(text);
    if (m) {
      const query = itemQuery(m[1]!);
      if (query.subject || query.kind || query.words.length) return { type: 'delete', query };
    }
  }

  if (DONE_RE.test(text) && text.split(/\s+/).length <= 7) {
    const query = itemQuery(text);
    if (query.subject || query.kind) return { type: 'done', subject: query.subject, kind: query.kind };
  }

  if (AGENDA_RE.test(text)) return { type: 'agenda', days: /week/iu.test(text) ? 7 : 14 };

  // Korrektur: "no, thursday" / "make it 5pm"
  if (text.split(/\s+/).length <= 6) {
    const c = CORRECT_RE.exec(text);
    if (c) {
      const when = parseWhen(c[1]!, today);
      if ((when.due || when.time) && !when.rest.replace(/[\s,.!]/gu, '')) return { type: 'correct', due: when.due, time: when.time };
    }
  }

  if (text.split(/\s+/).length > 14) return null;
  if (/\?\s*$/.test(text)) return null;
  const entry = parseEntry(text, today);
  if (entry) return { type: 'create', entry };

  // "friday 3pm hairdresser", "tomorrow 5pm dentist"
  const when = parseWhen(text, today);
  const title = when.rest.replace(/^(on|at|is|i have|i've got|i got)\s+/iu, '').replace(/[.!]+$/u, '').trim();
  const words = title.split(/\s+/).filter(Boolean);
  if ((when.due || when.time) && words.length >= 1 && words.length <= 6 && !/^(and|or|but|because|if|what|how|who|when|why|can|could|do|does|will)$/iu.test(words[0]!)) {
    const due = when.due ?? (when.time && when.time <= now ? addDays(today, 1) : today);
    const kind: ItemKind = when.time ? 'event' : 'todo';
    return {
      type: 'create',
      entry: { kind, kindLabel: kind === 'event' ? 'Appointment' : 'To-do', subject: null, page: null, exercises: null, book: null,
        due, dueAssumed: false, time: when.time, rest: '', title: capitalize(title), detail: '' },
    };
  }
  return null;
}

function cleanWhat(rest: string): string {
  return rest.replace(/^\s*(to|about|that|and|of|for|please)\s+/iu, '').replace(/^\s*(to|about|that)\s+/iu, '').replace(/\s+(?:to|about)\s*$/iu, '').replace(/[.!?,]+$/u, '').trim();
}
