import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Nachgebaute Cloudflare-GraphQL-Schnittstelle
const seen: { path: string; auth?: string; body: string }[] = [];
const today = new Date().toISOString().slice(0, 10);
const mock = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    seen.push({ path: req.url ?? '', auth: req.headers.authorization, body });
    res.setHeader('content-type', 'application/json');
    if (req.url !== '/cf') { res.statusCode = 404; return res.end('{}'); }
    if (req.headers.authorization !== 'Bearer cf-token-0123456789abcdefghijklmnopqrstuv') { res.statusCode = 403; return res.end('{}'); }
    res.end(JSON.stringify({ data: { viewer: { accounts: [{
      days: [{ count: 12, sum: { visits: 5 }, dimensions: { date: today } }],
      pages: [{ count: 9, dimensions: { requestPath: '/stella' } }, { count: 3, dimensions: { requestPath: '/' } }],
      countries: [{ count: 10, dimensions: { countryName: 'AT' } }],
      referrers: [{ count: 7, dimensions: { refererHost: '' } }],
    }] } }, errors: null }));
  });
});
await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;

process.env.STELLA_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'stella-web-'));
process.env.STELLA_SECRET = 'test-secret-1234567890';
process.env.STELLA_ALLOW_REGISTRATION = 'true';
process.env.STELLA_CF_GRAPHQL_URL = `${base}/cf`;

const { register, requireUser, HttpError } = await import('./auth.ts');
const { registerWebAnalyticsRoutes, CLOUDFLARE_GRAPHQL } = await import('./webanalytics.ts');
const Fastify = (await import('fastify')).default;

const { token: ownerToken } = register('Lukas', 'lukas@example.com', 'passwort-123', 'Europe/Vienna');
const { token: otherToken } = register('Anna', 'anna@example.com', 'passwort-123', 'Europe/Vienna');

const app = Fastify();
app.setErrorHandler((err, _req, reply) => reply.code(err instanceof HttpError ? err.status : 500).send({ error: (err as Error).message }));
await app.register(async (api) => { api.addHook('preHandler', requireUser); registerWebAnalyticsRoutes(api); });
await app.ready();
const call = (method: 'GET' | 'POST', url: string, token: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as object, headers: { authorization: `Bearer ${token}` } });

test('richtige Cloudflare-Adresse', () => {
  assert.equal(CLOUDFLARE_GRAPHQL, 'https://api.cloudflare.com/client/v4/graphql');
});

test('Website-Zahlen: nur Owner, ohne Zugangsdaten „nicht verbunden“', async () => {
  assert.equal((await call('GET', '/api/admin/web-analytics', otherToken)).statusCode, 403);
  const o = (await call('GET', '/api/admin/web-analytics?days=7', ownerToken)).json();
  assert.equal(o.days, 7);
  assert.equal(o.cloudflare.configured, false);
});

test('Zugangsdaten werden geprüft und nie zurückgegeben', async () => {
  assert.equal((await call('POST', '/api/admin/web-analytics/config', ownerToken, { cfSiteTag: 'quatsch' })).statusCode, 400);
  const res = await call('POST', '/api/admin/web-analytics/config', ownerToken, { cfApiToken: 'cf-token-0123456789abcdefghijklmnopqrstuv', cfSiteTag: 'a'.repeat(32) });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().cloudflare.apiToken, true);
  assert.equal(res.json().cloudflare.accountId, '9c0788d39e8ad88d6f83b4c32f9fb059');
  assert.ok(!res.body.includes('cf-token'), 'kein Token in der Antwort');
});

test('Zahlen von Cloudflare', async () => {
  const o = (await call('GET', '/api/admin/web-analytics?days=7', ownerToken)).json();
  assert.equal(o.cloudflare.ok, true, o.cloudflare.error);
  assert.deepEqual(o.cloudflare.totals, { visitors: 5, pageviews: 12 });
  assert.equal(o.cloudflare.perDay.length, 7);
  assert.equal(o.cloudflare.perDay.at(-1).pageviews, 12);
  assert.equal(o.cloudflare.pages[0].key, '/stella');
  assert.equal(o.cloudflare.referrers[0].key, '(direct)');
  assert.equal(o.google, undefined);
  const cf = JSON.parse(seen.find((s) => s.path === '/cf')!.body);
  assert.equal(cf.variables.account, '9c0788d39e8ad88d6f83b4c32f9fb059');
  assert.equal(cf.variables.siteTag, 'a'.repeat(32));
  assert.ok(cf.query.includes('rumPageloadEventsAdaptiveGroups') && cf.query.includes('siteTag: $siteTag'));
  mock.close();
});
