import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import Fastify from 'fastify';
import { startMockClaude, text, httpError, type MockRequest } from './testing/mockClaude.ts';

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
  '/rdf.xml': { body: `<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>RDF Beispiel</title></channel><item><title>RDF Meldung</title><link>https://rdf.example/1</link><dc:date>${iso(5)}</dc:date></item></rdf:RDF>` },
};
let feedHits: { url: string; inm?: string }[] = [];
const web = createServer((req, res) => {
  const url = req.url ?? '';
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

// ---- Claude-Mock: Kurzfassungen ----
const summaryRequests: MockRequest[] = [];
let summaryMode: 'ok' | 'down' | 'wrongCount' | 'multi' = 'ok';
const claude = await startMockClaude((req) => {
  const sys = JSON.stringify(req.body.system ?? '');
  if (sys.includes('one-sentence summaries')) {
    summaryRequests.push(req);
    if (summaryMode === 'down') return httpError(500);
    const content = String(req.body.messages?.[0]?.content?.[0]?.text ?? req.body.messages?.[0]?.content ?? '');
    const n = content.split('\n').filter((l) => /^\d+\. /.test(l)).length;
    if (summaryMode === 'wrongCount') return text(JSON.stringify({ sentences: ['nur einer'] }));
    if (summaryMode === 'multi') return text(JSON.stringify({ sentences: Array.from({ length: n }, (_, i) => `Erster Satz ${i}. Zweiter Satz, der weg muss. Dritter.`) }));
    return text(JSON.stringify({ sentences: Array.from({ length: n }, (_, i) => `Kurzfassung Nummer ${i + 1} zum Thema.`) }));
  }
  return text('ok');
});
after(() => { web.close(); return claude.close(); });

process.env.STELLA_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'stella-news-'));
process.env.STELLA_SECRET = 'test-secret-1234567890';
process.env.STELLA_ALLOW_REGISTRATION = 'true';
process.env.OPENROUTER_API_KEY = '';
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
const { giftPlan } = await import('./billing.ts');
const { setPushForTests } = await import('./channels/deliver.ts');
const pushes: string[] = [];
setPushForTests(async (_id, p) => { pushes.push(p.body); });

const SOURCES = [
  { id: 'orf', name: 'ORF', country: 'AT' as const, lang: 'de', topics: [], feedUrl: `${base}/orf.xml`, homepage: base },
  { id: 'spiegel', name: 'Der Spiegel', country: 'DE' as const, lang: 'de', topics: [], feedUrl: `${base}/spiegel.xml`, homepage: base },
  { id: 'atom', name: 'Atom Beispiel', country: 'INT' as const, lang: 'en', topics: [], feedUrl: `${base}/atom.xml`, homepage: base },
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

test('Auswahl nach Vorlieben: Länder, Themen, eine Meldung pro Geschichte, Rangfolge, Anzahl je Abo', () => {
  config.defaultPlan = 'free';
  const u = mk();
  digest.saveNews(u.get(), { enabled: true, topics: [], countries: ['AT', 'DE'] });
  const all = digest.selectNews(u.get());
  const urls = all.map((c) => c.row.url);
  assert.equal(urls.filter((x) => x.endsWith('/budget')).length, 1, 'höchstens eine Meldung pro Gruppe');
  assert.equal(urls[0]!.endsWith('/budget'), true, 'die Geschichte mit zwei Quellen steht vorn');
  assert.equal(all.length, 3, 'Free: höchstens 3');
  assert.ok(!urls.some((x) => x.startsWith('https://atom.example')), 'INT nicht gewählt');

  digest.saveNews(u.get(), { topics: ['sport'] });
  assert.deepEqual(digest.selectNews(u.get()).map((c) => c.row.url), ['https://orf.example/sturm']);

  config.defaultPlan = 'plus';
  const p = mk();
  digest.saveNews(p.get(), { enabled: true, topics: [], countries: ['AT', 'DE', 'INT'] });
  assert.equal(digest.selectNews(p.get()).length, 5, 'Plus: 5');
  digest.saveNews(p.get(), { count: 2 });
  assert.equal(digest.selectNews(p.get()).length, 2, 'eigene kleinere Zahl');
  // „neu seit dem letzten Briefing“
  digest.saveNews(p.get(), { count: 5, lastAt: new Date().toISOString() });
  assert.equal(digest.selectNews(p.get()).length, 0);
  config.defaultPlan = 'max';
});

test('Kurzfassung: ein neutraler Satz in der Sprache der Person, Ton-Regel im Prompt, Zwischenspeicher, Rückfall auf Titel', async () => {
  const u = mk();
  digest.saveNews(u.get(), { enabled: true, topics: [], countries: ['AT'] });
  summaryRequests.length = 0; summaryMode = 'ok';
  const entries = await digest.buildDigest(u.get());
  assert.equal(entries.length, 4 - 0 > 0 ? entries.length : 0);
  assert.ok(entries.length >= 3);
  assert.ok(entries.every((e) => /^Kurzfassung Nummer \d+ zum Thema\.$/.test(e.sentence)));
  assert.equal(summaryRequests.length, 1, 'ein Aufruf für alle Meldungen');
  const sys = JSON.stringify(summaryRequests[0]!.body.system);
  assert.match(sys, /in German/);
  assert.match(sys, /ONE neutral sentence/);
  assert.match(sys, /strictly sober tone/);
  assert.match(sys, /no matter how the reader likes to be addressed/);
  assert.ok(String(summaryRequests[0]!.body.model).includes('haiku'));
  assert.ok(entries[0]!.url.startsWith('https://') && entries[0]!.source);
  await digest.buildDigest(u.get());
  assert.equal(summaryRequests.length, 1, 'am selben Tag aus dem Zwischenspeicher');

  // Rückfälle: Ausfall, falsche Anzahl → Titel; mehrere Sätze → nur der erste
  for (const [mode, check] of [['down', (s: string) => !s.startsWith('Kurzfassung')], ['wrongCount', (s: string) => !s.startsWith('nur einer')], ['multi', (s: string) => /^Erster Satz \d\.$/.test(s)]] as const) {
    const v = mk();
    digest.saveNews(v.get(), { enabled: true, topics: [], countries: ['AT'] });
    summaryMode = mode;
    const e = await digest.buildDigest(v.get());
    assert.ok(e.length > 0 && e.every((x) => check(x.sentence)), mode);
  }
  summaryMode = 'ok';
  assert.equal(digest.oneSentence('Erster Satz. Zweiter Satz.', 'Titel'), 'Erster Satz.');
  assert.equal(digest.oneSentence('Kurz 🎉', 'Titel'), 'Titel');
  assert.deepEqual(await digest.buildDigest(mk().get()), [], 'ausgeschaltet → nichts');
});

test('Briefing: Abschnitt „News“ mit Link und Quelle, Karte nur mit Meldungen', async () => {
  const u = mk();
  digest.saveNews(u.get(), { enabled: true, topics: [], countries: ['AT'] });
  assert.ok(!buildBriefing(u.get()).sections.some((s) => s.id === 'news'), 'vor dem Bauen noch nichts');
  await digest.buildDigest(u.get());
  const b = buildBriefing(u.get());
  const sec = b.sections.find((s) => s.id === 'news')!;
  assert.equal(sec.title, 'News');
  assert.match(sec.lines[0]!, /^Kurzfassung Nummer 1 zum Thema\. \(\[[^\]]+\]\(https:\/\/[^)]+\), \d{2}:\d{2}\)$/);
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
  assert.ok(view.sources.some((x) => x.id === 'orf') && view.topics.length === 9 && view.limits.count === 5);
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
