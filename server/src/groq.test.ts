import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

// Ein Mock für beide Anbieter: /groq/... = Groq, alles andere = OpenRouter
const seen: { url: string; auth: string; model?: string }[] = [];
let groqMode: 'ok' | '429' = '429';
const mock = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks);
    const isForm = String(req.headers['content-type'] ?? '').startsWith('multipart/');
    const json = !isForm && raw.length ? JSON.parse(raw.toString()) : {};
    seen.push({ url: req.url ?? '', auth: String(req.headers.authorization ?? ''), model: json.model });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/models') { res.end(JSON.stringify({ data: [{ id: 'good/model:free', supported_parameters: ['tools'] }] })); return; }
    if (req.url === '/groq/audio/transcriptions') {
      assert.ok(isForm, 'Whisper bekommt multipart');
      assert.match(raw.toString('latin1'), /whisper-large-v3-turbo/);
      assert.match(raw.toString('latin1'), /name="language"\r\n\r\nde/);
      res.end(JSON.stringify({ text: ' Schreib Milch und Eier auf die Einkaufsliste. ' }));
      return;
    }
    if (req.url === '/groq/chat/completions') {
      if (groqMode === '429') { res.statusCode = 429; res.setHeader('retry-after', '1'); res.end(JSON.stringify({ error: { message: 'rate limit' } })); return; }
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '{"category":"important"}' } }] }));
      return;
    }
    if (req.url === '/key') { res.end(JSON.stringify({ data: { label: 'x' } })); return; }
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'von OpenRouter' } }] }));
  });
});
await new Promise<void>((r) => mock.listen(0, r));
after(() => mock.close());
const base = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;

process.env.STELLA_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'stella-groq-'));
process.env.STELLA_SECRET = 'test-secret-1234567890';
process.env.OPENROUTER_API_KEY = 'or-test-key';
process.env.OPENROUTER_BASE_URL = base;
process.env.GROQ_BASE_URL = `${base}/groq`;
process.env.STELLA_ALLOW_REGISTRATION = 'true';
// kein GROQ_API_KEY in der Umgebung: der kommt in den Tests über die Einstellungen (Owner)

const { register } = await import('./auth.ts');
const { db } = await import('./db.ts');
const { complete, transcribe, usageToday, usageTodayFor, LlmUnavailable } = await import('./llm.ts');
const { keyStatus, setKey, serverKey } = await import('./keys.ts');
const { registerAdminRoutes } = await import('./admin.ts');
const { requireUser } = await import('./auth.ts');
const Fastify = (await import('fastify')).default;

const owner = register('Lukas', 'lukas@example.com', 'supergeheim', 'Europe/Vienna');
const second = register('Mia', 'mia@example.com', 'supergeheim', 'Europe/Vienna');

const app = Fastify();
await app.register(async (api) => { api.addHook('preHandler', requireUser); registerAdminRoutes(api); });
await app.ready();
after(() => app.close());
const as = (token: string) => ({ authorization: `Bearer ${token}` });

test('der erste Nutzer ist Owner, der zweite nicht', () => {
  assert.equal(owner.user.role, 'owner');
  assert.equal(second.user.role, 'user');
});

test('Admin-Route nur für den Owner – und der Schlüssel kommt nie zurück', async () => {
  const denied = await app.inject({ method: 'GET', url: '/api/admin/keys', headers: as(second.token) });
  assert.equal(denied.statusCode, 403);
  const deniedPut = await app.inject({ method: 'PUT', url: '/api/admin/keys', headers: as(second.token), payload: { name: 'groq', value: 'gsk_nicht-erlaubt-123' } });
  assert.equal(deniedPut.statusCode, 403);
  assert.equal(serverKey('groq'), '');

  const before = await app.inject({ method: 'GET', url: '/api/admin/keys', headers: as(owner.token) });
  assert.equal(before.statusCode, 200);
  assert.equal(before.json().keys.groq.set, false);

  const put = await app.inject({ method: 'PUT', url: '/api/admin/keys', headers: as(owner.token), payload: { name: 'groq', value: 'gsk_geheimer-test-schluessel' } });
  assert.equal(put.statusCode, 200);
  assert.equal(put.json().keys.groq.set, true);
  assert.equal(put.json().keys.groq.source, 'app');
  assert.ok(!put.body.includes('gsk_geheimer'), 'der Schlüssel steht nicht in der Antwort');
  // in der Datenbank liegt er verschlüsselt
  const stored = db.prepare("SELECT value FROM secrets WHERE user_id = '__system__' AND name = 'groq'").get() as { value: string };
  assert.ok(!stored.value.includes('gsk_geheimer'));

  const bad = await app.inject({ method: 'PUT', url: '/api/admin/keys', headers: as(owner.token), payload: { name: 'groq', value: 'zu kurz' } });
  assert.equal(bad.statusCode, 400);
});

test('„Testen“ macht einen Mini-Request und merkt sich das Ergebnis', async () => {
  const fail = await app.inject({ method: 'POST', url: '/api/admin/keys/groq/test', headers: as(owner.token) });
  assert.equal(fail.json().ok, false); // Mock antwortet noch mit 429
  assert.ok(keyStatus().groq.lastError);
  groqMode = 'ok';
  const ok = await app.inject({ method: 'POST', url: '/api/admin/keys/groq/test', headers: as(owner.token) });
  assert.equal(ok.json().ok, true);
  assert.ok(ok.json().keys.groq.lastOk);
  assert.equal(seen.at(-1)!.auth, 'Bearer gsk_geheimer-test-schluessel');
});

test('Groq 429 → automatisch die OpenRouter-Kette, Zähler je Anbieter und Nutzer', async () => {
  groqMode = '429';
  const before = seen.length;
  const res = await complete([{ role: 'user', content: 'x' }], undefined, { provider: 'groq', task: 'classify', userId: owner.user.id, json: true });
  assert.equal(res.message.content, 'von OpenRouter');
  const urls = seen.slice(before).map((s) => s.url);
  assert.equal(urls[0], '/groq/chat/completions');
  assert.ok(urls.includes('/chat/completions'));
  assert.equal(usageTodayFor('groq', owner.user.id), 1); // der gescheiterte Groq-Versuch, dem Nutzer zugeordnet
  assert.equal(usageTodayFor('groq', second.user.id), 0);
  assert.equal(usageToday(), 1);
  assert.equal(usageTodayFor('openrouter', owner.user.id), 1);
});

test('Groq antwortet → Aufgabe wählt das Modell, kein Rückfall', async () => {
  groqMode = 'ok';
  // die 429-Pause des vorigen Tests abwarten (retry-after: 1 s)
  await new Promise((r) => setTimeout(r, 1100));
  const before = seen.length;
  const res = await complete([{ role: 'user', content: 'x' }], undefined, { provider: 'groq', task: 'extract', json: true });
  assert.match(res.message.content ?? '', /important/);
  assert.equal(res.model, 'groq/llama-3.3-70b-versatile');
  assert.deepEqual(seen.slice(before).map((s) => s.url), ['/groq/chat/completions']);
});

test('ohne Groq-Schlüssel und ohne OpenRouter: klare Meldung', async () => {
  setKey('groq', null);
  assert.equal(keyStatus().groq.set, false);
  const res = await complete([{ role: 'user', content: 'x' }], undefined, { provider: 'groq', task: 'title' });
  assert.equal(res.message.content, 'von OpenRouter'); // ohne Groq-Schlüssel direkt OpenRouter
  await assert.rejects(transcribe(Buffer.from('x'), 'audio/webm'), LlmUnavailable);
});

test('transcribe: Whisper über Groq, Deutsch, Text wird getrimmt', async () => {
  setKey('groq', 'gsk_geheimer-test-schluessel');
  const text = await transcribe(Buffer.from('fake-audio'), 'audio/mp4', { userId: owner.user.id });
  assert.equal(text, 'Schreib Milch und Eier auf die Einkaufsliste.');
});
