import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

// Mock-Groq: Whisper mit Umschalter für „Groq ist down“
let groqDown = false;
let transcript = 'Mathe HÜ S. 45 Nr. 3 Freitag';
let transcribeCalls = 0;
const mock = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/groq/audio/transcriptions') {
      transcribeCalls++;
      if (groqDown) { res.statusCode = 503; res.end(JSON.stringify({ error: { message: 'over capacity' } })); return; }
      res.end(JSON.stringify({ text: ` ${transcript} ` }));
      return;
    }
    res.end('{}');
  });
});
await new Promise<void>((r) => mock.listen(0, r));
after(() => mock.close());
const base = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;

process.env.STELLA_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'stella-audio-'));
process.env.STELLA_SECRET = 'test-secret-1234567890';
process.env.STELLA_ALLOW_REGISTRATION = 'true';
process.env.OPENROUTER_API_KEY = '';
process.env.GROQ_API_KEY = 'gsk_test-key-1234567890';
process.env.GROQ_BASE_URL = `${base}/groq`;

const { register, requireUser, HttpError } = await import('./auth.ts');
const { db, listItems } = await import('./db.ts');
const { registerAudioRoutes, MAX_AUDIO_BYTES } = await import('./audio.ts');
const { filePath } = await import('./files.ts');
const Fastify = (await import('fastify')).default;

const me = register('Lukas', 'lukas@example.com', 'supergeheim', 'Europe/Vienna');
const other = register('Mia', 'mia@example.com', 'supergeheim', 'Europe/Vienna');

const app = Fastify({ bodyLimit: 2 * 1024 * 1024 });
app.setErrorHandler((err, _req, reply) => {
  if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
  return reply.code((err as { statusCode?: number }).statusCode ?? 500).send({ error: (err as Error).message });
});
await app.register(async (api) => { api.addHook('preHandler', requireUser); registerAudioRoutes(api); });
await app.ready();
after(() => app.close());

const auth = (t: string) => ({ authorization: `Bearer ${t}` });
const recording = (bytes = 5000) => Buffer.alloc(bytes, 7);
const upload = (token: string, body: Buffer, type = 'audio/mp4', query = '') =>
  app.inject({ method: 'POST', url: `/api/chat/audio${query}`, headers: { ...auth(token), 'content-type': type }, payload: body });

test('Sprachnachricht → Transkript wird zur Nutzernachricht, die Aufnahme hängt an, Stella antwortet', async () => {
  const res = await upload(me.token, recording(), 'audio/mp4', '?clientId=a1&duration=7');
  assert.equal(res.statusCode, 200, res.body);
  const json = res.json();
  assert.equal(json.transcript, 'Mathe HÜ S. 45 Nr. 3 Freitag');
  assert.equal(json.userMessage.text, 'Mathe HÜ S. 45 Nr. 3 Freitag');
  assert.deepEqual(json.userMessage.attachments.map((a: { kind: string }) => a.kind), ['audio']);
  assert.ok(filePath(json.audioId), 'die Aufnahme liegt auf dem Server');
  assert.ok(json.messages.length >= 1, 'Antwort von Stella');
  assert.ok(listItems(me.user.id, { kind: 'homework' }).some((i) => i.subject === 'Mathe'), 'normal verarbeitet: HÜ ist eingetragen');
  assert.equal(json.conversationId, json.userMessage && (db.prepare('SELECT conversation_id AS c FROM messages WHERE id = ?').get(json.userMessage.id) as { c: string }).c);
});

test('Webm aus dem Browser (mit codecs) wird angenommen', async () => {
  transcript = 'Freitag 15 Uhr Friseur';
  const res = await upload(me.token, recording(), 'audio/webm;codecs=opus', '?clientId=a2');
  assert.equal(res.statusCode, 200, res.body);
  assert.ok(listItems(me.user.id, {}).some((i) => i.title === 'Friseur'));
});

test('Größenlimit greift: über 10 MB → 413', async () => {
  const res = await upload(me.token, Buffer.alloc(MAX_AUDIO_BYTES + 4096, 1));
  assert.equal(res.statusCode, 413);
});

test('Länge über 2 Minuten, leere Datei, unbekanntes Format', async () => {
  assert.equal((await upload(me.token, recording(), 'audio/mp4', '?duration=200')).statusCode, 400);
  assert.equal((await upload(me.token, Buffer.alloc(10))).statusCode, 400);
  assert.equal((await upload(me.token, recording(), 'audio/flac')).statusCode, 415);
});

test('Groq fällt aus: klare Meldung, Aufnahme bleibt, „Nochmal versuchen“ ohne neuen Upload', async () => {
  groqDown = true;
  transcript = 'Englisch HÜ S. 12 Nr. 2 Montag';
  const failed = await upload(me.token, recording(), 'audio/mp4', '?clientId=a3');
  assert.equal(failed.statusCode, 503);
  const body = failed.json();
  assert.equal(body.retry, true);
  assert.match(body.error, /Nochmal versuchen/);
  assert.ok(filePath(body.audioId), 'Aufnahme ist trotzdem gespeichert');
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM messages WHERE user_id = ? AND text LIKE 'Englisch%'").get(me.user.id) as { n: number }).n, 0, 'noch keine Nachricht');

  groqDown = false;
  const retry = await app.inject({ method: 'POST', url: '/api/chat/audio/retry', headers: auth(me.token), payload: { audioId: body.audioId, clientId: 'a3' } });
  assert.equal(retry.statusCode, 200, retry.body);
  assert.equal(retry.json().userMessage.text, 'Englisch HÜ S. 12 Nr. 2 Montag');
  assert.equal(retry.json().audioId, body.audioId, 'dieselbe Aufnahme');
});

test('fremde oder erfundene Aufnahme lässt sich nicht erneut abschreiben', async () => {
  const mine = await upload(me.token, recording(), 'audio/mp4', '?clientId=a4');
  const before = transcribeCalls;
  const stolen = await app.inject({ method: 'POST', url: '/api/chat/audio/retry', headers: auth(other.token), payload: { audioId: mine.json().audioId } });
  assert.equal(stolen.statusCode, 404);
  const fake = await app.inject({ method: 'POST', url: '/api/chat/audio/retry', headers: auth(me.token), payload: { audioId: '00000000-0000-0000-0000-000000000000' } });
  assert.equal(fake.statusCode, 404);
  assert.equal(transcribeCalls, before, 'Groq wurde dafür nicht gefragt');
});

test('ohne Anmeldung nicht erreichbar', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/chat/audio', headers: { 'content-type': 'audio/mp4' }, payload: recording() });
  assert.equal(res.statusCode, 401);
});
