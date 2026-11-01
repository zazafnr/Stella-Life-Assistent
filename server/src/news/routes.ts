import type { FastifyInstance } from 'fastify';
import { HttpError } from '../auth.ts';
import { planOf } from '../billing.ts';
import { tr } from '../locale.ts';
import type { User } from '../db.ts';
import { findFeedLinks, parseFeed } from './feed.ts';
import { assertPublicUrl, fetchText, UnsafeUrl } from './net.ts';
import { allSources, defaultCountries, isNewsTopic, NEWS_COUNTRIES, NEWS_TOPICS } from './sources.ts';
import { defaultNews, newsCountFor, newsSettings, saveNews, type NewsSettings } from './digest.ts';

const MAX_FAVORITES = 3;

export interface FoundFavorite { name: string; feedUrl: string; sample: string[] }

const slug = (q: string) => q.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');

/** Name oder Webseite → Feed. Katalog zuerst, dann die Startseite (`<link rel="alternate" type="application/rss+xml">`). */
export async function findFavoriteFeed(query: string): Promise<FoundFavorite | null> {
  const q = query.trim().slice(0, 200);
  if (!q) return null;
  const byName = allSources().find((s) => slug(s.name) === slug(q) || slug(s.id) === slug(q));
  const candidates: string[] = byName ? [byName.homepage] : [];
  if (/^https?:\/\//i.test(q)) candidates.push(q);
  else if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(q)) candidates.push(`https://${q}`);
  else if (slug(q).length >= 3) candidates.push(...['com', 'de', 'at', 'ch'].map((tld) => `https://www.${slug(q)}.${tld}`));

  for (const home of candidates.slice(0, 5)) {
    try {
      await assertPublicUrl(home);
      const page = await fetchText(home, { strict: true, timeoutMs: 8000 });
      if (page.status !== 200) continue;
      // die Adresse war selbst schon ein Feed
      const feeds = /<(rss|feed|rdf:RDF)\b/i.test(page.body.slice(0, 2000)) ? [{ feedUrl: page.url }] : findFeedLinks(page.body, page.url);
      for (const f of feeds.slice(0, 3)) {
        const res = f.feedUrl === page.url ? page : await fetchText(f.feedUrl, { strict: true, timeoutMs: 8000 }).catch(() => null);
        if (!res || res.status !== 200) continue;
        const parsed = parseFeed(res.body);
        if (!parsed.items.length) continue;
        return { name: parsed.title || new URL(page.url).hostname.replace(/^www\./, ''), feedUrl: res.url, sample: parsed.items.slice(0, 3).map((i) => i.title) };
      }
    } catch (err) {
      if (err instanceof UnsafeUrl) throw new HttpError(400, err.message);
    }
  }
  return null;
}

const view = (user: User) => {
  const s = newsSettings(user);
  const plan = planOf(user).limits;
  return {
    settings: s,
    limits: { count: plan.newsCount, favorites: plan.newsFavorites, maxFavorites: MAX_FAVORITES },
    effectiveCount: newsCountFor(user, s),
    topics: NEWS_TOPICS, countries: NEWS_COUNTRIES, defaultCountries: defaultCountries(user.settings.country),
    sources: allSources().map(({ id, name, country, lang }) => ({ id, name, country, lang })),
  };
};

export function registerNewsRoutes(api: FastifyInstance) {
  api.get('/api/news', async (req) => view(req.user));

  api.put('/api/news', async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const patch: Partial<NewsSettings> = {};
    if (typeof b.enabled === 'boolean') patch.enabled = b.enabled;
    if (Array.isArray(b.topics)) patch.topics = [...new Set(b.topics.filter(isNewsTopic))];
    if (Array.isArray(b.countries)) patch.countries = [...new Set(b.countries.filter((c): c is string => typeof c === 'string' && (NEWS_COUNTRIES as string[]).includes(c)))];
    if (Array.isArray(b.sources)) patch.sources = [...new Set(b.sources.filter((id): id is string => typeof id === 'string' && allSources().some((s) => s.id === id)))];
    if (b.count !== undefined) patch.count = Math.max(1, Math.min(10, Number(b.count) || 5));
    if (typeof b.asked === 'boolean') patch.asked = b.asked;
    if (Array.isArray(b.favorites)) {
      if (b.favorites.length && !planOf(req.user).limits.newsFavorites) throw new HttpError(402, tr(req.user, 'news.favoritesPlan'));
      patch.favorites = b.favorites.slice(0, MAX_FAVORITES).map((f: { name?: unknown; feedUrl?: unknown }) => ({ name: String(f.name ?? '').slice(0, 80), feedUrl: String(f.feedUrl ?? '').slice(0, 500) }))
        .filter((f) => /^https?:\/\//i.test(f.feedUrl) && f.name);
    }
    saveNews(req.user, patch);
    return view({ ...req.user, settings: { ...req.user.settings, news: { ...newsSettings(req.user), ...patch } } as never });
  });

  /** „Ja, gern“ ohne Auswahl bzw. „Nein danke“ */
  api.post('/api/news/answer', async (req) => {
    const yes = (req.body as { answer?: unknown } | null)?.answer === 'yes';
    if (yes) saveNews(req.user, defaultNews(req.user)); else saveNews(req.user, { enabled: false, asked: true });
    return { ok: true };
  });

  /** Lieblingszeitung: Name oder Webseite → Feed zur Bestätigung */
  api.post('/api/news/feed-search', async (req) => {
    if (!planOf(req.user).limits.newsFavorites) throw new HttpError(402, tr(req.user, 'news.favoritesPlan'));
    const q = String((req.body as { query?: unknown } | null)?.query ?? '');
    const found = await findFavoriteFeed(q);
    if (!found) throw new HttpError(404, tr(req.user, 'news.noFeed'));
    return found;
  });
}
