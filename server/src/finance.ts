// Ausgaben: Ein Apple-Kurzbefehl (Wallet-Automation „Transaktion“) meldet jede Zahlung an Stella.
// Gespeichert werden nur Betrag, Händler und Kartenname – nie Kartennummern.
//
//   Kategorie:  1. eigene Zuordnung des Händlers (merchant_categories, auch von Groq gelernt)
//               2. feste Regeln für bekannte Händler
//               3. Groq, einmal pro neuem Händler (wird gemerkt), sonst „Sonstiges“
//   Doppelte Meldungen (gleicher Betrag + Händler innerhalb von 2 Minuten) werden verworfen.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  addDays, FINANCE_CATEGORIES, formatDateDe, todayIn, weekdayOf,
  type BudgetStatus, type FinanceCategory, type FinanceMonth, type MessageCard, type Subscription, type Transaction,
} from '@stella/shared';
import { HttpError } from './auth.ts';
import { db, newId, now, type User } from './db.ts';
import { complete, groqAvailable, llmAvailable } from './llm.ts';

const DUPLICATE_WINDOW_MS = 2 * 60_000;
const MAX_CENTS = 100_000_000; // 1 Mio. – alles darüber ist ein Tippfehler im Kurzbefehl

export const isCategory = (v: unknown): v is FinanceCategory => typeof v === 'string' && (FINANCE_CATEGORIES as readonly string[]).includes(v);

// ---------- Eingaben lesen ----------

const SYMBOLS: [RegExp, string][] = [[/€|eur/i, 'EUR'], [/\$|usd/i, 'USD'], [/£|gbp/i, 'GBP'], [/chf|fr\./i, 'CHF']];

/** „12,50 €“, „€12.50“, „1.234,56“, „-3,20“ → Cent. Das Vorzeichen zählt nicht (Ausgabe bleibt Ausgabe). */
export function parseAmount(raw: unknown): { cents: number; currency: string | null } | null {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw !== 0 && Math.abs(raw) * 100 <= MAX_CENTS ? { cents: Math.round(Math.abs(raw) * 100), currency: null } : null;
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const currency = SYMBOLS.find(([re]) => re.test(text))?.[1] ?? null;
  const digits = text.replace(/[^\d.,]/g, '');
  if (!/\d/.test(digits)) return null;
  const lastComma = digits.lastIndexOf(',');
  const lastDot = digits.lastIndexOf('.');
  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    // beide Zeichen vorhanden: das hintere trennt die Cent ab, das andere gruppiert die Tausender
    const dec = Math.max(lastComma, lastDot);
    normalized = `${digits.slice(0, dec).replace(/[.,]/g, '')}.${digits.slice(dec + 1)}`;
  } else if (lastComma >= 0 || lastDot >= 0) {
    const parts = digits.split(lastComma >= 0 ? ',' : '.');
    if (parts.length > 2) normalized = parts.join(''); // 1.234.567
    else if (parts[1]!.length === 3 && parts[0]!.length >= 1 && parts[0]!.length <= 3 && parts[0] !== '0') normalized = parts.join(''); // 1.234 = tausendzweihundertvierunddreißig
    else normalized = `${parts[0] || '0'}.${parts[1]}`;
  } else {
    normalized = digits;
  }
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0 || value * 100 > MAX_CENTS) return null;
  return { cents: Math.round(value * 100), currency };
}

const cleanText = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** Orte, die Ketten an den Händlernamen hängen („BILLA 1234 WIEN“) */
const PLACE_WORDS = new Set(['wien', 'graz', 'linz', 'salzburg', 'innsbruck', 'klagenfurt', 'villach', 'wels', 'austria', 'österreich', 'at', 'aut']);

/** Händler ohne Filialnummern und Orte – so wird er wiedererkannt („BILLA 1234 WIEN“ = „Billa“) */
export const merchantKey = (merchant: string) =>
  merchant.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter((w) => w && !/^\d+$/.test(w) && !PLACE_WORDS.has(w)).join(' ').slice(0, 60);

/** Kartenname ohne Nummern: „Visa 1234 5678“ → „Visa“ */
export const cleanCard = (v: unknown) => cleanText(v, 60).replace(/[*•·x]*\s*\d[\d\s-]{2,}\d/gi, '').replace(/\s+/g, ' ').trim().slice(0, 40) || null;

function localDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

// ---------- Kategorien ----------

interface Rule { category: FinanceCategory; words: string[]; prefixes?: string[] }

/** bekannte Händler und Stichwörter; `words` müssen als ganzes Wort (oder ganze Wortfolge) vorkommen, `prefixes` am Wortanfang */
const RULES: Rule[] = [
  { category: 'Abos', words: ['netflix', 'spotify', 'disney', 'dazn', 'audible', 'icloud', 'apple com bill', 'apple music', 'youtube premium', 'prime video', 'amazon prime', 'paramount', 'crunchyroll', 'chatgpt', 'openai', 'adobe', 'dropbox', 'microsoft 365', 'abo'] },
  { category: 'Lebensmittel', words: ['billa', 'spar', 'interspar', 'eurospar', 'hofer', 'lidl', 'penny', 'merkur', 'aldi', 'rewe', 'edeka', 'migros', 'coop', 'denner', 'unimarkt', 'nah und frisch', 'adeg', 'metro', 'supermarkt'] },
  { category: 'Essen & Trinken', words: ['mcdonalds', 'mcdonald s', 'burger king', 'starbucks', 'subway', 'kfc', 'café', 'cafe', 'kaffee', 'restaurant', 'pizza', 'kebab', 'döner', 'doener', 'sushi', 'ankerbrot', 'felber', 'lieferando', 'wolt', 'mjam', 'foodora', 'bar', 'bistro', 'gasthaus', 'imbiss', 'eis', 'vapiano', 'dunkin', 'nordsee', 'yippie', 'trinken', 'essen'], prefixes: ['bäcker', 'baecker', 'pizz', 'restaurant', 'gasthof', 'konditorei', 'eisdiele'] },
  { category: 'Transport', words: ['öbb', 'oebb', 'wiener linien', 'westbahn', 'uber', 'bolt', 'flixbus', 'taxi', 'omv', 'shell', 'bp', 'eni', 'avanti', 'jet', 'tankstelle', 'lime', 'tier', 'voi', 'bahn', 'parken', 'asfinag', 'bus', 'tram', 'ubahn', 'ryanair', 'wizz', 'lufthansa', 'austrian'], prefixes: ['flug', 'parkschein'] },
  { category: 'Gesundheit', words: ['apotheke', 'dm', 'bipa', 'optiker', 'hartlauer', 'krankenhaus', 'physio', 'drogerie', 'sanitas', 'ordination'], prefixes: ['zahn', 'ärzt', 'aerzt', 'arzt', 'apothek'] },
  { category: 'Freizeit', words: ['kino', 'cinema', 'cineplex', 'steam', 'playstation', 'xbox', 'nintendo', 'therme', 'fitness', 'clever fit', 'mcfit', 'john harris', 'theater', 'konzert', 'ticket', 'oeticket', 'eventim', 'bowling', 'freibad', 'museum', 'twitch', 'zoo', 'club', 'sport'], prefixes: ['spiel', 'game', 'fitness', 'konzert'] },
  { category: 'Shopping', words: ['amazon', 'zalando', 'h m', 'hm', 'zara', 'ikea', 'mediamarkt', 'media markt', 'saturn', 'about you', 'shein', 'temu', 'primark', 'c a', 'deichmann', 'snipes', 'footlocker', 'otto', 'ebay', 'willhaben', 'apple store', 'libro', 'thalia', 'müller', 'mueller', 'tk maxx', 'action', 'tedi', 'kik', 'obi', 'bauhaus', 'hornbach'] },
];

const RULES_COMPILED = RULES.map((r) => ({ category: r.category, words: r.words.map((w) => ` ${merchantKey(w)} `), prefixes: (r.prefixes ?? []).map((p) => p.toLowerCase()) }));

/** feste Regeln für bekannte Händler – null, wenn keine passt */
export function ruleCategory(merchant: string): FinanceCategory | null {
  const key = merchantKey(merchant);
  const padded = ` ${key} `;
  const tokens = key.split(' ');
  for (const r of RULES_COMPILED) {
    if (r.words.some((w) => padded.includes(w)) || r.prefixes.some((p) => tokens.some((t) => t.startsWith(p)))) return r.category;
  }
  return null;
}

const storedCategory = (userId: string, key: string) =>
  (db.prepare('SELECT category FROM merchant_categories WHERE user_id = ? AND merchant = ?').get(userId, key) as { category: string } | undefined)?.category as FinanceCategory | undefined;

export function rememberMerchant(userId: string, key: string, category: FinanceCategory, source: 'user' | 'groq') {
  db.prepare(`INSERT INTO merchant_categories (user_id, merchant, category, source) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, merchant) DO UPDATE SET category = excluded.category, source = excluded.source`).run(userId, key, category, source);
}

/** Groq schätzt die Kategorie eines neuen Händlers (einmal, danach steht sie in der Datenbank) */
async function askGroq(user: User, merchant: string): Promise<FinanceCategory | null> {
  if (!groqAvailable() && !llmAvailable()) return null;
  try {
    const { message } = await complete([
      { role: 'system', content: 'Du ordnest Kartenzahlungen einer Ausgaben-Kategorie zu. Antworte nur mit JSON.' },
      { role: 'user', content: `Händler: „${merchant}“\nKategorien: ${FINANCE_CATEGORIES.join(', ')}\nFormat: {"category": "…"} – wenn unklar „Sonstiges“.` },
    ], undefined, { json: true, provider: 'groq', task: 'classify', userId: user.id, timeoutMs: 8_000 });
    const t = message.content ?? '';
    const category = (JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)) as { category?: unknown }).category;
    return isCategory(category) ? category : null;
  } catch {
    return null;
  }
}

export async function categorize(user: User, merchant: string): Promise<FinanceCategory> {
  const key = merchantKey(merchant);
  const own = storedCategory(user.id, key);
  if (own) return own;
  const rule = ruleCategory(merchant);
  if (rule) return rule;
  const guess = await askGroq(user, merchant);
  if (guess) { rememberMerchant(user.id, key, guess, 'groq'); return guess; }
  return 'Sonstiges';
}

// ---------- Buchungen speichern ----------

type TxRow = { id: string; amount_cents: number; currency: string; merchant: string; category: string; card_label: string | null; occurred_at: string; day: string; source: string };
const toTx = (r: TxRow): Transaction => ({
  id: r.id, amountCents: r.amount_cents, currency: r.currency, merchant: r.merchant, category: isCategory(r.category) ? r.category : 'Sonstiges',
  cardLabel: r.card_label, occurredAt: r.occurred_at, day: r.day, source: r.source,
});

export interface PaymentResult { ok: true; duplicate: boolean; id?: string; category?: FinanceCategory; amountCents?: number; merchant?: string }

/** Eine Zahlung aus dem Kurzbefehl: `{ amount, currency, merchant, card, date }` */
export async function recordPayment(user: User, body: unknown, source = 'applepay'): Promise<PaymentResult> {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const amount = parseAmount(b.amount);
  if (!amount) throw new HttpError(400, 'Der Betrag fehlt oder ist keine Zahl.');
  const merchant = cleanText(b.merchant, 80);
  if (!merchant) throw new HttpError(400, 'Der Händler fehlt.');
  const currency = (/^[A-Za-z]{3}$/.test(String(b.currency ?? '').trim()) ? String(b.currency).trim().toUpperCase() : amount.currency) ?? 'EUR';

  const parsed = typeof b.date === 'string' && b.date.trim() ? Date.parse(b.date) : NaN;
  const at = Number.isFinite(parsed) && parsed <= Date.now() + 86_400_000 ? new Date(parsed) : new Date();
  const occurredAt = at.toISOString();
  const key = merchantKey(merchant);

  // dieselbe Zahlung doppelt gemeldet (Wallet meldet manchmal zweimal)
  const near = db.prepare(`SELECT id FROM transactions WHERE user_id = ? AND merchant_key = ? AND amount_cents = ? AND currency = ?
    AND occurred_at >= ? AND occurred_at <= ? LIMIT 1`)
    .get(user.id, key, amount.cents, currency, new Date(at.getTime() - DUPLICATE_WINDOW_MS).toISOString(), new Date(at.getTime() + DUPLICATE_WINDOW_MS).toISOString()) as { id: string } | undefined;
  if (near) return { ok: true, duplicate: true, id: near.id };

  const category = await categorize(user, merchant);
  const id = newId();
  db.prepare(`INSERT INTO transactions (id, user_id, amount_cents, currency, merchant, merchant_key, category, card_label, occurred_at, day, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, user.id, amount.cents, currency, merchant, key, category, cleanCard(b.card), occurredAt, localDay(occurredAt, user.timeZone), source, now());
  return { ok: true, duplicate: false, id, category, amountCents: amount.cents, merchant };
}

export function getTransaction(userId: string, id: string): Transaction | null {
  const r = db.prepare('SELECT * FROM transactions WHERE user_id = ? AND id = ?').get(userId, id) as TxRow | undefined;
  return r ? toTx(r) : null;
}

/** Kategorie ändern – gilt ab jetzt für den ganzen Händler, auch für die früheren Buchungen */
export function recategorize(userId: string, id: string, category: FinanceCategory): Transaction | null {
  const r = db.prepare('SELECT merchant_key FROM transactions WHERE user_id = ? AND id = ?').get(userId, id) as { merchant_key: string } | undefined;
  if (!r) return null;
  rememberMerchant(userId, r.merchant_key, category, 'user');
  db.prepare('UPDATE transactions SET category = ? WHERE user_id = ? AND merchant_key = ?').run(category, userId, r.merchant_key);
  return getTransaction(userId, id);
}

export const deleteTransaction = (userId: string, id: string) =>
  db.prepare('DELETE FROM transactions WHERE user_id = ? AND id = ?').run(userId, id).changes > 0;

// ---------- Auswertung ----------

const pad = (n: number) => String(n).padStart(2, '0');
export const monthOf = (day: string) => day.slice(0, 7);
const monthStart = (month: string) => `${month}-01`;
const monthEnd = (month: string) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${month}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
};
const prevMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
};

interface Range { from: string; to: string }

function dominantCurrency(userId: string, r: Range): string {
  const row = db.prepare(`SELECT currency, COUNT(*) AS n FROM transactions WHERE user_id = ? AND day >= ? AND day <= ? GROUP BY currency ORDER BY n DESC LIMIT 1`)
    .get(userId, r.from, r.to) as { currency: string } | undefined;
  return row?.currency ?? 'EUR';
}

export function sumByCategory(userId: string, r: Range, currency = dominantCurrency(userId, r)) {
  const rows = db.prepare(`SELECT category, SUM(amount_cents) AS cents, COUNT(*) AS n FROM transactions WHERE user_id = ? AND day >= ? AND day <= ? AND currency = ?
    GROUP BY category ORDER BY cents DESC`).all(userId, r.from, r.to, currency) as { category: string; cents: number; n: number }[];
  return {
    currency,
    categories: rows.map((x) => ({ category: (isCategory(x.category) ? x.category : 'Sonstiges') as FinanceCategory, cents: x.cents, count: x.n })),
    totalCents: rows.reduce((a, x) => a + x.cents, 0),
    count: rows.reduce((a, x) => a + x.n, 0),
  };
}

/** Wöchentliche, monatliche oder frei gewählte Summe – für Chat und Karte */
export function spendingCard(user: User, r: Range, label: string): MessageCard & { type: 'spending' } {
  const s = sumByCategory(user.id, r);
  return { type: 'spending', label, from: r.from, to: r.to, currency: s.currency, totalCents: s.totalCents, count: s.count, categories: s.categories.map(({ category, cents }) => ({ category, cents })) };
}

export function budgetStatus(user: User, month: string): BudgetStatus[] {
  const spent = new Map(sumByCategory(user.id, { from: monthStart(month), to: monthEnd(month) }).categories.map((c) => [c.category, c.cents]));
  return (db.prepare('SELECT category, amount_cents FROM budgets WHERE user_id = ? ORDER BY category').all(user.id) as { category: string; amount_cents: number }[])
    .filter((b) => isCategory(b.category))
    .map((b) => ({ category: b.category as FinanceCategory, limitCents: b.amount_cents, spentCents: spent.get(b.category as FinanceCategory) ?? 0 }));
}

export function setBudget(userId: string, category: FinanceCategory, cents: number | null) {
  if (cents === null || cents <= 0) db.prepare('DELETE FROM budgets WHERE user_id = ? AND category = ?').run(userId, category);
  else db.prepare(`INSERT INTO budgets (user_id, category, amount_cents) VALUES (?, ?, ?)
    ON CONFLICT(user_id, category) DO UPDATE SET amount_cents = excluded.amount_cents`).run(userId, category, Math.min(Math.round(cents), MAX_CENTS));
}

const dayNumber = (day: string) => Math.round(Date.parse(day) / 86_400_000);

/** Gleicher Händler, gleicher Betrag, im Abstand von etwa einem Monat (26–35 Tage) → Abo */
export function subscriptions(user: User, today = todayIn(user.timeZone)): Subscription[] {
  const rows = db.prepare(`SELECT merchant, merchant_key, amount_cents, currency, day FROM transactions WHERE user_id = ? AND day >= ? ORDER BY day`)
    .all(user.id, addDays(today, -400)) as { merchant: string; merchant_key: string; amount_cents: number; currency: string; day: string }[];
  const groups = new Map<string, typeof rows>();
  for (const r of rows) groups.set(`${r.merchant_key}|${r.amount_cents}|${r.currency}`, [...(groups.get(`${r.merchant_key}|${r.amount_cents}|${r.currency}`) ?? []), r]);
  const out: Subscription[] = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const gaps = g.slice(1).map((x, i) => dayNumber(x.day) - dayNumber(g[i]!.day));
    if (!gaps.some((d) => d >= 26 && d <= 35)) continue;
    const last = g.at(-1)!;
    // die letzte Abbuchung darf nicht länger als zwei Monate her sein, sonst ist das Abo vermutlich beendet
    if (dayNumber(today) - dayNumber(last.day) > 66) continue;
    const monthly = gaps.filter((d) => d >= 26 && d <= 35);
    const avg = Math.round(monthly.reduce((a, d) => a + d, 0) / monthly.length);
    out.push({ merchant: last.merchant, amountCents: last.amount_cents, currency: last.currency, lastDay: last.day, nextDay: addDays(last.day, avg), count: g.length });
  }
  return out.sort((a, b) => a.nextDay.localeCompare(b.nextDay));
}

export function monthOverview(user: User, month: string): FinanceMonth {
  const range = { from: monthStart(month), to: monthEnd(month) };
  const s = sumByCategory(user.id, range);
  const all = (db.prepare('SELECT * FROM transactions WHERE user_id = ? AND day >= ? AND day <= ? ORDER BY occurred_at DESC LIMIT 300').all(user.id, range.from, range.to) as TxRow[]).map(toTx);
  const previous = sumByCategory(user.id, { from: monthStart(prevMonth(month)), to: monthEnd(prevMonth(month)) }, s.currency);
  return {
    month, currency: s.currency, totalCents: s.totalCents, previousTotalCents: previous.totalCents, count: s.count,
    otherCurrency: all.filter((t) => t.currency !== s.currency).length,
    categories: s.categories, budgets: budgetStatus(user, month), transactions: all, subscriptions: subscriptions(user),
  };
}

// ---------- Chat: „Wie viel hab ich diese Woche ausgegeben?“ ----------

export const SPEND_RE = /\b(wie\s*viel|wieviel)\b[^?.!]*\b(ausgegeben|ausgeben|bezahlt|gezahlt|verbraucht|verprasst)\b|\b(meine\s+)?ausgaben\b|\bwas\s+hab(e)?\s+ich\s+[^?.!]*ausgegeben\b/iu;

/** Zeitraum aus dem Satz; ohne Angabe: dieser Monat */
export function spendingPeriod(text: string, today: string): { from: string; to: string; label: string } {
  const monday = addDays(today, -((weekdayOf(today) + 6) % 7));
  if (/\bheute\b/iu.test(text)) return { from: today, to: today, label: 'Heute' };
  if (/\bgestern\b/iu.test(text)) { const y = addDays(today, -1); return { from: y, to: y, label: 'Gestern' }; }
  if (/\b(letzte|vergangene|vorige)[nr]?\s+woche\b/iu.test(text)) return { from: addDays(monday, -7), to: addDays(monday, -1), label: 'Letzte Woche' };
  if (/\bwoche\b/iu.test(text)) return { from: monday, to: today, label: 'Diese Woche' };
  if (/\b(letzte|vergangene|vorige)[nr]?\s+monat\b/iu.test(text)) {
    const m = prevMonth(monthOf(today));
    return { from: monthStart(m), to: monthEnd(m), label: 'Letzter Monat' };
  }
  return { from: monthStart(monthOf(today)), to: today, label: 'Dieser Monat' };
}

export const euro = (cents: number, currency = 'EUR') => new Intl.NumberFormat('de-AT', { style: 'currency', currency }).format(cents / 100);

/** Kurzfassung für die KI-Werkzeuge */
export function spendingFacts(user: User, from: string, to: string, category?: string) {
  const s = sumByCategory(user.id, { from, to });
  const filter = isCategory(category) ? category : null;
  const rows = db.prepare(`SELECT merchant, SUM(amount_cents) AS cents, COUNT(*) AS n FROM transactions WHERE user_id = ? AND day >= ? AND day <= ? AND currency = ?
    ${filter ? 'AND category = ?' : ''} GROUP BY merchant_key ORDER BY cents DESC LIMIT 8`)
    .all(...[user.id, from, to, s.currency, ...(filter ? [filter] : [])]) as { merchant: string; cents: number; n: number }[];
  return {
    from, to, currency: s.currency,
    total: filter ? euro(s.categories.find((c) => c.category === filter)?.cents ?? 0, s.currency) : euro(s.totalCents, s.currency),
    count: s.count,
    categories: s.categories.map((c) => ({ category: c.category, amount: euro(c.cents, s.currency) })),
    topMerchants: rows.map((r) => ({ merchant: r.merchant, amount: euro(r.cents, s.currency), count: r.n })),
  };
}

export const rangeLabel = (r: Range, today: string) => (r.from === r.to ? formatDateDe(r.from, today) : `${formatDateDe(r.from, today)} – ${formatDateDe(r.to, today)}`);

// ---------- Routen ----------

const parseMonth = (v: unknown, fallback: string) => (typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : fallback);

export function registerFinanceRoutes(api: FastifyInstance) {
  api.get('/api/finance', async (req: FastifyRequest<{ Querystring: { month?: string } }>) =>
    monthOverview(req.user, parseMonth(req.query.month, monthOf(todayIn(req.user.timeZone)))));

  api.patch('/api/finance/transactions/:id', async (req: FastifyRequest<{ Params: { id: string } }>) => {
    const category = (req.body as { category?: unknown } | undefined)?.category;
    if (!isCategory(category)) throw new HttpError(400, 'Unbekannte Kategorie.');
    const tx = recategorize(req.user.id, req.params.id, category);
    if (!tx) throw new HttpError(404, 'Buchung nicht gefunden');
    return { transaction: tx };
  });

  api.delete('/api/finance/transactions/:id', async (req: FastifyRequest<{ Params: { id: string } }>) => {
    if (!deleteTransaction(req.user.id, req.params.id)) throw new HttpError(404, 'Buchung nicht gefunden');
    return { ok: true };
  });

  api.put('/api/finance/budgets/:category', async (req: FastifyRequest<{ Params: { category: string } }>) => {
    const category = decodeURIComponent(req.params.category);
    if (!isCategory(category)) throw new HttpError(400, 'Unbekannte Kategorie.');
    const raw = (req.body as { amount?: unknown } | undefined)?.amount;
    const euros = raw === null || raw === undefined || raw === '' ? 0 : Number(String(raw).replace(',', '.'));
    if (!Number.isFinite(euros) || euros < 0) throw new HttpError(400, 'Das ist kein gültiger Betrag.');
    setBudget(req.user.id, category, Math.round(euros * 100));
    return { budgets: budgetStatus(req.user, monthOf(todayIn(req.user.timeZone))) };
  });

  // Testknopf in der Einrichtung: schickt eine Probebuchung durch denselben Weg wie der Kurzbefehl
  api.post('/api/finance/test', async (req) => {
    const r = await recordPayment(req.user, { amount: '1,00', merchant: 'Testbuchung', card: 'Test' }, 'test');
    return { ...r, message: r.duplicate ? 'Die Probebuchung ist gerade erst angekommen – warte kurz und versuch es nochmal.' : 'Probebuchung ist angekommen.' };
  });
}
