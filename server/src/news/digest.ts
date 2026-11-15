// News für das Morgen-Briefing und die Bildkarten auf „Heute“.
//  · Tagesausgabe, einmal am Tag für alle: 20 internationale Artikel und je 3 für die zehn Länder in LOCAL_EDITIONS –
//    zusammen 50, genau das Gratis-Kontingent von OpenRouter. Pro Artikel EIN KI-Aufruf mit dem Foto: Bildpunkt für
//    den Zuschnitt, Hauptthema und ein neutraler Teasersatz in allen Sprachen von Stella
//  · nur Artikel mit echtem Bild; ohne Bild wird der nächstwichtigste genommen
//  · jede Person bekommt daraus die Meldungen, die sie am ehesten interessieren: Free 1 lokale + 2 internationale,
//    bezahlte Abos 2 lokale + 6 internationale (Themen aus den News-Einstellungen gehen vor)
//  · bei Unglücken, Krieg und Tod immer sachlich, auch bei „frech“

import { LANGUAGE_NAMES_EN, LOCALES, todayIn, type Locale } from '@stella/shared';
import { planOf } from '../billing.ts';
import { config } from '../config.ts';
import { db, updateUserSettings, type User } from '../db.ts';
import { complete, openrouterAvailable, usageToday } from '../llm.ts';
import { userLocale } from '../locale.ts';
import { decodeEntities } from './feed.ts';
import { fetchImage, fetchText } from './net.ts';
import { demoImage, isArticlePhoto } from './image.ts';
import { favoriteId, type NewsRow } from './store.ts';
import { allSources, defaultCountries, isNewsTopic, type NewsCountry, type NewsTopic } from './sources.ts';

export interface NewsSettings {
  enabled: boolean;
  topics: NewsTopic[];
  countries: string[];
  /** feste Auswahl von Quellen (Kennungen); leer = alle Quellen der Länder */
  sources: string[];
  /** Lieblingszeitungen (nur ab Pro) */
  favorites: { name: string; feedUrl: string }[];
  /** gewünschte Anzahl, höchstens die des Abos */
  count?: number;
  /** die Frage am ersten Tag wurde beantwortet */
  asked?: boolean;
  /** wann zuletzt ein Briefing mit News gebaut wurde */
  lastAt?: string;
}

/**
 * `image`: Vorschaubild (https, oder Pfad auf diesem Server für Demo-Bilder) für die Bildkarten auf „Heute“,
 * `focus`: der Bildpunkt, der beim Zuschneiden sichtbar bleiben muss (x, y je 0–1 von links oben; ohne Angabe: Mitte),
 * `topic`: erstes erkanntes Thema für den Farb-Chip
 */
export interface NewsEntry {
  sentence: string; source: string; url: string; publishedAt: string; favorite?: boolean; image?: string;
  focus?: { x: number; y: number }; topic?: NewsTopic;
}

/** og:image / twitter:image aus dem Kopf der Artikelseite */
export function pageImage(html: string): string | undefined {
  const head = html.slice(0, 200_000);
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const t = m[0];
    if (!/(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["']/i.test(t)) continue;
    const u = /\bcontent=["']([^"']+)["']/i.exec(t)?.[1];
    if (u && /^https:\/\//i.test(decodeEntities(u).trim())) return decodeEntities(u).trim();
  }
  return undefined;
}

async function articleImage(url: string): Promise<string | undefined> {
  try {
    const r = await fetchText(url, { strict: true, timeoutMs: 5000 });
    return r.status === 200 ? pageImage(r.body) : undefined;
  } catch { return undefined; }
}

export const DEFAULT_TOPICS: NewsTopic[] = ['politics', 'economy', 'tech', 'science'];

export function newsSettings(user: Pick<User, 'settings'>): NewsSettings {
  const n = (user.settings as { news?: Partial<NewsSettings> }).news ?? {};
  return {
    enabled: !!n.enabled, topics: (n.topics ?? []).filter(isNewsTopic), countries: n.countries ?? [], sources: n.sources ?? [], favorites: n.favorites ?? [],
    ...(n.count ? { count: n.count } : {}), ...(n.asked ? { asked: true } : {}), ...(n.lastAt ? { lastAt: n.lastAt } : {}),
  };
}

/** Standardwerte nach „Ja, gern“ ohne Auswahl (z. B. in Telegram): Themen allgemein, eigenes Land + International */
export const defaultNews = (user: Pick<User, 'settings'>): NewsSettings => ({
  enabled: true, topics: DEFAULT_TOPICS, countries: defaultCountries(user.settings.country), sources: [], favorites: [], asked: true,
});

export const saveNews = (user: User, patch: Partial<NewsSettings>) => {
  updateUserSettings(user.id, { news: { ...newsSettings(user), ...patch } } as never);
};

export const newsCountFor = (user: User, s = newsSettings(user)) => Math.max(1, Math.min(s.count ?? 99, planOf(user).limits.newsCount));

/** Wie viele der Meldungen lokal sind: Free (3) → 1, bezahlte Abos (8) → 2; der Rest ist international */
export const localShare = (count: number) => Math.max(1, Math.round(count / 4));

// ---------- Tagesausgabe: einmal am Tag für alle, 50 Artikel, je einer KI-Anfrage bei OpenRouter ----------
//
// 1. rankedCandidates: die wichtigsten Geschichten (viele Zeitungen berichten, aktuell), ohne die der letzten zwei Ausgaben
// 2. buildEdition: der Reihe nach, gemischte Themen, nur mit echtem Bild, das auch wirklich lädt
// 3. enrich: EIN Aufruf pro Artikel mit dem Foto – Bildpunkt, Thema, ein Satz in allen Sprachen. Schlägt er fehl oder ist
//    das Kontingent leer: Schlagzeile als Satz, Bildmitte als Ausschnitt; mit Restkontingent frühestens 2 Stunden später neu.
// 4. selectNews: jede Person bekommt daraus die Meldungen, die sie am ehesten interessieren.

/** Länder mit eigener Tagesausgabe. Wer ein anderes Land hat, bekommt erstmal nur internationale Artikel. */
export const LOCAL_EDITIONS: NewsCountry[] = ['DE', 'AT', 'CH', 'US', 'GB', 'FR', 'BR', 'PL', 'ES', 'IT'];
export const INT_SIZE = 20;
export const LOCAL_SIZE = 3;
export const EDITION_COUNTRIES: NewsCountry[] = ['INT', ...LOCAL_EDITIONS];
export const editionSize = (country: string) => (country === 'INT' ? INT_SIZE : LOCAL_SIZE);
/** ab dieser Stunde (UTC) wird gebaut – OpenRouter setzt das Tageskontingent um 0 Uhr UTC zurück; dann sind die Feeds der Nacht da */
export const EDITION_HOUR_UTC = Number(process.env.STELLA_NEWS_EDITION_HOUR ?? 3);

/** höchstens so viele Geschichten pro Thema, damit die Ausgabe gemischt ist: bei 20 je 4, Politik bis 6; bei 3 je eine */
export const topicCap = (size: number, topic: string) => (topic === 'politics' ? Math.ceil(size * 0.3) : Math.ceil(size / 5));

interface Candidate { row: NewsRow; topics: NewsTopic[]; favorite: boolean; sources: number }
interface Prepared { url: string; topic: string | null; image: string | null; sentences: string; prepared_at: string; focus: string | null }

const WINDOW_MS = 36 * 3600_000;
const marks = (n: number) => Array.from({ length: n }, () => '?').join(',');
const utcDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Meldungen zu Geschichten bündeln: ein Vertreter je Geschichte, dazu wie viele Zeitungen insgesamt darüber berichten */
function bundle(rows: NewsRow[], favorites: string[] = []): Candidate[] {
  const byCluster = new Map<string, NewsRow[]>();
  for (const row of rows) {
    const list = byCluster.get(row.cluster_id) ?? [];
    list.push(row);
    byCluster.set(row.cluster_id, list);
  }
  const count = db.prepare('SELECT COUNT(DISTINCT source_id) AS n FROM news_items WHERE cluster_id = ?');
  return [...byCluster.values()].map((group) => {
    // Vertreter: Lieblingsquelle, sonst die neueste Meldung (rows kommen nach Zeit absteigend)
    const rep = group.find((g) => favorites.includes(g.source_id)) ?? group[0]!;
    const sources = Math.max(new Set(group.map((g) => g.source_id)).size, (count.get(rep.cluster_id) as { n: number }).n);
    const prepared = preparedOf(rep.url)?.topic;
    const topics = JSON.parse(rep.topics) as NewsTopic[];
    // Thema der KI nach vorne, damit Auswahl und Farb-Chip stimmen
    return { row: rep, topics: prepared && isNewsTopic(prepared) ? [prepared, ...topics.filter((t) => t !== prepared)] : topics, favorite: group.some((g) => favorites.includes(g.source_id)), sources };
  });
}

const importance = (c: Candidate) => c.sources * 10_000 + Date.parse(c.row.published_at) / 60_000;

/** Die Geschichten eines Landes nach Wichtigkeit (ohne KI), ohne die der letzten zwei Ausgaben */
export function rankedCandidates(country: string, date: string, nowMs = Date.now()): Candidate[] {
  const ids = allSources().filter((x) => x.country === country).map((x) => x.id);
  if (!ids.length) return [];
  const rows = db.prepare(`SELECT * FROM news_items WHERE source_id IN (${marks(ids.length)}) AND published_at > ? ORDER BY published_at DESC LIMIT 600`)
    .all(...ids, new Date(nowMs - WINDOW_MS).toISOString()) as NewsRow[];
  const earlier = (db.prepare('SELECT urls FROM news_edition WHERE country = ? AND date < ? ORDER BY date DESC LIMIT 2').all(country, date) as { urls: string }[])
    .flatMap((r) => JSON.parse(r.urls) as string[]);
  const seen = new Set(earlier.length
    ? (db.prepare(`SELECT cluster_id FROM news_items WHERE url IN (${marks(earlier.length)})`).all(...earlier) as { cluster_id: string }[]).map((r) => r.cluster_id)
    : []);
  return bundle(rows).filter((c) => !seen.has(c.row.cluster_id)).sort((a, b) => importance(b) - importance(a));
}

const preparedOf = (url: string) => db.prepare('SELECT * FROM news_prepared WHERE url = ?').get(url) as Prepared | undefined;

function savePrepared(url: string, patch: { topic?: string | null; image?: string | null; sentences?: Record<string, string>; focus?: string | null }) {
  const p = preparedOf(url);
  const sentences = { ...(JSON.parse(p?.sentences ?? '{}') as Record<string, string>), ...(patch.sentences ?? {}) };
  db.prepare(`INSERT INTO news_prepared (url, topic, image, sentences, prepared_at, focus) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(url) DO UPDATE SET topic = COALESCE(excluded.topic, news_prepared.topic), image = COALESCE(excluded.image, news_prepared.image),
      sentences = excluded.sentences, focus = COALESCE(excluded.focus, news_prepared.focus)`)
    .run(url, patch.topic ?? null, patch.image ?? null, JSON.stringify(sentences), p?.prepared_at ?? new Date().toISOString(), patch.focus ?? null);
}

/**
 * Echtes Bild finden, das wirklich lädt (Hauptbild der Artikelseite, sonst Feed-Bild). Gemerkt in news_prepared.image,
 * '' heißt „gesucht, keins“. `withData`: die Bilddaten gleich mitliefern (für die KI).
 */
async function ensureImage(c: Candidate, withData = false): Promise<{ url: string; data?: { mime: string; data: Buffer } } | null> {
  const known = preparedOf(c.row.url)?.image;
  if (known === '') return null;
  if (known && !withData) return { url: known };
  const options = known ? [known] : [...new Set([await articleImage(c.row.url), c.row.image].filter(isArticlePhoto))];
  for (const url of options) {
    if (url.startsWith('/')) return { url }; // Demo-Bild
    const data = await fetchImage(url);
    if (data) { savePrepared(c.row.url, { image: url }); return { url, data }; }
  }
  if (process.env.STELLA_DEMO_BILDER) {
    const url = demoImage(c.topics[0]);
    savePrepared(c.row.url, { image: url });
    return { url };
  }
  savePrepared(c.row.url, { image: '' });
  return null;
}

const SYSTEM = `You prepare one news item for the picture cards of a morning news app. You get the headline, the teaser and, if available, the article's photo.
1. focus: the point of the photo that must stay visible when the card crops it to a tall 4:5 portrait – the main subject (a face, the ball, the speaker, the damaged building). x and y are fractions of the photo's width and height, measured from the top-left corner (0 to 1). Without a photo use {"x":0.5,"y":0.5}.
2. sentences: exactly ONE neutral sentence (at most 25 words) that says what the item is about, so the reader knows whether to open the article – in each of these languages: {languages}. Describe the topic; do not retell the article and do not add facts that are not in the headline or teaser. All languages say the same.
3. topic: the ONE main subject of the item, one of: politics, economy, tech, science, climate, health, sport, culture, local. Judge by what the story is about, not by single words (a tennis match is sport even if a player is Ukrainian; a measles outbreak is health).
Rules for the sentences:
- Always factual and calm. For accidents, war, violence and deaths use a strictly sober tone, never jokes, never emojis, never exclamation marks. This applies no matter how the reader likes to be addressed.
- No clickbait, no opinions, no question marks.
- Keep names, numbers and places exactly as given.
Answer only with JSON: {"focus":{"x":0.5,"y":0.4},"topic":"…","sentences":{{keys}}}`;

export const editionPrompt = () => SYSTEM
  .replace('{languages}', LOCALES.map((l) => `${l} (${LANGUAGE_NAMES_EN[l]})`).join(', '))
  .replace('{keys}', LOCALES.map((l) => `"${l}":"…"`).join(','));

/** Genau ein Satz: Zeilenumbrüche weg, auf den ersten Satz kürzen, Länge begrenzen */
export function oneSentence(s: string, fallback: string): string {
  const flat = String(s ?? '').replace(/\s+/g, ' ').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').trim();
  const first = /^(.+?[.!?…])(\s|$)/.exec(flat)?.[1] ?? flat;
  const cut = first.length > 240 ? `${first.slice(0, 239).trimEnd()}…` : first;
  return cut.length >= 8 ? cut : fallback;
}

/** Erstes JSON-Objekt aus der Antwort (manche Gratis-Modelle setzen ```json davor oder Text dahinter) */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>; } catch { return null; }
}

const clamp01 = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null);

/** Antwort der KI prüfen; null = unbrauchbar */
export function readEnrichment(raw: Record<string, unknown> | null, title: string): { focus: string; topic: NewsTopic | null; sentences: Record<string, string> } | null {
  if (!raw) return null;
  const f = (raw.focus ?? {}) as { x?: unknown; y?: unknown };
  const x = clamp01(f.x), y = clamp01(f.y);
  const given = (raw.sentences && typeof raw.sentences === 'object' ? raw.sentences : {}) as Record<string, unknown>;
  const sentences: Record<string, string> = {};
  for (const l of LOCALES) if (typeof given[l] === 'string' && given[l]) sentences[l] = oneSentence(given[l] as string, title);
  if (!Object.keys(sentences).length) return null;
  return { focus: `${x ?? 0.5},${y ?? 0.5}`, topic: isNewsTopic(raw.topic) ? raw.topic : null, sentences };
}

/** Noch Gratis-Anfragen übrig? (Das Limit gilt für den ganzen Schlüssel.) */
const budgetLeft = () => openrouterAvailable() && (!config.openrouter.dailyLimit || usageToday() < config.openrouter.dailyLimit);

/**
 * Schonung des Kontingents: Nach so vielen Fehlschlägen hintereinander hört der Durchlauf auf (OpenRouter ist dann
 * wohl gestört), und ein Artikel wird frühestens nach RETRY_MS wieder versucht.
 */
const MAX_FAILS_IN_A_ROW = 3;
const RETRY_MS = 2 * 3600_000;
const lastTry = new Map<string, number>();
let failsInARow = 0;
/** nach MAX_FAILS_IN_A_ROW: bis dahin gar keine KI-Anfragen für die News */
let pausedUntil = 0;
/** Nur für Tests: gemerkte Versuche vergessen */
export const resetEnrichStateForTests = () => { lastTry.clear(); failsInARow = 0; pausedUntil = 0; };
const paused = (nowMs: number) => failsInARow >= MAX_FAILS_IN_A_ROW || nowMs < pausedUntil;

/** Ein Artikel, eine KI-Anfrage: Foto + Schlagzeile → Bildpunkt, Thema, Satz in allen Sprachen. false = nicht geklappt */
async function enrich(c: Candidate, image: { url: string; data?: { mime: string; data: Buffer } }, nowMs: number): Promise<boolean> {
  if (preparedOf(c.row.url)?.focus) return true; // schon aufbereitet
  if (!budgetLeft() || paused(nowMs)) return false;
  if (nowMs - (lastTry.get(c.row.url) ?? -Infinity) < RETRY_MS) return false;
  lastTry.set(c.row.url, nowMs);
  const ok = await askAi(c, image);
  failsInARow = ok ? 0 : failsInARow + 1;
  if (failsInARow >= MAX_FAILS_IN_A_ROW) pausedUntil = nowMs + RETRY_MS;
  return ok;
}

async function askAi(c: Candidate, image: { url: string; data?: { mime: string; data: Buffer } }): Promise<boolean> {
  try {
    const text = `Headline: ${c.row.title}${c.row.teaser ? `\nTeaser: ${c.row.teaser.slice(0, 600)}` : ''}`;
    const { message } = await complete([
      { role: 'system', content: editionPrompt() },
      { role: 'user', content: image.data
        ? [{ type: 'text', text }, { type: 'image_url', image_url: { url: `data:${image.data.mime};base64,${image.data.data.toString('base64')}` } }]
        : text },
    ], undefined, { openrouterOnly: true, vision: true, maxModels: 2, timeoutMs: 90_000 });
    const out = readEnrichment(parseJsonObject(String(message.content ?? '')), c.row.title);
    if (!out) return false;
    savePrepared(c.row.url, { topic: out.topic, sentences: out.sentences, focus: out.focus });
    if (out.topic && c.topics[0] !== out.topic) {
      c.topics = [out.topic, ...c.topics.filter((x) => x !== out.topic)];
      db.prepare('UPDATE news_items SET topics = ? WHERE url = ?').run(JSON.stringify(c.topics), c.row.url);
    }
    return true;
  } catch (err) {
    console.warn('News-Aufbereitung:', (err as Error).message.split('\n')[0]);
    return false;
  }
}

/** höchstens so viele KI-Anfragen gleichzeitig (Gratis-Modelle erlauben ~20 pro Minute) */
const PARALLEL = 3;

async function inPool<T>(items: T[], fn: (item: T) => Promise<unknown>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(PARALLEL, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]!);
  }));
}

/** Tagesausgabe eines Landes bauen: wichtigste Geschichten, gemischt, nur mit echtem Bild; dann je Artikel ein KI-Aufruf */
export async function buildEdition(country: string, date: string, nowMs = Date.now()): Promise<number> {
  const size = editionSize(country);
  const ranked = rankedCandidates(country, date, nowMs);
  const picked: { c: Candidate; image: { url: string; data?: { mime: string; data: Buffer } } }[] = [];
  const per = new Map<string, number>();
  // erst mit Themen-Obergrenze, dann (wenig los in den anderen Themen) mit den nächstwichtigsten auffüllen
  for (const capped of [true, false]) {
    for (const c of ranked) {
      if (picked.length >= size) break;
      if (picked.some((p) => p.c === c)) continue;
      const t = c.topics[0] ?? 'politics';
      if (capped && (per.get(t) ?? 0) >= topicCap(size, t)) continue;
      const image = await ensureImage(c, true);
      if (!image) continue; // es muss ein Bild geben – dann eben der nächste Artikel
      per.set(t, (per.get(t) ?? 0) + 1);
      picked.push({ c, image });
    }
  }
  if (!picked.length) return 0;
  await inPool(picked, (p) => enrich(p.c, p.image, nowMs));
  db.prepare('INSERT OR IGNORE INTO news_edition (country, date, urls) VALUES (?, ?, ?)').run(country, date, JSON.stringify(picked.map((p) => p.c.row.url)));
  return picked.length;
}

/** Artikel der heutigen Ausgaben, die noch nicht aufbereitet sind (KI war weg) – solange Kontingent übrig ist, neu versuchen */
async function retryEnrich(date: string, nowMs: number) {
  const rows = db.prepare('SELECT urls FROM news_edition WHERE date = ?').all(date) as { urls: string }[];
  const urls = rows.flatMap((r) => JSON.parse(r.urls) as string[]).filter((u) => !preparedOf(u)?.focus);
  if (!urls.length) return;
  // jeder Artikel für sich (nicht nach Geschichten bündeln – dieselbe Geschichte kann in zwei Länderausgaben stehen)
  const items: Candidate[] = (db.prepare(`SELECT * FROM news_items WHERE url IN (${marks(urls.length)})`).all(...urls) as NewsRow[])
    .map((row) => ({ row, topics: JSON.parse(row.topics) as NewsTopic[], favorite: false, sources: 1 }));
  await inPool(items, async (c) => {
    if (!budgetLeft() || paused(nowMs) || nowMs - (lastTry.get(c.row.url) ?? -Infinity) < RETRY_MS) return;
    const image = await ensureImage(c, true);
    if (image) await enrich(c, image, nowMs);
  });
}

let running: Promise<void> | null = null;

/**
 * Alle Tagesausgaben bauen, die heute (UTC) noch fehlen – ab EDITION_HOUR_UTC, nach jedem Feed-Abruf aufgerufen.
 * Läuft im Hintergrund und nie doppelt; die internationale Ausgabe zuerst.
 */
export function buildEditions(nowMs = Date.now()): Promise<void> {
  if (running) return running;
  if (new Date(nowMs).getUTCHours() < EDITION_HOUR_UTC) return Promise.resolve();
  const date = utcDate(nowMs);
  running = (async () => {
    failsInARow = 0;
    for (const country of EDITION_COUNTRIES) {
      if (db.prepare('SELECT 1 FROM news_edition WHERE country = ? AND date = ?').get(country, date)) continue;
      const n = await buildEdition(country, date, nowMs);
      if (n) console.log(`News: Ausgabe ${country} ${date} mit ${n} Artikeln (heute ${usageToday()} KI-Anfragen bei OpenRouter)`);
    }
    await retryEnrich(date, nowMs);
  })().finally(() => { running = null; });
  return running;
}

/** Die neueste Ausgabe eines Landes (höchstens zwei Tage alt), als Geschichten; null = es gibt keine */
function latestEdition(country: string, nowMs: number): Candidate[] | null {
  const ed = db.prepare('SELECT urls FROM news_edition WHERE country = ? AND date >= ? ORDER BY date DESC LIMIT 1')
    .get(country, utcDate(nowMs - 2 * 86400_000)) as { urls: string } | undefined;
  if (!ed) return null;
  const urls = JSON.parse(ed.urls) as string[];
  return urls.length ? bundle(db.prepare(`SELECT * FROM news_items WHERE url IN (${marks(urls.length)}) ORDER BY published_at DESC`).all(...urls) as NewsRow[]) : [];
}

/** Wie sehr eine Meldung diese Person interessieren dürfte */
function interest(c: Candidate, wanted: NewsTopic[] | null): number {
  const main = c.topics[0];
  return (c.favorite ? 1_000_000 : 0) + (wanted && main && wanted.includes(main) ? 50_000 : 0) + importance(c);
}

/**
 * Wo die Meldungen für diese Person herkommen: lokal = Ausgaben ihrer Länder, international = die internationale Ausgabe
 * plus Lieblingszeitungen. Fest gewählte Zeitungen ersetzen beides. Ohne Ausgabe (frisch gestarteter Server):
 * die wichtigsten Meldungen ohne KI-Aufbereitung.
 */
function pools(user: User, nowMs: number): { local: Candidate[]; intl: Candidate[] } {
  const s = newsSettings(user);
  const plan = planOf(user).limits;
  const favorites = plan.newsFavorites ? s.favorites.map((f) => favoriteId(f.feedUrl)) : [];
  const countries = s.countries.length ? s.countries : defaultCountries(user.settings.country);
  const since = new Date(nowMs - WINDOW_MS).toISOString();
  const rowsFrom = (ids: string[]) => ids.length
    ? db.prepare(`SELECT * FROM news_items WHERE source_id IN (${marks(ids.length)}) AND published_at > ? ORDER BY published_at DESC LIMIT 400`).all(...ids, since) as NewsRow[]
    : [];
  const edition = (country: string) => latestEdition(country, nowMs) ?? rankedCandidates(country, utcDate(nowMs), nowMs).slice(0, editionSize(country) * 2);

  let local: Candidate[] = [];
  let intl: Candidate[];
  if (s.sources.length) {
    intl = bundle(rowsFrom(s.sources));
  } else {
    for (const country of countries) if ((LOCAL_EDITIONS as string[]).includes(country)) local.push(...edition(country));
    intl = edition('INT');
  }
  // Lieblingszeitungen kommen immer dazu
  for (const fav of bundle(rowsFrom(favorites), favorites)) {
    const same = [...local, ...intl].find((c) => c.row.cluster_id === fav.row.cluster_id);
    if (same) { same.favorite = true; same.row = fav.row; } else intl.push(fav);
  }
  // eine Geschichte nur einmal (lokal geht vor)
  const inLocal = new Set(local.map((c) => c.row.cluster_id));
  intl = intl.filter((c) => !inLocal.has(c.row.cluster_id));
  local = local.filter((c, i) => local.findIndex((x) => x.row.cluster_id === c.row.cluster_id) === i);
  return { local, intl };
}

/** Was diese Person an den beiden Tagen davor schon bekommen hat */
function shownBefore(user: User, date: string): Set<string> {
  const rows = db.prepare('SELECT json FROM news_digest WHERE user_id = ? AND date < ? ORDER BY date DESC LIMIT 2').all(user.id, date) as { json: string }[];
  return new Set(rows.flatMap((r) => (JSON.parse(r.json) as NewsEntry[]).map((e) => e.url)));
}

/**
 * Die Meldungen für diese Person (ohne KI): Free 1 lokale + 2 internationale, bezahlte Abos 2 + 6. Gewünschte Themen
 * gehen vor, der Rest wird mit den wichtigsten aufgefüllt. Nur mit Bild, nichts doppelt, nichts von den Vortagen.
 */
export function selectNews(user: User, nowMs = Date.now()): Candidate[] {
  const s = newsSettings(user);
  const wanted = s.topics.length ? s.topics : null;
  const shown = shownBefore(user, todayIn(user.timeZone));
  const usable = (c: Candidate) => !!preparedOf(c.row.url)?.image && !shown.has(c.row.url);
  const rank = (list: Candidate[]) => list.filter(usable).sort((a, b) => interest(b, wanted) - interest(a, wanted));
  const { local, intl } = pools(user, nowMs);
  const l = rank(local), i = rank(intl);

  const count = newsCountFor(user, s);
  const nLocal = l.length ? Math.min(localShare(count), l.length) : 0;
  const out = [...l.slice(0, nLocal), ...i.slice(0, count - nLocal)];
  // zu wenig auf einer Seite: mit den interessantesten der anderen auffüllen
  for (const c of [...l, ...i].sort((a, b) => interest(b, wanted) - interest(a, wanted))) {
    if (out.length >= count) break;
    if (!out.includes(c)) out.push(c);
  }
  return out.sort((a, b) => interest(b, wanted) - interest(a, wanted));
}

const sourceName = (id: string, favorites: NewsSettings['favorites']) =>
  allSources().find((s) => s.id === id)?.name ?? favorites.find((f) => favoriteId(f.feedUrl) === id)?.name ?? id;

export const parseFocus = (f: string | null | undefined): { x: number; y: number } | undefined => {
  const m = /^([\d.]+),([\d.]+)$/.exec(f ?? '');
  return m ? { x: Math.min(1, Number(m[1])), y: Math.min(1, Number(m[2])) } : undefined;
};

/** Die Meldungen für heute (einmal pro Tag gebaut und gemerkt). Ohne News oder ohne Treffer: leere Liste. Kein KI-Aufruf. */
export async function buildDigest(user: User, nowMs = Date.now()): Promise<NewsEntry[]> {
  const s = newsSettings(user);
  if (!s.enabled) return [];
  const date = todayIn(user.timeZone);
  const cached = db.prepare('SELECT json FROM news_digest WHERE user_id = ? AND date = ?').get(user.id, date) as { json: string } | undefined;
  if (cached) return JSON.parse(cached.json) as NewsEntry[];
  // Bilder für Meldungen außerhalb der Ausgaben (Lieblingszeitungen, fest gewählte Zeitungen, Server ohne Ausgabe) suchen
  const { local, intl } = pools(user, nowMs);
  const open = [...local, ...intl].filter((c) => preparedOf(c.row.url)?.image == null).slice(0, newsCountFor(user, s) * 3);
  await inPool(open, (c) => ensureImage(c));

  const picked = selectNews(user, nowMs);
  if (!picked.length) return [];
  const lang: Locale = userLocale(user);
  const entries: NewsEntry[] = picked.map((c) => {
    const p = preparedOf(c.row.url);
    const sentences = JSON.parse(p?.sentences ?? '{}') as Record<string, string>;
    const topic = (p?.topic && isNewsTopic(p.topic) ? p.topic : c.topics[0]) as NewsTopic | undefined;
    const focus = parseFocus(p?.focus);
    return {
      sentence: sentences[lang] ?? c.row.title, source: sourceName(c.row.source_id, s.favorites), url: c.row.url, publishedAt: c.row.published_at,
      ...(c.favorite ? { favorite: true } : {}), ...(p?.image ? { image: p.image } : {}), ...(focus ? { focus } : {}), ...(topic ? { topic } : {}),
    };
  });
  db.prepare('INSERT OR REPLACE INTO news_digest (user_id, date, json) VALUES (?, ?, ?)').run(user.id, date, JSON.stringify(entries));
  saveNews(user, { lastAt: new Date(nowMs).toISOString() });
  return entries;
}

/** Aus dem Zwischenspeicher (ohne KI) – für buildBriefing, das nicht warten kann */
export function digestOf(user: User): NewsEntry[] {
  if (!newsSettings(user).enabled) return [];
  const row = db.prepare('SELECT json FROM news_digest WHERE user_id = ? AND date = ?').get(user.id, todayIn(user.timeZone)) as { json: string } | undefined;
  return row ? (JSON.parse(row.json) as NewsEntry[]) : [];
}
