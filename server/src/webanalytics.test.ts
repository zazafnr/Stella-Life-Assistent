import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Nachgebaute Cloudflare-GraphQL- und Google-Schnittstellen
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const seen: { path: string; auth?: string; body: string }[] = [];
const today = new Date().toISOString().slice(0, 10);
const mock = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    seen.push({ path: req.url ?? '', auth: req.headers.authorization, body });
    res.setHeader('content-type', 'application/json');
    if (req.url === '/cf') {
      if (req.headers.authorization !== 'Bearer cf-token-0123456789abcdefghijklmnopqrstuv') { res.statusCode = 403; return res.end('{}'); }
      return res.end(JSON.stringify({ data: { viewer: { accounts: [{
        days: [{ count: 12, sum: { visits: 5 }, dimensions: { date: today } }],
        pages: [{ count: 9, dimensions: { requestPath: '/stella' } }, { count: 3, dimensions: { requestPath: '/' } }],
        countries: [{ count: 10, dimensions: { countryName: 'AT' } }],
        referrers: [{ count: 7, dimensions: { refererHost: '' } }],
      }] } }, errors: null }));
    }
    if (req.url === '/token') {
      const assertion = new URLSearchParams(body).get('assertion') ?? '';
      const [h, c, s] = assertion.split('.');
      const ok = createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(s, 'base64url'));
      const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
      if (!ok || claims.scope !== 'https://www.googleapis.com/auth/analytics.readonly') { res.statusCode = 400; return res.end('{"error_description":"bad jwt"}'); }
      return res.end(JSON.stringify({ access_token: 'ga-access', expires_in: 3600 }));
    }
    if (req.url === '/ga/properties/562989593:batchRunReports') {
      if (req.headers.authorization !== 'Bearer ga-access') { res.statusCode = 403; return res.end('{}'); }
      const d = today.replace(/-/g, '');
      return res.end(JSON.stringify({ reports: [
        { rows: [{ dimensionValues: [{ value: d }], metricValues: [{ value: '3' }, { value: '8' }, { value: '4' }] }], totals: [{ metricValues: [{ value: '3' }, { value: '8' }, { value: '4' }] }] },
        { rows: [{ dimensionValues: [{ value: '/stella' }], metricValues: [{ value: '6' }] }] },
        { rows: [{ dimensionValues: [{ value: 'Austria' }], metricValues: [{ value: '3' }] }] },
        { rows: [{ dimensionValues: [{ value: '(direct)' }], metricValues: [{ value: '4' }] }] },
      ] }));
    }
    res.statusCode = 404; res.end('{}');
  });
});
await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;

process.env.STELLA_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'stella-web-'));
process.env.STELLA_SECRET = 'test-secret-1234567890';
process.env.STELLA_ALLOW_REGISTRATION = 'true';
process.env.STELLA_CF_GRAPHQL_URL = `${base}/cf`;
process.env.STELLA_GA_TOKEN_URL = `${base}/token`;
process.env.STELLA_GA_DATA_URL = `${base}/ga`;

const { register, requireUser, HttpError } = await import('./auth.ts');
const { registerWebAnalyticsRoutes } = await import('./webanalytics.ts');
const Fastify = (await import('fastify')).default;

const { token: ownerToken } = register('Lukas', 'lukas@example.com', 'passwort-123', 'Europe/Vienna');
const { token: otherToken } = register('Anna', 'anna@example.com', 'passwort-123', 'Europe/Vienna');

const app = Fastify();
app.setErrorHandler((err, _req, reply) => reply.code(err instanceof HttpError ? err.status : 500).send({ error: (err as Error).message }));
await app.register(async (api) => { api.addHook('preHandler', requireUser); registerWebAnalyticsRoutes(api); });
await app.ready();
const call = (method: 'GET' | 'POST', url: string, token: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as object, headers: { authorization: `Bearer ${token}` } });

test('Website-Zahlen: nur Owner, ohne Zugangsdaten „nicht verbunden“', async () => {
  assert.equal((await call('GET', '/api/admin/web-analytics', otherToken)).statusCode, 403);
  const o = (await call('GET', '/api/admin/web-analytics?days=7', ownerToken)).json();
  assert.equal(o.days, 7);
  assert.equal(o.cloudflare.configured, false);
  assert.equal(o.google.configured, false);
});

test('Zugangsdaten werden geprüft und nie zurückgegeben', async () => {
  assert.equal((await call('POST', '/api/admin/web-analytics/config', ownerToken, { cfSiteTag: 'quatsch' })).statusCode, 400);
  assert.equal((await call('POST', '/api/admin/web-analytics/config', ownerToken, { gaServiceAccount: '{"x":1}' })).statusCode, 400);
  const sa = JSON.stringify({ type: 'service_account', client_email: 'dash@evolsior.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  const res = await call('POST', '/api/admin/web-analytics/config', ownerToken, {
    cfApiToken: 'cf-token-0123456789abcdefghijklmnopqrstuv', cfSiteTag: 'a'.repeat(32), gaServiceAccount: sa,
  });
  assert.equal(res.statusCode, 200);
  const st = res.json();
  assert.equal(st.cloudflare.apiToken, true);
  assert.equal(st.google.serviceAccount, 'dash@evolsior.iam.gserviceaccount.com');
  assert.ok(!res.body.includes('cf-token') && !res.body.includes('PRIVATE KEY'), 'keine Geheimnisse in der Antwort');
});

test('Zahlen von Cloudflare und Google', async () => {
  const o = (await call('GET', '/api/admin/web-analytics?days=7', ownerToken)).json();
  assert.equal(o.cloudflare.ok, true, o.cloudflare.error);
  assert.deepEqual(o.cloudflare.totals, { visitors: 5, pageviews: 12 });
  assert.equal(o.cloudflare.perDay.length, 7);
  assert.equal(o.cloudflare.perDay.at(-1).pageviews, 12);
  assert.equal(o.cloudflare.pages[0].key, '/stella');
  assert.equal(o.cloudflare.referrers[0].key, '(direct)');
  const cf = JSON.parse(seen.find((s) => s.path === '/cf')!.body);
  assert.equal(cf.variables.account, '9c0788d39e8ad88d6f83b4c32f9fb059');
  assert.equal(cf.variables.siteTag, 'a'.repeat(32));
  assert.ok(cf.query.includes('rumPageloadEventsAdaptiveGroups') && cf.query.includes('siteTag: $siteTag'));

  assert.equal(o.google.ok, true, o.google.error);
  assert.deepEqual(o.google.totals, { visitors: 3, pageviews: 8, sessions: 4 });
  assert.equal(o.google.perDay.at(-1).visitors, 3);
  assert.equal(o.google.pages[0].key, '/stella');
  assert.equal(o.google.countries[0].key, 'Austria');
  mock.close();
});
