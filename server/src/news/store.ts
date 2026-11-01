// Abruf (alle 30 Minuten, zentral für alle) und Ablage der Meldungen. Nur Titel, Teaser und Link; nach 3 Tagen wird gelöscht.

import { createHash } from 'node:crypto';
import { db, newId, now } from '../db.ts';
import { assignCluster, CLUSTER_WINDOW_MS } from './cluster.ts';
import { guessTopics, parseFeed } from './feed.ts';
import { fetchText } from './net.ts';
import { allSources, type NewsSource } from './sources.ts';

export const KEEP_MS = 3 * 24 * 3600_000;

export interface NewsRow { id: string; source_id: string; url: string; title: string; teaser: string; published_at: string; topics: string; cluster_id: string; fetched_at: string }

/** Lieblingsquellen der Nutzer sind eigene Quellen mit Kennung `fav:<Hash der Adresse>` */
export const favoriteId = (feedUrl: string) => `fav:${createHash('sha1').update(feedUrl).digest('hex').slice(0, 12)}`;

/** Alle Lieblings-Feeds aller Nutzer (ohne Doppelte) */
export function favoriteSources(): NewsSource[] {
  const seen = new Map<string, NewsSource>();
  for (const r of db.prepare('SELECT settings FROM users').all() as { settings: string }[]) {
    let fav: { name?: string; feedUrl?: string }[] = [];
    try { fav = JSON.parse(r.settings).news?.favorites ?? []; } catch { /* leer */ }
    for (const f of fav) {
      if (!f.feedUrl || !/^https?:\/\//i.test(f.feedUrl)) continue;
      const id = favoriteId(f.feedUrl);
      if (!seen.has(id)) seen.set(id, { id, name: String(f.name ?? f.feedUrl).slice(0, 80), country: 'INT', lang: '', topics: [], feedUrl: f.feedUrl, homepage: f.feedUrl });
    }
  }
  return [...seen.values()];
}

export function storeItems(sourceId: string, items: ReturnType<typeof parseFeed>['items']): number {
  const since = new Date(Date.now() - CLUSTER_WINDOW_MS * 2).toISOString();
  const recent = (db.prepare('SELECT id, title, published_at, cluster_id FROM news_items WHERE published_at > ?').all(since) as { id: string; title: string; published_at: string; cluster_id: string }[])
    .map((r) => ({ id: r.id, title: r.title, publishedAt: Date.parse(r.published_at), clusterId: r.cluster_id }));
  const insert = db.prepare('INSERT OR IGNORE INTO news_items (id, source_id, url, title, teaser, published_at, topics, cluster_id, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  let added = 0;
  const cutoff = Date.now() - KEEP_MS;
  db.transaction(() => {
    for (const it of items) {
      if (it.publishedAt < cutoff) continue;
      const id = newId();
      const clusterId = assignCluster({ id, title: it.title, publishedAt: it.publishedAt }, recent);
      const r = insert.run(id, sourceId, it.url, it.title, it.teaser, new Date(it.publishedAt).toISOString(), JSON.stringify(guessTopics(it.title, it.categories, it.teaser)), clusterId, now());
      if (r.changes) { added++; recent.push({ id, title: it.title, publishedAt: it.publishedAt, clusterId }); }
    }
  })();
  return added;
}

/** Eine Quelle abrufen (mit ETag / If-Modified-Since). Fehler werden gemerkt, nie geworfen. */
export async function fetchSource(source: NewsSource, strict = false): Promise<{ status: number | 'error'; added: number }> {
  const prev = db.prepare('SELECT etag, last_modified FROM news_feeds WHERE source_id = ?').get(source.id) as { etag: string | null; last_modified: string | null } | undefined;
  const save = (status: string, error: string | null, etag?: string | null, lastModified?: string | null) =>
    db.prepare(`INSERT INTO news_feeds (source_id, feed_url, etag, last_modified, status, error, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id) DO UPDATE SET feed_url = excluded.feed_url, etag = excluded.etag, last_modified = excluded.last_modified, status = excluded.status, error = excluded.error, fetched_at = excluded.fetched_at`)
      .run(source.id, source.feedUrl, etag ?? null, lastModified ?? null, status, error, now());
  try {
    const res = await fetchText(source.feedUrl, { strict, etag: prev?.etag ?? undefined, lastModified: prev?.last_modified ?? undefined });
    if (res.status === 304) { save('304', null, prev?.etag, prev?.last_modified); return { status: 304, added: 0 }; }
    if (res.status !== 200) { save(String(res.status), `HTTP ${res.status}`, prev?.etag, prev?.last_modified); return { status: res.status, added: 0 }; }
    const feed = parseFeed(res.body);
    const added = storeItems(source.id, feed.items);
    save('200', null, res.etag, res.lastModified);
    return { status: 200, added };
  } catch (err) {
    save('error', (err as Error).message.slice(0, 200), prev?.etag, prev?.last_modified);
    return { status: 'error', added: 0 };
  }
}

export function purgeNews() {
  db.prepare('DELETE FROM news_items WHERE published_at < ?').run(new Date(Date.now() - KEEP_MS).toISOString());
  db.prepare('DELETE FROM news_digest WHERE date < ?').run(new Date(Date.now() - 4 * 24 * 3600_000).toISOString().slice(0, 10));
}

/** Katalog und Lieblingsquellen abrufen, danach alte Meldungen löschen (alle 30 Minuten, zentral für alle) */
export async function fetchAllFeeds(): Promise<{ sources: number; added: number; failed: number }> {
  const sources = [...allSources(), ...favoriteSources()];
  let added = 0, failed = 0;
  for (let i = 0; i < sources.length; i += 6) {
    const batch = await Promise.all(sources.slice(i, i + 6).map((s) => fetchSource(s, s.id.startsWith('fav:'))));
    for (const r of batch) { added += r.added; if (r.status === 'error' || (typeof r.status === 'number' && r.status >= 400)) failed++; }
  }
  purgeNews();
  return { sources: sources.length, added, failed };
}
