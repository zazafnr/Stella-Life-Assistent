// Auswahl und Kurzfassung der Meldungen für das Morgen-Briefing.
//  · neu seit dem letzten Briefing, passend zu Themen und Ländern, höchstens eine Meldung pro Geschichte
//  · Rangfolge: Lieblingsquelle zuerst, dann wie viele Quellen dieselbe Geschichte bringen, dann Aktualität
//  · Anzahl je Abo (Free 3, sonst 5)
//  · Haiku schreibt je Meldung EINEN neutralen Satz in der Sprache der Person – bei Unglücken, Krieg und Tod immer sachlich, auch bei „frech“

import { LANGUAGE_NAMES_EN, todayIn } from '@stella/shared';
import { planOf } from '../billing.ts';
import { db, updateUserSettings, type User } from '../db.ts';
import { complete } from '../llm.ts';
import { userLocale } from '../locale.ts';
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

export interface NewsEntry { sentence: string; source: string; url: string; publishedAt: string; favorite?: boolean }

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

interface Candidate { row: NewsRow; topics: NewsTopic[]; favorite: boolean; sources: number }

/** Passende, noch nicht gesendete Meldungen auswählen (ohne KI) */
export function selectNews(user: User, nowMs = Date.now()): Candidate[] {
  const s = newsSettings(user);
  const plan = planOf(user).limits;
  const favorites = plan.newsFavorites ? s.favorites.map((f) => favoriteId(f.feedUrl)) : [];
  const countries = s.countries.length ? s.countries : defaultCountries(user.settings.country);
  const chosen = s.sources.length ? s.sources : allSources().filter((x) => countries.includes(x.country)).map((x) => x.id);
  const sourceIds = [...new Set([...chosen, ...favorites])];
  if (!sourceIds.length) return [];
  const since = Math.max(s.lastAt ? Date.parse(s.lastAt) : 0, nowMs - 36 * 3600_000);
  const marks = sourceIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT * FROM news_items WHERE source_id IN (${marks}) AND published_at > ? ORDER BY published_at DESC LIMIT 400`)
    .all(...sourceIds, new Date(since).toISOString()) as NewsRow[];
  const wanted = s.topics.length ? s.topics : null;
  const byCluster = new Map<string, Candidate[]>();
  for (const row of rows) {
    const topics = JSON.parse(row.topics) as NewsTopic[];
    if (wanted && !topics.some((t) => wanted.includes(t))) continue;
    const list = byCluster.get(row.cluster_id) ?? [];
    list.push({ row, topics, favorite: favorites.includes(row.source_id), sources: 1 });
    byCluster.set(row.cluster_id, list);
  }
  const picked: Candidate[] = [];
  for (const group of byCluster.values()) {
    const sources = new Set(group.map((g) => g.row.source_id)).size;
    // Vertreter: Lieblingsquelle, sonst die neueste Meldung
    const rep = group.find((g) => g.favorite) ?? group[0]!;
    picked.push({ ...rep, sources, favorite: group.some((g) => g.favorite) });
  }
  const score = (c: Candidate) => (c.favorite ? 1_000_000 : 0) + c.sources * 10_000 + Date.parse(c.row.published_at) / 60_000;
  return picked.sort((a, b) => score(b) - score(a)).slice(0, newsCountFor(user, s));
}

const SYSTEM = `You write one-sentence summaries for a morning news briefing.
For every numbered news item write exactly ONE neutral sentence (at most 25 words) in {language} that says what the item is about, so the reader knows whether to open the article. Describe the topic; do not retell the article and do not add facts that are not in the title or teaser.
Rules:
- Always factual and calm. For accidents, war, violence and deaths use a strictly sober tone, never jokes, never emojis, never exclamation marks. This applies no matter how the reader likes to be addressed.
- No clickbait, no opinions, no question marks.
- Keep names, numbers and places exactly as given.
Answer only with JSON: {"sentences": ["…", "…"]} with exactly one sentence per item, in the same order.`;

/** Genau ein Satz: Zeilenumbrüche weg, auf den ersten Satz kürzen, Länge begrenzen */
export function oneSentence(s: string, fallback: string): string {
  const flat = String(s ?? '').replace(/\s+/g, ' ').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').trim();
  const first = /^(.+?[.!?…])(\s|$)/.exec(flat)?.[1] ?? flat;
  const cut = first.length > 240 ? `${first.slice(0, 239).trimEnd()}…` : first;
  return cut.length >= 8 ? cut : fallback;
}

async function summarize(user: User, items: Candidate[]): Promise<string[]> {
  const lang = LANGUAGE_NAMES_EN[userLocale(user)];
  try {
    const list = items.map((c, i) => `${i + 1}. ${c.row.title}${c.row.teaser ? ` — ${c.row.teaser}` : ''}`).join('\n');
    const { message } = await complete([
      { role: 'system', content: SYSTEM.replace('{language}', lang) },
      { role: 'user', content: list },
    ], undefined, { json: true, tier: 'light', effort: 'low', timeoutMs: 30_000, maxTokens: 1500, userId: user.id, background: true });
    const out = (JSON.parse(message.content ?? '{}') as { sentences?: unknown }).sentences;
    if (Array.isArray(out) && out.length === items.length) return out.map((s, i) => oneSentence(String(s), items[i]!.row.title));
  } catch { /* ohne KI bleibt der Titel */ }
  return items.map((c) => c.row.title);
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
  const picked = selectNews(user);
  if (!picked.length) return [];
  const sentences = await summarize(user, picked);
  const entries: NewsEntry[] = picked.map((c, i) => ({
    sentence: sentences[i]!, source: sourceName(c.row.source_id, s.favorites), url: c.row.url, publishedAt: c.row.published_at, ...(c.favorite ? { favorite: true } : {}),
  }));
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
