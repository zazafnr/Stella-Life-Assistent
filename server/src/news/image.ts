// Bild für eine News-Karte, in dieser Reihenfolge:
//  1. das echte Hauptbild des Artikels (og:image / twitter:image der Artikelseite)
//  2. das Bild aus dem Feed
//  3. nur wenn es kein echtes gibt: ein KI-Bild zur Schlagzeile (OpenRouter, STELLA_NEWS_IMAGE_MODEL, "off" = aus)
//  4. im PC-Demo-Modus ohne KI-Schlüssel: ein gezeichnetes Platzhalterbild zum Thema
// Zuschneiden macht die Karte (Bild füllt sie aus, Mitte bleibt sichtbar). KI-Bilder liegen 3 Tage unter data/news-images.

import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.ts';
import { serverKey } from '../keys.ts';
import type { NewsTopic } from './sources.ts';

const DIR = path.join(config.dataDir, 'news-images');
const KEEP_MS = 3 * 24 * 3600_000;
const ROUTE = '/news-bilder';
const MODEL = process.env.STELLA_NEWS_IMAGE_MODEL ?? 'google/gemini-2.5-flash-image';

const DEMO_TOPIC: Partial<Record<NewsTopic, string>> = { politics: 'politik', economy: 'politik', tech: 'tech', science: 'wissenschaft', health: 'wissenschaft', climate: 'klima', sport: 'sport' };

export interface ImageInput { url: string; title: string; teaser?: string; feedImage?: string | null; topic?: NewsTopic }

/** Ergebnis: absolute https-Adresse (echtes Bild) oder ein Pfad auf diesem Server (KI-/Demo-Bild) */
export async function newsImage(item: ImageInput, articleImage: (url: string) => Promise<string | undefined>): Promise<string | undefined> {
  const real = [await articleImage(item.url), item.feedImage].find(isArticlePhoto);
  if (real) return real;
  const ai = await aiImage(item).catch(() => undefined);
  if (ai) return ai;
  if (process.env.STELLA_DEMO_BILDER) return `/demo-bilder/news-${DEMO_TOPIC[item.topic as NewsTopic] ?? 'wissenschaft'}.svg`;
  return undefined;
}

/** Kein echtes Artikelbild: das allgemeine Logo-/Ersatzbild, das manche Zeitungen bei jedem Artikel angeben */
export const isArticlePhoto = (u: string | null | undefined): u is string =>
  !!u && !/(fallback|placeholder|default[-_]?(image|share|og)|\blogo\b|[-_/]logo[-_.]|og[-_]default|share[-_]default)/i.test(u);

const fileFor =(url: string) => `${createHash('sha1').update(url).digest('hex').slice(0, 20)}.png`;

async function aiImage(item: ImageInput): Promise<string | undefined> {
  const name = fileFor(item.url);
  if (existsSync(path.join(DIR, name))) return `${ROUTE}/${name}`;
  if (MODEL === 'off' || !serverKey('openrouter')) return undefined;
  const prompt = [
    'Create a realistic editorial photo to illustrate this news headline for a news app card.',
    `Headline: ${item.title}`,
    item.teaser ? `Teaser: ${item.teaser.slice(0, 300)}` : '',
    'Rules: photographic look, neutral and calm, no text, no letters, no logos, no flags of real parties, no recognisable real people, nothing graphic or violent. Portrait format.',
  ].filter(Boolean).join('\n');
  const res = await fetch(`${config.openrouter.baseUrl}/chat/completions`, {
    method: 'POST',
    signal: AbortSignal.timeout(60_000),
    headers: { Authorization: `Bearer ${serverKey('openrouter')}`, 'Content-Type': 'application/json', 'HTTP-Referer': config.publicUrl, 'X-Title': 'Stella Life Assistant' },
    body: JSON.stringify({ model: MODEL, modalities: ['image', 'text'], image_config: { aspect_ratio: '4:5' }, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) return undefined;
  const json = (await res.json()) as { choices?: { message?: { images?: { image_url?: { url?: string } }[] } }[] };
  const data = json.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  const m = data && /^data:image\/[\w+]+;base64,(.+)$/.exec(data);
  if (!m) return undefined;
  mkdirSync(DIR, { recursive: true });
  purge();
  writeFileSync(path.join(DIR, name), Buffer.from(m[1]!, 'base64'));
  return `${ROUTE}/${name}`;
}

function purge() {
  try {
    for (const f of readdirSync(DIR)) {
      const p = path.join(DIR, f);
      if (Date.now() - statSync(p).mtimeMs > KEEP_MS) unlinkSync(p);
    }
  } catch { /* egal */ }
}

/** Öffentlich (Bilder laden ohne Login), Name ist ein Hash der Artikel-Adresse */
export function registerNewsImageRoute(app: FastifyInstance) {
  app.get(`${ROUTE}/:name`, async (req, reply) => {
    const { name } = req.params as { name: string };
    const file = path.join(DIR, name);
    if (!/^[0-9a-f]{20}\.png$/.test(name) || !existsSync(file)) return reply.code(404).send({ error: 'Nicht gefunden' });
    return reply.type('image/png').header('Cache-Control', 'public, max-age=86400').send(createReadStream(file));
  });
}
