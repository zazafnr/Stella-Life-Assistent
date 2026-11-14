// News für das Morgen-Briefing und die Bildkarten auf „Heute“.
//  · Tagesausgabe: einmal pro Land und Tag die 15 wichtigsten Geschichten, von der KI (OpenRouter bzw. Claude)
//    in einem Aufruf aufbereitet – je ein neutraler Satz in der Sprache der Person, Hauptthema, echtes Hauptbild
//  · jede Person bekommt daraus die Meldungen, die sie am ehesten interessieren (Themen, Länder, Lieblingszeitungen)
//  · Anzahl je Abo (Free 3, sonst 5)
//  · bei Unglücken, Krieg und Tod immer sachlich, auch bei „frech“

import { LANGUAGE_NAMES_EN, todayIn } from '@stella/shared';
import { planOf } from '../billing.ts';
import { db, updateUserSettings, type User } from '../db.ts';
import { complete } from '../llm.ts';
import { userLocale } from '../locale.ts';
import { decodeEntities } from './feed.ts';
import { fetchText } from './net.ts';
import { newsImage } from './image.ts';
import { favoriteId, type NewsRow } from './store.ts';
import { allSources, defaultCountries, isNewsTopic, type NewsTopic } from './sources.ts';

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

/** `image`: Vorschaubild (https, oder Pfad auf diesem Server für KI-/Demo-Bilder) für die Bildkarten auf „Heute“, `topic`: erstes erkanntes Thema für den Farb-Chip */
export interface NewsEntry { sentence: string; source: string; url: string; publishedAt: string; favorite?: boolean; image?: string; topic?: NewsTopic }

/** og:image / twitter:image aus dem Kopf der Artikelseite – nur für die wenigen Meldungen ohne Bild im Feed */
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

// ---------- Tagesausgabe: einmal pro Land und Tag die 15 wichtigsten Meldungen, von der KI aufbereitet ----------
//
// 1. editionCandidates: die wichtigsten Geschichten eines Landes (viele Zeitungen berichten, aktuell, gemischte Themen)
// 2. prepare: die KI schreibt für alle 15 in EINEM Aufruf je einen Satz und bestimmt das Hauptthema; dazu das Bild
//    (echtes Hauptbild des Artikels, sonst Feed-Bild, sonst KI-Bild). Das passiert pro Artikel nur einmal, für alle Nutzer.
// 3. selectNews: jede Person bekommt daraus die Meldungen, die sie am ehesten interessieren (Themen, Länder,
//    Lieblingszeitungen aus den News-Einstellungen), so viele wie ihr Abo erlaubt.

interface Candidate { row: NewsRow; topics: NewsTopic[]; favorite: boolean; sources: number }
interface Prepared { url: string; topic: string | null; image: string | null; sentences: string; prepared_at: string }

/** Größe der Tagesausgabe je Land */
export const EDITION_SIZE = 15;
/** höchstens so viele Geschichten pro Thema, damit die Ausgabe gemischt ist (sonst wäre sie oft nur Politik) */
const PER_TOPIC = 4;
const WINDOW_MS = 36 * 3600_000;

const marks = (n: number) => Array.from({ length: n }, () => '?').join(',');

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
    return { row: rep, topics: JSON.parse(rep.topics) as NewsTopic[], favorite: group.some((g) => favorites.includes(g.source_id)), sources };
  });
}

const importance = (c: Candidate) => c.sources * 10_000 + Date.parse(c.row.published_at) / 60_000;

/** Die wichtigsten Geschichten eines Landes für die Tagesausgabe (ohne KI), ohne die der letzten zwei Ausgaben */
export function editionCandidates(country: string, date: string, nowMs = Date.now()): Candidate[] {
  const ids = allSources().filter((x) => x.country === country).map((x) => x.id);
  if (!ids.length) return [];
  const rows = db.prepare(`SELECT * FROM news_items WHERE source_id IN (${marks(ids.length)}) AND published_at > ? ORDER BY published_at DESC LIMIT 600`)
    .all(...ids, new Date(nowMs - WINDOW_MS).toISOString()) as NewsRow[];
  const earlier = (db.prepare('SELECT urls FROM news_edition WHERE country = ? AND date < ? ORDER BY date DESC LIMIT 2').all(country, date) as { urls: string }[])
    .flatMap((r) => JSON.parse(r.urls) as string[]);
  const seen = new Set(earlier.length
    ? (db.prepare(`SELECT cluster_id FROM news_items WHERE url IN (${marks(earlier.length)})`).all(...earlier) as { cluster_id: string }[]).map((r) => r.cluster_id)
    : []);
  const ranked = bundle(rows).filter((c) => !seen.has(c.row.cluster_id)).sort((a, b) => importance(b) - importance(a));
  const out: Candidate[] = [];
  const perTopic = new Map<string, number>();
  for (const c of ranked) {
    if (out.length >= EDITION_SIZE) break;
    const t = c.topics[0] ?? 'politics';
    if ((perTopic.get(t) ?? 0) >= PER_TOPIC) continue;
    perTopic.set(t, (perTopic.get(t) ?? 0) + 1);
    out.push(c);
  }
  // wenig los in den anderen Themen: mit den nächstwichtigsten auffüllen
  for (const c of ranked) { if (out.length >= EDITION_SIZE) break; if (!out.includes(c)) out.push(c); }
  return out;
}

const SYSTEM = `You write one-sentence summaries for a morning news briefing and tag each item with its main topic.
For every numbered news item write exactly ONE neutral sentence (at most 25 words) in {language} that says what the item is about, so the reader knows whether to open the article. Describe the topic; do not retell the article and do not add facts that are not in the title or teaser.
Rules:
- Always factual and calm. For accidents, war, violence and deaths use a strictly sober tone, never jokes, never emojis, never exclamation marks. This applies no matter how the reader likes to be addressed.
- No clickbait, no opinions, no question marks.
- Keep names, numbers and places exactly as given.
- topic: the ONE main subject of the item, one of: politics, economy, tech, science, climate, health, sport, culture, local. Judge by what the story is about, not by single words (a tennis match is sport even if a player is Ukrainian; a measles outbreak is health).
Answer only with JSON: {"sentences": ["…", "…"], "topics": ["…", "…"]} with exactly one sentence and one topic per item, in the same order.`;

/** Genau ein Satz: Zeilenumbrüche weg, auf den ersten Satz kürzen, Länge begrenzen */
export function oneSentence(s: string, fallback: string): string {
  const flat = String(s ?? '').replace(/\s+/g, ' ').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').trim();
  const first = /^(.+?[.!?…])(\s|$)/.exec(flat)?.[1] ?? flat;
  const cut = first.length > 240 ? `${first.slice(0, 239).trimEnd()}…` : first;
  return cut.length >= 8 ? cut : fallback;
}

/** Ein KI-Aufruf für alle Meldungen: Satz in der Sprache + Hauptthema. null = KI nicht erreichbar oder Antwort unbrauchbar */
async function tailor(items: Candidate[], lang: string, userId?: string): Promise<{ sentences: string[]; topics: (NewsTopic | null)[] } | null> {
  try {
    const list = items.map((c, i) => `${i + 1}. ${c.row.title}${c.row.teaser ? ` — ${c.row.teaser}` : ''}`).join('\n');
    const { message } = await complete([
      { role: 'system', content: SYSTEM.replace('{language}', LANGUAGE_NAMES_EN[lang as keyof typeof LANGUAGE_NAMES_EN] ?? 'English') },
      { role: 'user', content: list },
    ], undefined, { json: true, tier: 'light', effort: 'low', timeoutMs: 45_000, maxTokens: 3000, userId, background: true });
    const out = JSON.parse(message.content ?? '{}') as { sentences?: unknown; topics?: unknown };
    if (!Array.isArray(out.sentences) || out.sentences.length !== items.length) return null;
    const topics = Array.isArray(out.topics) && out.topics.length === items.length ? out.topics : [];
    return {
      sentences: out.sentences.map((s, i) => oneSentence(String(s), items[i]!.row.title)),
      topics: items.map((_, i) => (isNewsTopic(topics[i]) ? topics[i] : null)),
    };
  } catch { return null; }
}

const preparedOf = (url: string) => db.prepare('SELECT * FROM news_prepared WHERE url = ?').get(url) as Prepared | undefined;

/**
 * Artikel aufbereiten, soweit noch nicht geschehen: Satz in `lang` und Thema (ein KI-Aufruf für alle fehlenden), Bild.
 * Ergebnis wird für alle gemerkt. Ohne KI bleibt der Satz offen (beim nächsten Mal neuer Versuch), angezeigt wird die Schlagzeile.
 */
async function prepare(items: Candidate[], lang: string, userId?: string): Promise<void> {
  const upsert = db.prepare(`INSERT INTO news_prepared (url, topic, image, sentences, prepared_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(url) DO UPDATE SET topic = COALESCE(excluded.topic, news_prepared.topic), image = COALESCE(excluded.image, news_prepared.image), sentences = excluded.sentences`);
  const save = (c: Candidate, patch: { topic?: string | null; image?: string | null; sentence?: string }) => {
    const p = preparedOf(c.row.url);
    const sentences = JSON.parse(p?.sentences ?? '{}') as Record<string, string>;
    if (patch.sentence) sentences[lang] = patch.sentence;
    upsert.run(c.row.url, patch.topic ?? null, patch.image ?? null, JSON.stringify(sentences), p?.prepared_at ?? new Date().toISOString());
  };

  const missing = items.filter((c) => !(JSON.parse(preparedOf(c.row.url)?.sentences ?? '{}') as Record<string, string>)[lang]);
  if (missing.length) {
    const t = await tailor(missing, lang, userId);
    missing.forEach((c, i) => {
      const topic = t?.topics[i] ?? null;
      save(c, { sentence: t?.sentences[i], topic });
      // Thema der KI nach vorne, damit Auswahl und Farb-Chip stimmen
      if (topic && c.topics[0] !== topic) {
        c.topics = [topic, ...c.topics.filter((x) => x !== topic)];
        db.prepare('UPDATE news_items SET topics = ? WHERE url = ?').run(JSON.stringify(c.topics), c.row.url);
      }
    });
  }
  // Bilder: '' heißt „gesucht, keins gefunden“
  const noImage = items.filter((c) => preparedOf(c.row.url)?.image == null);
  const images = await Promise.all(noImage.map((c) =>
    newsImage({ url: c.row.url, title: c.row.title, teaser: c.row.teaser, feedImage: c.row.image, topic: (preparedOf(c.row.url)?.topic as NewsTopic | null) ?? c.topics[0] }, articleImage)));
  noImage.forEach((c, i) => save(c, { image: images[i] ?? '' }));
}

const building = new Map<string, Promise<void>>();

/** Tagesausgabe eines Landes bauen und aufbereiten (einmal am Tag, gleichzeitige Anfragen warten auf denselben Bau) */
export async function ensureEdition(country: string, date: string, lang: string, userId?: string): Promise<void> {
  if (db.prepare('SELECT 1 FROM news_edition WHERE country = ? AND date = ?').get(country, date)) return;
  const key = `${country}|${date}`;
  const running = building.get(key);
  if (running) return running;
  const job = (async () => {
    const picked = editionCandidates(country, date);
    if (!picked.length) return;
    await prepare(picked, lang, userId);
    // erst speichern, wenn genug Meldungen da sind (direkt nach dem Serverstart sind die Feeds evtl. noch nicht geholt)
    if (picked.length >= Math.min(EDITION_SIZE, 5)) {
      db.prepare('INSERT OR IGNORE INTO news_edition (country, date, urls) VALUES (?, ?, ?)').run(country, date, JSON.stringify(picked.map((c) => c.row.url)));
    }
  })().finally(() => building.delete(key));
  building.set(key, job);
  return job;
}

/** Wie sehr eine Meldung diese Person interessieren dürfte */
function interest(c: Candidate, wanted: NewsTopic[] | null): number {
  const main = c.topics[0];
  return (c.favorite ? 1_000_000 : 0) + (wanted && main && wanted.includes(main) ? 50_000 : 0) + importance(c);
}

/**
 * Die Meldungen für diese Person (ohne KI): aus den Tagesausgaben ihrer Länder (oder ihren fest gewählten Zeitungen)
 * plus Lieblingszeitungen, nur gewünschte Themen, eine pro Geschichte, neu seit dem letzten Briefing, so viele wie das Abo erlaubt.
 */
export function selectNews(user: User, nowMs = Date.now()): Candidate[] {
  const s = newsSettings(user);
  const plan = planOf(user).limits;
  const favorites = plan.newsFavorites ? s.favorites.map((f) => favoriteId(f.feedUrl)) : [];
  const countries = s.countries.length ? s.countries : defaultCountries(user.settings.country);
  const date = todayIn(user.timeZone);
  const since = new Date(Math.max(s.lastAt ? Date.parse(s.lastAt) : 0, nowMs - WINDOW_MS)).toISOString();
  const rowsFrom = (ids: string[]) => ids.length
    ? db.prepare(`SELECT * FROM news_items WHERE source_id IN (${marks(ids.length)}) AND published_at > ? ORDER BY published_at DESC LIMIT 400`).all(...ids, since) as NewsRow[]
    : [];

  let pool: Candidate[];
  if (s.sources.length) {
    // fest gewählte Zeitungen: direkt aus deren Meldungen
    pool = bundle(rowsFrom(s.sources));
  } else {
    pool = [];
    for (const country of countries) {
      const ed = db.prepare('SELECT urls FROM news_edition WHERE country = ? AND date = ?').get(country, date) as { urls: string } | undefined;
      const urls = ed ? JSON.parse(ed.urls) as string[] : null;
      const list = urls
        ? bundle(urls.length ? db.prepare(`SELECT * FROM news_items WHERE url IN (${marks(urls.length)}) ORDER BY published_at DESC`).all(...urls) as NewsRow[] : [])
        : editionCandidates(country, date, nowMs);
      pool.push(...list);
    }
  }
  // Lieblingszeitungen kommen immer dazu
  for (const fav of bundle(rowsFrom(favorites), favorites)) {
    const same = pool.find((c) => c.row.cluster_id === fav.row.cluster_id);
    if (same) { same.favorite = true; same.row = fav.row; } else pool.push(fav);
  }

  const wanted = s.topics.length ? s.topics : null;
  const seen = new Set<string>();
  const ranked = pool
    .filter((c) => c.row.published_at > since)
    .filter((c) => !wanted || c.topics.some((t) => wanted.includes(t)))
    .sort((a, b) => interest(b, wanted) - interest(a, wanted))
    .filter((c) => (seen.has(c.row.cluster_id) ? false : (seen.add(c.row.cluster_id), true)));
  // gemischt: höchstens die Hälfte zu einem Thema (Lieblingszeitungen zählen nicht mit), danach auffüllen
  const count = newsCountFor(user, s);
  const cap = Math.max(1, Math.ceil(count / 2));
  const out: Candidate[] = [];
  const per = new Map<string, number>();
  for (const c of ranked) {
    if (out.length >= count) break;
    const t = c.topics[0] ?? 'politics';
    if (!c.favorite && (per.get(t) ?? 0) >= cap) continue;
    per.set(t, (per.get(t) ?? 0) + 1);
    out.push(c);
  }
  for (const c of ranked) { if (out.length >= count) break; if (!out.includes(c)) out.push(c); }
  return out.sort((a, b) => interest(b, wanted) - interest(a, wanted));
}

const sourceName = (id: string, favorites: NewsSettings['favorites']) =>
  allSources().find((s) => s.id === id)?.name ?? favorites.find((f) => favoriteId(f.feedUrl) === id)?.name ?? id;

/** Die Meldungen für heute (einmal pro Tag gebaut und gemerkt). Ohne News oder ohne Treffer: leere Liste. */
export async function buildDigest(user: User): Promise<NewsEntry[]> {
  const s = newsSettings(user);
  if (!s.enabled) return [];
  const date = todayIn(user.timeZone);
  const cached = db.prepare('SELECT json FROM news_digest WHERE user_id = ? AND date = ?').get(user.id, date) as { json: string } | undefined;
  if (cached) return JSON.parse(cached.json) as NewsEntry[];
  const lang = userLocale(user);
  if (!s.sources.length) {
    for (const country of s.countries.length ? s.countries : defaultCountries(user.settings.country)) await ensureEdition(country, date, lang, user.id);
  }
  const picked = selectNews(user);
  if (!picked.length) return [];
  // was noch fehlt (andere Sprache, Lieblingszeitungen, fest gewählte Zeitungen) – nur für diese wenigen
  await prepare(picked, lang, user.id);
  const entries: NewsEntry[] = picked.map((c) => {
    const p = preparedOf(c.row.url);
    const sentence = (JSON.parse(p?.sentences ?? '{}') as Record<string, string>)[lang] ?? c.row.title;
    const topic = (p?.topic && isNewsTopic(p.topic) ? p.topic : c.topics[0]) as NewsTopic | undefined;
    return {
      sentence, source: sourceName(c.row.source_id, s.favorites), url: c.row.url, publishedAt: c.row.published_at, ...(c.favorite ? { favorite: true } : {}),
      ...(p?.image ? { image: p.image } : {}), ...(topic ? { topic } : {}),
    };
  });
  db.prepare('INSERT OR REPLACE INTO news_digest (user_id, date, json) VALUES (?, ?, ?)').run(user.id, date, JSON.stringify(entries));
  saveNews(user, { lastAt: new Date().toISOString() });
  return entries;
}

/** Aus dem Zwischenspeicher (ohne KI) – für buildBriefing, das nicht warten kann */
export function digestOf(user: User): NewsEntry[] {
  if (!newsSettings(user).enabled) return [];
  const row = db.prepare('SELECT json FROM news_digest WHERE user_id = ? AND date = ?').get(user.id, todayIn(user.timeZone)) as { json: string } | undefined;
  return row ? (JSON.parse(row.json) as NewsEntry[]) : [];
}
