import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import Fastify from 'fastify';
import { startMockClaude, text, type MockRequest } from './testing/mockClaude.ts';

// ---- Beispiel-Feeds ----
const now = Date.now();
const iso = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString();
const rfc = (minAgo: number) => new Date(now - minAgo * 60_000).toUTCString();
const rss = (title: string, items: string) => `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>${title}</title>${items}</channel></rss>`;
const item = (t: string, link: string, minAgo: number, desc = '', cat = '') =>
  `<item><title><![CDATA[${t}]]></title><link>${link}</link><pubDate>${rfc(minAgo)}</pubDate>${desc ? `<description><![CDATA[${desc}]]></description>` : ''}${cat ? `<category>${cat}</category>` : ''}</item>`;

const FEEDS: Record<string, { body: string; etag?: string }> = {
  '/orf.xml': { etag: '"v1"', body: rss('ORF News', [
    item('Regierung einigt sich auf neues Budget für 2027', 'https://orf.example/budget', 60, '<p>Die Koalition hat sich &amp;nbsp;geeinigt.</p>', 'Politik'),
    item('Neue KI-Software von Google sorgt für Aufsehen', 'https://orf.example/ki', 50, 'Ein neues Programm.'),
    item('Wetter: Schneefall in den Bergen erwartet', 'https://orf.example/wetter', 40),
    item('Fußball: Sturm Graz gewinnt Derby 2:1', 'https://orf.example/sturm', 30),
  ].join('')) },
  '/spiegel.xml': { body: rss('Spiegel', [
    item('Regierung einigt sich auf neues Budget 2027', 'https://spiegel.example/budget', 55),
    item('Forscher entdecken neuen Planeten', 'https://spiegel.example/planet', 20, '', 'Wissenschaft'),
  ].join('')) },
  '/atom.xml': { body: `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Atom Beispiel</title><entry><title>Atom Meldung &amp; mehr</title><link rel="alternate" href="https://atom.example/a1"/><link rel="self" href="https://atom.example/self"/><updated>${iso(10)}</updated><summary type="html">&lt;b&gt;Kurz&lt;/b&gt; zusammengefasst</summary><category term="Sport"/></entry><entry><title>Ohne Link</title></entry></feed>` },
  '/int.xml': { body: rss('World Desk', [
    item('World leaders meet in Geneva for peace talks', 'https://int.example/geneva', 70),
    item('Champions League final ends in penalty drama', 'https://int.example/final', 65),
    item('New vaccine approved for children', 'https://int.example/vaccine', 60),
    item('Stock markets fall after rate decision', 'https://int.example/stocks', 55),
    item('Mars rover finds traces of ancient water', 'https://int.example/mars', 45),
    item('Film festival opens with record crowds', 'https://int.example/film', 35),
    item('Heatwave grips southern Europe', 'https://int.example/heat', 25),
    item('Chip maker unveils faster processor', 'https://int.example/chip', 15),
  ].join('')) },
  '/rdf.xml': { body: `<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>RDF Beispiel</title></channel><item><title>RDF Meldung</title><link>https://rdf.example/1</link><dc:date>${iso(5)}</dc:date></item></rdf:RDF>` },
};
let feedHits: { url: string; inm?: string }[] = [];
// ---- OpenRouter-Mock: ein Aufruf pro Artikel mit Foto → Bildpunkt, Thema, Satz in allen Sprachen ----
const orRequests: { model: string; system: string; text: string; image?: string }[] = [];
let orMode: 'ok' | 'down' | 'garbage' | 'region' = 'ok';
const topicOf = (t: string) => (/Fußball|Champions|Atom Meldung/.test(t) ? 'sport' : /Planet|Mars/.test(t) ? 'science' : /vaccine/.test(t) ? 'health'
  : /Stock/.test(t) ? 'economy' : /Film/.test(t) ? 'culture' : /Heatwave/.test(t) ? 'climate' : /Chip|KI/.test(t) ? 'tech' : 'politics');
function openRouter(url: string, body: string, res: import('node:http').ServerResponse) {
  res.setHeader('Content-Type', 'application/json');
  if (url === '/or/models') { res.end(JSON.stringify({ data: [] })); return; }
  const b = JSON.parse(body) as { model: string; messages: { role: string; content: unknown }[] };
  const user = b.messages.find((m) => m.role === 'user')!.content;
  const parts = Array.isArray(user) ? user as { type: string; text?: string; image_url?: { url: string } }[] : [{ type: 'text', text: String(user) }];
  const text = parts.find((p) => p.type === 'text')?.text ?? '';
  orRequests.push({ model: b.model, system: String(b.messages[0]!.content), text, image: parts.find((p) => p.type === 'image_url')?.image_url?.url });
  if (orMode === 'down') { res.statusCode = 503; res.end('{"error":{"message":"down"}}'); return; }
  if (orMode === 'region' && b.model === 'openrouter/free') { res.statusCode = 403; res.end('{"error":{"message":"This model is not available in your region.","code":403}}'); return; }
  const headline = /^Headline: (.+)$/m.exec(text)?.[1] ?? '';
  const answer = orMode === 'garbage' ? 'Tut mir leid, das kann ich nicht.'
    : '```json\n' + JSON.stringify({ focus: { x: 0.3, y: 0.2 }, topic: topicOf(headline), sentences: Object.fromEntries(['en', 'de', 'es', 'fr', 'it', 'pt-BR', 'tr', 'pl'].map((l) => [l, `${l}: Satz zu ${headline}. Zweiter Satz, der weg muss.`])) }) + '\n```';
  res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: answer } }] }));
}
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(4096, 7)]);

const web = createServer((req, res) => {
  const url = req.url ?? '';
  if (url.startsWith('/or/')) { let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => openRouter(url, body, res)); return; }
  if (url.startsWith('/img/')) { res.setHeader('Content-Type', url.endsWith('.txt') ? 'text/plain' : 'image/jpeg'); res.end(JPEG); return; }
  feedHits.push({ url, inm: req.headers['if-none-match'] as string | undefined });
  if (FEEDS[url]) {
    const f = FEEDS[url]!;
    if (f.etag && req.headers['if-none-match'] === f.etag) { res.statusCode = 304; res.end(); return; }
    res.setHeader('Content-Type', 'application/rss+xml'); if (f.etag) res.setHeader('ETag', f.etag);
    res.end(f.body); return;
  }
  if (url === '/' || url === '/site-with-feed') {
    res.setHeader('Content-Type', 'text/html');
    res.end(`<html><head><link rel="alternate" type="application/rss+xml" title="Hauptfeed" href="/orf.xml"><link rel="stylesheet" href="/x.css"></head><body>Hallo</body></html>`); return;
  }
  if (url === '/site-without-feed') { res.setHeader('Content-Type', 'text/html'); res.end('<html><head></head><body>kein Feed</body></html>'); return; }
  res.statusCode = 404; res.end('nicht da');
});
await new Promise<void>((r) => web.listen(0, r));
const base = `http://127.0.0.1:${(web.address() as AddressInfo).port}`;

// ---- Claude-Mock: die News brauchen Claude nicht mehr – jeder Aufruf hier wäre ein Fehler ----
const claudeRequests: MockRequest[] = [];
const claude = await startMockClaude((req) => { claudeRequests.push(req); return text('ok'); });
after(() => { web.close(); return claude.close(); });

process.env.STELLA_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'stella-news-'));
process.env.STELLA_SECRET = 'test-secret-1234567890';
process.env.STELLA_ALLOW_REGISTRATION = 'true';
process.env.OPENROUTER_API_KEY = 'sk-or-test';
process.env.OPENROUTER_BASE_URL = `${base}/or`;
process.env.STELLA_VISION_MODELS = 'test/vision:free';
process.env.GROQ_API_KEY = '';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key-123456';
process.env.ANTHROPIC_BASE_URL = claude.url;
process.env.STELLA_CLAUDE_RETRY_MS = '5';
process.env.STELLA_NEWS_ALLOW_PRIVATE = 'true';

const { config } = await import('./config.ts');
const { register, HttpError, requireUser } = await import('./auth.ts');
const { db, getUser, updateUserSettings, recentMessages } = await import('./db.ts');
const { parseFeed, guessTopics, findFeedLinks, plain } = await import('./news/feed.ts');
const { titleWords, jaccard, assignCluster } = await import('./news/cluster.ts');
const { setSourcesForTests } = await import('./news/sources.ts');
const store = await import('./news/store.ts');
const digest = await import('./news/digest.ts');
const { askDue, maybeAskNews } = await import('./news/ask.ts');
const { registerNewsRoutes, findFavoriteFeed } = await import('./news/routes.ts');
const net = await import('./news/net.ts');
const { buildBriefing } = await import('./briefing.ts');
const { usageToday } = await import('./llm.ts');
const { giftPlan } = await import('./billing.ts');
const { setPushForTests } = await import('./channels/deliver.ts');
const pushes: string[] = [];
setPushForTests(async (_id, p) => { pushes.push(p.body); });

const SOURCES = [
  { id: 'orf', name: 'ORF', country: 'AT' as const, lang: 'de', topics: [], feedUrl: `${base}/orf.xml`, homepage: base },
  { id: 'spiegel', name: 'Der Spiegel', country: 'DE' as const, lang: 'de', topics: [], feedUrl: `${base}/spiegel.xml`, homepage: base },
  { id: 'atom', name: 'Atom Beispiel', country: 'INT' as const, lang: 'en', topics: [], feedUrl: `${base}/atom.xml`, homepage: base },
  { id: 'world', name: 'World Desk', country: 'INT' as const, lang: 'en', topics: [], feedUrl: `${base}/int.xml`, homepage: base },
];
setSourcesForTests(SOURCES);

const app = Fastify();
app.setErrorHandler((err: Error, _req, reply) => reply.code(err instanceof HttpError ? err.status : 500).send({ error: err.message }));
await app.register(async (api) => { api.addHook('preHandler', requireUser); registerNewsRoutes(api); });
await app.ready();
after(() => app.close());

const owner = register('Owner', 'owner@example.com', 'supergeheim', 'Europe/Vienna');
let n = 0;
const mk = (settings: Record<string, unknown> = {}) => {
  const r = register(`Nutzer${++n}`, `n${n}@example.com`, 'supergeheim', 'Europe/Vienna');
  updateUserSettings(r.user.id, { locale: 'de', country: 'AT', ...settings });
  return { id: r.user.id, token: r.token, get: () => getUser(r.user.id)! };
};
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

test('Feed-Parser: RSS mit CDATA und doppelt kodierten Entitäten, Atom, RDF; Einträge ohne Link fallen weg', () => {
  const r = parseFeed(FEEDS['/orf.xml']!.body);
  assert.equal(r.title, 'ORF News');
  assert.equal(r.items.length, 4);
  assert.equal(r.items[0]!.title, 'Regierung einigt sich auf neues Budget für 2027');
  assert.equal(r.items[0]!.teaser, 'Die Koalition hat sich geeinigt.', 'HTML und Entitäten bereinigt');
  assert.deepEqual(r.items[0]!.categories, ['Politik']);
  assert.ok(Math.abs(r.items[0]!.publishedAt - (now - 3600_000)) < 2000);

  const a = parseFeed(FEEDS['/atom.xml']!.body);
  assert.equal(a.items.length, 1, 'Eintrag ohne Link entfällt');
  assert.equal(a.items[0]!.url, 'https://atom.example/a1', 'rel=alternate gewinnt gegen rel=self');
  assert.equal(a.items[0]!.title, 'Atom Meldung & mehr');
  assert.equal(a.items[0]!.teaser, 'Kurz zusammengefasst');
  assert.deepEqual(a.items[0]!.categories, ['Sport']);

  const d = parseFeed(FEEDS['/rdf.xml']!.body);
  assert.equal(d.items[0]!.url, 'https://rdf.example/1');
  assert.ok(Math.abs(d.items[0]!.publishedAt - (now - 300_000)) < 2000);
  assert.equal(plain('<p>A&nbsp;&amp;&nbsp;B</p>'), 'A & B');
  assert.equal(parseFeed('kein XML').items.length, 0);
});

test('Themen: aus Feed-Kategorien und Stichwörtern in mehreren Sprachen, ohne Treffer „Allgemeines“ (politics)', () => {
  assert.deepEqual(guessTopics('Sturm Graz gewinnt Derby', ['Sport']), ['sport']);
  assert.ok(guessTopics('Neue KI-Software von Google').includes('tech'));
  assert.ok(guessTopics('La inflación baja en España').includes('economy'));
  assert.ok(guessTopics('Il governo approva la riforma').includes('politics'));
  assert.ok(guessTopics('Hava durumu: kar bekleniyor ama iklim değişikliği').includes('climate'));
  assert.ok(guessTopics('Nowe badania naukowców o kosmosie').includes('science'));
  assert.deepEqual(guessTopics('Irgendwas Allgemeines'), ['politics']);
});

test('Gruppieren: Jaccard ≥ 0,5 innerhalb von 12 Stunden', () => {
  const a = 'Regierung einigt sich auf neues Budget für 2027', b = 'Regierung einigt sich auf neues Budget 2027', c = 'Forscher entdecken neuen Planeten';
  assert.ok(jaccard(titleWords(a), titleWords(b)) >= 0.5);
  assert.ok(jaccard(titleWords(a), titleWords(c)) < 0.2);
  const t = Date.now();
  const recent = [{ id: 'x1', title: a, publishedAt: t, clusterId: 'x1' }];
  assert.equal(assignCluster({ id: 'x2', title: b, publishedAt: t + 3600_000 }, recent), 'x1');
  assert.equal(assignCluster({ id: 'x3', title: c, publishedAt: t }, recent), 'x3');
  assert.equal(assignCluster({ id: 'x4', title: b, publishedAt: t + 13 * 3600_000 }, recent), 'x4', 'nach 12 Stunden eine neue Geschichte');
});

test('Abruf: speichert nur Titel, Teaser, Link; ETag → 304; keine Doppelten; Fehler werden gemerkt', async () => {
  feedHits = [];
  const r1 = await store.fetchSource(SOURCES[0]!);
  assert.deepEqual(r1, { status: 200, added: 4 });
  const row = db.prepare('SELECT * FROM news_items WHERE url = ?').get('https://orf.example/budget') as Record<string, string>;
  assert.deepEqual(Object.keys(row).sort(), ['cluster_id', 'fetched_at', 'id', 'image', 'published_at', 'source_id', 'teaser', 'title', 'topics', 'url'], 'kein Artikeltext-Feld');
  const r2 = await store.fetchSource(SOURCES[0]!);
  assert.deepEqual(r2, { status: 304, added: 0 });
  assert.equal(feedHits.at(-1)!.inm, '"v1"', 'If-None-Match wird mitgeschickt');
  await store.fetchSource(SOURCES[1]!); await store.fetchSource(SOURCES[2]!);
  assert.equal((await store.fetchSource(SOURCES[1]!)).added, 0, 'zweiter Abruf bringt nichts Neues');
  const bad = await store.fetchSource({ ...SOURCES[0]!, id: 'tot', feedUrl: `${base}/gibt-es-nicht.xml` });
  assert.equal(bad.status, 404);
  assert.equal((db.prepare('SELECT status FROM news_feeds WHERE source_id = ?').get('tot') as { status: string }).status, '404');
  // dieselbe Geschichte bei zwei Quellen → eine Gruppe
  const c = db.prepare('SELECT cluster_id FROM news_items WHERE url IN (?, ?)').all('https://orf.example/budget', 'https://spiegel.example/budget') as { cluster_id: string }[];
  assert.equal(c[0]!.cluster_id, c[1]!.cluster_id);
  // Löschen nach 3 Tagen
  db.prepare('UPDATE news_items SET published_at = ? WHERE url = ?').run(new Date(Date.now() - 4 * 86400_000).toISOString(), 'https://orf.example/wetter');
  store.purgeNews();
  assert.equal(db.prepare('SELECT 1 FROM news_items WHERE url = ?').get('https://orf.example/wetter'), undefined);
});

// ---- Tagesausgabe und Auswahl ----
const utcAt = (hour: number) => { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour, 0); };
const resetNews = () => { db.exec('DELETE FROM news_prepared; DELETE FROM news_edition; DELETE FROM news_digest; DELETE FROM llm_usage;'); digest.resetEnrichStateForTests(); };
/** Bilder setzen: KI-Meldung ohne Bild, beim Chip-Artikel lädt statt eines Bildes eine Textdatei */
async function prepareFeeds() {
  await store.fetchSource(SOURCES[3]!);
  for (const r of db.prepare('SELECT url FROM news_items').all() as { url: string }[]) {
    if (r.url.endsWith('/ki')) continue;
    const name = r.url.replace(/\W+/g, '-');
    db.prepare('UPDATE news_items SET image = ? WHERE url = ?').run(`${base}/img/${name}${r.url.endsWith('/chip') ? '.txt' : '.jpg'}`, r.url);
  }
}
const editionUrls = (country: string) => JSON.parse((db.prepare('SELECT urls FROM news_edition WHERE country = ?').get(country) as { urls: string } | undefined)?.urls ?? '[]') as string[];

test('Tagesausgabe: 20 international + 3 je Land, nur mit Bild, je Artikel EINE Anfrage bei OpenRouter (Bildpunkt, Thema, alle Sprachen)', async () => {
  await prepareFeeds();
  resetNews();
  orRequests.length = 0; orMode = 'ok';
  assert.equal(digest.INT_SIZE + digest.LOCAL_EDITIONS.length * digest.LOCAL_SIZE, 50, 'genau das Gratis-Kontingent');
  assert.deepEqual([digest.topicCap(20, 'politics'), digest.topicCap(20, 'sport'), digest.topicCap(3, 'politics')], [6, 4, 1]);

  await digest.buildEditions(utcAt(2));
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM news_edition').get() as { n: number }).n, 0, 'vor 3 Uhr UTC wird nicht gebaut');

  await digest.buildEditions(utcAt(5));
  const int = editionUrls('INT'), at = editionUrls('AT'), de = editionUrls('DE');
  assert.equal(int.length, 8, 'neun Geschichten, aber beim Chip-Artikel lädt kein Bild');
  assert.ok(!int.includes('https://int.example/chip'));
  assert.deepEqual(at.sort(), ['https://orf.example/budget', 'https://orf.example/sturm'], 'KI-Meldung ohne Bild fällt weg');
  assert.equal(de.length, 2);
  assert.equal(orRequests.length, 12, 'eine Anfrage pro Artikel');
  assert.equal(usageToday(), 12, 'zählt zum Tageslimit');
  assert.equal(claudeRequests.length, 0, 'Claude wird für die News nicht gebraucht');

  const r = orRequests[0]!;
  assert.equal(r.model, 'openrouter/free', 'zuerst der Router – er nimmt ein Modell, das gerade frei ist');
  assert.match(r.image ?? '', /^data:image\/jpeg;base64,/, 'das Foto geht mit');
  for (const want of ['German', 'Brazilian Portuguese', 'Turkish', 'Polish', 'focus', 'strictly sober tone', 'no matter how the reader likes to be addressed']) assert.ok(r.system.includes(want), want);
  const p = db.prepare('SELECT * FROM news_prepared WHERE url = ?').get('https://int.example/final') as { focus: string; topic: string; sentences: string };
  assert.equal(p.focus, '0.3,0.2');
  assert.equal(p.topic, 'sport');
  assert.equal(Object.keys(JSON.parse(p.sentences)).length, 8, 'alle 8 Sprachen');
  assert.equal(JSON.parse(p.sentences).de, 'de: Satz zu Champions League final ends in penalty drama.', 'nur der erste Satz');

  await digest.buildEditions(utcAt(6));
  assert.equal(orRequests.length, 12, 'am selben Tag nichts doppelt');
});

test('Auswahl: Free 1 lokal + 2 international, bezahlt 2 + 6; Themen gehen vor; Länder ohne Ausgabe nur international', async () => {
  const fromAt = (urls: string[]) => urls.filter((u) => u.startsWith('https://orf.') || u.startsWith('https://spiegel.')).length;
  config.defaultPlan = 'free';
  const free = mk();
  digest.saveNews(free.get(), { enabled: true, topics: [], countries: ['AT', 'INT'] });
  const ef = await digest.buildDigest(free.get());
  assert.equal(ef.length, 3);
  assert.equal(fromAt(ef.map((e) => e.url)), 1, 'eine lokale');
  assert.equal(ef[0]!.url, 'https://orf.example/budget', 'die Geschichte mit zwei Quellen steht vorn');
  assert.ok(ef.every((e) => e.image?.startsWith(`${base}/img/`) && e.focus?.x === 0.3 && e.focus?.y === 0.2 && e.sentence.startsWith('de: ')));

  const fan = mk();
  digest.saveNews(fan.get(), { enabled: true, topics: ['sport'], countries: ['AT', 'INT'] });
  assert.deepEqual((await digest.buildDigest(fan.get())).map((e) => e.url).sort(), ['https://atom.example/a1', 'https://int.example/final', 'https://orf.example/sturm']);

  const tr = mk({ country: 'TR', locale: 'tr' });
  digest.saveNews(tr.get(), { enabled: true, topics: [], countries: ['TR', 'INT'] });
  const et = await digest.buildDigest(tr.get());
  assert.equal(et.length, 3);
  assert.equal(fromAt(et.map((e) => e.url)), 0, 'Türkei hat (noch) keine Ausgabe → nur international');
  assert.ok(et.every((e) => e.sentence.startsWith('tr: ')), 'Satz in der Sprache der Person');

  config.defaultPlan = 'plus';
  const plus = mk();
  digest.saveNews(plus.get(), { enabled: true, topics: [], countries: ['AT', 'DE', 'INT'] });
  const ep = await digest.buildDigest(plus.get());
  assert.equal(ep.length, 8);
  assert.equal(fromAt(ep.map((e) => e.url)), 2, 'zwei lokale');
  assert.equal(ep.filter((e) => e.url.endsWith('/budget')).length, 1, 'eine Geschichte nur einmal');
  const few = mk();
  digest.saveNews(few.get(), { enabled: true, topics: [], countries: ['AT', 'INT'], count: 2 });
  assert.equal((await digest.buildDigest(few.get())).length, 2, 'eigene kleinere Zahl');
  config.defaultPlan = 'max';
  assert.equal(claudeRequests.length, 0);
  assert.deepEqual(await digest.buildDigest(mk().get()), [], 'ausgeschaltet → nichts');
});

test('Tagesausgabe: KI weg oder Kontingent leer → Schlagzeile und Bildmitte; später mit Restkontingent nachgeholt', async () => {
  resetNews();
  orRequests.length = 0; orMode = 'down';
  await digest.buildEditions(utcAt(5));
  assert.equal(editionUrls('INT').length, 8, 'die Ausgabe gibt es trotzdem');
  assert.ok(orRequests.length <= (3 + 2) * 2, `nach drei Fehlschlägen in Folge Schluss (${orRequests.length})`);
  const failed = orRequests.length;
  await digest.buildEditions(utcAt(6));
  assert.equal(orRequests.length, failed, 'kein neuer Versuch innerhalb von 2 Stunden');
  config.defaultPlan = 'free';
  const u = mk();
  digest.saveNews(u.get(), { enabled: true, topics: [], countries: ['AT', 'INT'] });
  const e = await digest.buildDigest(u.get());
  assert.ok(e.length === 3 && e.every((x) => !x.focus && !x.sentence.startsWith('de: ') && x.image));
  assert.ok(e.some((x) => x.sentence === 'Regierung einigt sich auf neues Budget für 2027'), 'Schlagzeile als Satz');

  // Kontingent aufgebraucht: keine Anfrage mehr
  orMode = 'ok';
  const limit = config.openrouter.dailyLimit;
  config.openrouter.dailyLimit = usageToday();
  const before = orRequests.length;
  await digest.buildEditions(utcAt(8));
  assert.equal(orRequests.length, before);
  // wieder Platz: fehlende Artikel werden nachgeholt
  config.openrouter.dailyLimit = limit + 100;
  await digest.buildEditions(utcAt(9));
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM news_prepared WHERE focus IS NOT NULL').get() as { n: number }).n, 12);
  config.openrouter.dailyLimit = limit;
  config.defaultPlan = 'max';

  // unbrauchbare Antwort zählt als Fehlschlag
  assert.equal(digest.readEnrichment(digest.parseJsonObject('Tut mir leid.'), 'Titel'), null);
  assert.deepEqual(digest.readEnrichment({ focus: { x: 7, y: -1 }, sentences: { de: 'Ein Satz. Noch einer.', xx: 'egal' }, topic: 'quatsch' }, 'Titel'),
    { focus: '1,0', topic: null, sentences: { de: 'Ein Satz.' } });
  assert.equal(digest.oneSentence('Kurz 🎉', 'Titel'), 'Titel');
});

test('Modell in unserer Region gesperrt (403): danach übersprungen statt bei jedem Artikel neu gefragt', async () => {
  resetNews();
  orRequests.length = 0; orMode = 'region';
  await digest.buildEditions(utcAt(5));
  assert.ok(orRequests.filter((r) => r.model === 'openrouter/free').length <= 3, 'der gesperrte Router nur bei den ersten drei gleichzeitigen Artikeln');
  assert.equal(orRequests.filter((r) => r.model === 'test/vision:free').length, 12, 'die anderen mit dem nächsten Modell');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM news_prepared WHERE focus IS NOT NULL').get() as { n: number }).n, 12);
  orMode = 'ok';
});

test('Frisch gestarteter Server ohne Ausgabe: die wichtigsten Meldungen mit Bild, ohne KI', async () => {
  resetNews();
  orRequests.length = 0;
  config.defaultPlan = 'free';
  const u = mk();
  digest.saveNews(u.get(), { enabled: true, topics: [], countries: ['AT', 'INT'] });
  const e = await digest.buildDigest(u.get());
  config.defaultPlan = 'max';
  assert.equal(e.length, 3);
  assert.ok(e.every((x) => x.image && !x.url.endsWith('/ki') && !x.url.endsWith('/chip')), 'nur mit Bild');
  assert.equal(orRequests.length, 0);
  // danach wieder eine richtige Ausgabe für die folgenden Tests
  resetNews();
  orMode = 'ok';
  await digest.buildEditions(utcAt(5));
});

test('Themen: Masern sind Gesundheit, Tennis ist Sport – auch wenn im Anriss Politik-Wörter stehen', () => {
  assert.equal(guessTopics('USA verlieren laut Berichten Status als masernfreies Land')[0], 'health');
  assert.equal(guessTopics('Tennis: Sabalenka scheitert bei WTA Finals', [], 'Die Zweite unterliegt der Ukrainerin Switolina.')[0], 'sport');
});

test('Briefing: Abschnitt „News“ mit Link und Quelle, Karte nur mit Meldungen', async () => {
  const u = mk();
  digest.saveNews(u.get(), { enabled: true, topics: [], countries: ['AT'] });
  assert.ok(!buildBriefing(u.get()).sections.some((s) => s.id === 'news'), 'vor dem Bauen noch nichts');
  await digest.buildDigest(u.get());
  const b = buildBriefing(u.get());
  const sec = b.sections.find((s) => s.id === 'news')!;
  assert.equal(sec.title, 'News');
  assert.match(sec.lines[0]!, /^de: Satz zu .+\. \(\[[^\]]+\]\(https:\/\/[^)]+\), \d{2}:\d{2}\)$/);
  assert.ok(b.news!.length >= 3);
  assert.ok(b.text.includes('**News**'));
  assert.equal(buildBriefing(mk().get()).news, undefined);
});

test('Frage am ersten Tag: früh genug, nicht nachts, nicht zu alt – und genau einmal', async () => {
  const h = 3600_000, tz = 'Europe/Vienna';
  const at = (hour: number, min = 0) => Date.parse(`2026-11-04T${String(hour - 1).padStart(2, '0')}:${String(min).padStart(2, '0')}:00Z`); // Wien im Winter = UTC+1
  const created = at(9) - 4 * h; // 4 Stunden vorher
  assert.equal(askDue(created, tz, at(10)), true);
  assert.equal(askDue(created, tz, at(19, 59)), true);
  assert.equal(askDue(created, tz, at(20)), false, 'ab 20 Uhr nicht mehr');
  assert.equal(askDue(created, tz, at(9, 59)), false, 'vor 10 Uhr nicht');
  assert.equal(askDue(at(11), tz, at(13)), false, 'frühestens 3 Stunden nach der Registrierung');
  assert.equal(askDue(at(11), tz, at(14)), true);
  assert.equal(askDue(at(22), tz, at(22) + 3 * h), false, 'nachts nicht – kommt am nächsten Tag um 10 Uhr');
  assert.equal(askDue(at(22), tz, at(22) + 12 * h), true, 'am nächsten Tag um 10 Uhr');
  assert.equal(askDue(at(10), tz, at(10) + 37 * h), false, 'Konto älter als 36 Stunden');

  const u = mk();
  db.prepare('UPDATE users SET created_at = ? WHERE id = ?').run(new Date(Date.now() - 5 * h).toISOString(), u.id);
  const hourNow = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: tz }).format(new Date()));
  const inWindow = hourNow >= 10 && hourNow < 20;
  const sendNow = Date.now() + (inWindow ? 0 : ((10 - hourNow + 24) % 24) * h + 60_000);
  pushes.length = 0;
  assert.equal(await maybeAskNews(u.id, sendNow - (inWindow ? 0 : 0)), inWindow || sendNow - Date.parse(new Date(Date.now() - 5 * h).toISOString()) < 36 * h);
  const msgs = recentMessages(u.id, 10).filter((m) => m.card?.type === 'news_ask');
  if (msgs.length) {
    assert.equal(msgs[0]!.text, 'Soll ich dir morgens kurz sagen, was in der Welt los ist?');
    assert.equal(pushes.length, 1, 'auch per Push, wenn die App nicht offen ist');
    assert.equal(await maybeAskNews(u.id, sendNow), false, 'genau einmal');
    assert.equal(recentMessages(u.id, 10).filter((m) => m.card?.type === 'news_ask').length, 1);
  }
  const asked = mk(); digest.saveNews(asked.get(), { asked: true });
  db.prepare('UPDATE users SET created_at = ? WHERE id = ?').run(new Date(Date.now() - 5 * h).toISOString(), asked.id);
  assert.equal(await maybeAskNews(asked.id, Date.now()), false, 'schon beantwortet');
});

test('Lieblingszeitung: Feed auf der Startseite finden, Katalog nach Namen, kein Feed → Meldung', async () => {
  const links = findFeedLinks('<link rel="alternate" type="application/atom+xml" href="/a.xml"><link rel="alternate" type="application/rss+xml" title="X" href="https://x.example/r.xml"><link rel="stylesheet" href="s.css">', 'https://site.example/start');
  assert.deepEqual(links.map((l) => l.feedUrl), ['https://site.example/a.xml', 'https://x.example/r.xml']);
  const found = await findFavoriteFeed(`${base}/site-with-feed`);
  assert.equal(found!.feedUrl, `${base}/orf.xml`);
  assert.equal(found!.name, 'ORF News');
  assert.equal(found!.sample.length, 3);
  assert.equal((await findFavoriteFeed('ORF'))!.feedUrl, `${base}/orf.xml`, 'Name aus dem Katalog');
  assert.equal(await findFavoriteFeed(`${base}/site-without-feed`), null);
  assert.equal(await findFavoriteFeed(`${base}/atom.xml`).then((f) => f?.name), 'Atom Beispiel', 'die Adresse ist selbst ein Feed');

  const pro = mk(); const free = mk(); giftPlan(free.id, 'free', null);
  const r = await app.inject({ method: 'POST', url: '/api/news/feed-search', headers: auth(pro.token), payload: { query: `${base}/site-without-feed` } });
  assert.equal(r.statusCode, 404);
  assert.equal((r.json() as { error: string }).error, 'Für diese Seite finde ich leider keinen Feed.');
  const ok = await app.inject({ method: 'POST', url: '/api/news/feed-search', headers: auth(pro.token), payload: { query: `${base}/site-with-feed` } });
  assert.equal(ok.statusCode, 200);
  const denied = await app.inject({ method: 'POST', url: '/api/news/feed-search', headers: auth(free.token), payload: { query: 'orf' } });
  assert.equal(denied.statusCode, 402);
});

test('Sicherheit: eigene Adressen dürfen nie auf interne Rechner zeigen', async () => {
  net.netOptions.allowPrivate = false;
  try {
    for (const bad of ['http://127.0.0.1:1/feed', 'http://192.168.1.10/x', 'http://[::1]/x', 'http://10.0.0.5/', 'ftp://example.com/x', 'http://user:pw@example.com/']) {
      await assert.rejects(net.assertPublicUrl(bad), net.UnsafeUrl, bad);
    }
    await assert.rejects(findFavoriteFeed('http://127.0.0.1:1/feed'), /nicht erlaubt/);
  } finally { net.netOptions.allowPrivate = true; }
});

test('Einstellungen per Route: Themen, Länder, Anzahl; Lieblingsquellen nur ab Pro; „Nein danke“ und „Ja, gern“', async () => {
  const u = mk();
  const put = (token: string, body: unknown) => app.inject({ method: 'PUT', url: '/api/news', headers: auth(token), payload: body as object });
  const r = await put(u.token, { enabled: true, topics: ['sport', 'quatsch'], countries: ['AT', 'XX'], count: 50, favorites: [{ name: 'ORF', feedUrl: `${base}/orf.xml` }] });
  assert.equal(r.statusCode, 200);
  const s = digest.newsSettings(u.get());
  assert.deepEqual([s.enabled, s.topics, s.countries, s.count, s.favorites.length], [true, ['sport'], ['AT'], 10, 1]);
  assert.equal(store.favoriteSources().some((f) => f.feedUrl === `${base}/orf.xml`), true);

  const plus = mk(); giftPlan(plus.id, 'plus', null);
  assert.equal((await put(plus.token, { favorites: [{ name: 'X', feedUrl: 'https://x.example/f.xml' }] })).statusCode, 402);

  const no = mk();
  await app.inject({ method: 'POST', url: '/api/news/answer', headers: auth(no.token), payload: { answer: 'no' } });
  assert.deepEqual([digest.newsSettings(no.get()).enabled, digest.newsSettings(no.get()).asked], [false, true]);
  const yes = mk();
  await app.inject({ method: 'POST', url: '/api/news/answer', headers: auth(yes.token), payload: { answer: 'yes' } });
  const ys = digest.newsSettings(yes.get());
  assert.deepEqual([ys.enabled, ys.asked, ys.countries], [true, true, ['AT', 'INT']]);
  const v = await app.inject({ method: 'GET', url: '/api/news', headers: auth(yes.token) });
  const view = v.json() as { sources: { id: string }[]; topics: string[]; limits: { count: number } };
  assert.ok(view.sources.some((x) => x.id === 'orf') && view.topics.length === 9 && view.limits.count === 8);
});

test('Alle Abrufe zusammen: Katalog + Lieblingsquellen, Fehler zählen, alte Meldungen weg', async () => {
  const r = await store.fetchAllFeeds();
  assert.ok(r.sources >= 4);
  assert.equal(r.failed, 0);
  assert.ok(owner.user.id);
});

test('Zeichensatz: ISO-8859-1 aus dem XML-Kopf oder Content-Type wird richtig gelesen, sonst UTF-8', () => {
  const latin = Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><title>ambição</title>', 'latin1');
  assert.match(net.decode(latin, 'application/xml'), /ambição/);
  assert.match(net.decode(Buffer.from('<title>ambição</title>', 'latin1'), 'text/xml; charset=iso-8859-1'), /ambição/);
  assert.match(net.decode(Buffer.from('<title>Überraschung</title>', 'utf8'), null), /Überraschung/);
});

test('News: Vorschaubild aus dem Feed (media, Enclosure, <img>) und og:image der Seite, nur https', async () => {
  const { itemImage } = await import('./news/feed.ts');
  const { pageImage } = await import('./news/digest.ts');
  assert.equal(itemImage('<title>x</title><media:content url="https://a.at/1.jpg" medium="image"/>'), 'https://a.at/1.jpg');
  assert.equal(itemImage('<media:content url="https://a.at/v.mp4" type="video/mp4"/><enclosure url="https://a.at/2.png" type="image/png"/>'), 'https://a.at/2.png');
  assert.equal(itemImage('<description><![CDATA[<p><img src="https://a.at/3.webp"> Text</p>]]></description>'), 'https://a.at/3.webp');
  assert.equal(itemImage('<description>&lt;img src="http://a.at/unsicher.jpg"&gt;</description>'), undefined);
  assert.equal(pageImage('<head><meta property="og:image" content="https://b.at/og.jpg?w=1200&amp;h=630"></head>'), 'https://b.at/og.jpg?w=1200&h=630');
  assert.equal(pageImage('<meta name="description" content="https://nope">'), undefined);
});
