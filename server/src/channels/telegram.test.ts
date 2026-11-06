import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import Fastify from 'fastify';
import { startMockClaude, text } from '../testing/mockClaude.ts';

// ---- Telegram-Mock ----
interface Call { method: string; body: Record<string, any> }
const calls: Call[] = [];
const BOT_TOKEN = '123456789:AAEtestTokenAbcdefghijklmnopqrstuvwxyz1234';
const tgServer = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const url = req.url ?? '';
    if (url.startsWith(`/file/bot${BOT_TOKEN}/`)) { res.setHeader('Content-Type', 'application/octet-stream'); res.end(Buffer.alloc(5000, 9)); return; }
    const m = new RegExp(`^/bot${BOT_TOKEN}/(\\w+)$`).exec(url);
    res.setHeader('Content-Type', 'application/json');
    if (!m) { res.statusCode = 401; res.end(JSON.stringify({ ok: false, description: 'Unauthorized' })); return; }
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    calls.push({ method: m[1]!, body });
    const result: Record<string, unknown> = {
      getMe: { id: 1, username: 'StellaTestBot' }, setWebhook: true, deleteWebhook: true, sendChatAction: true, answerCallbackQuery: true,
      sendMessage: { message_id: calls.length },
      getFile: { file_path: body.file_id === 'voice1' ? 'voice/f.oga' : 'photos/p.jpg', file_size: 5000 },
    };
    if (m[1] === 'sendMessage' && /&lt;bad&gt;/.test(String(body.text)) && body.parse_mode) { res.statusCode = 400; res.end(JSON.stringify({ ok: false, description: "Bad Request: can't parse entities" })); return; }
    res.end(JSON.stringify({ ok: true, result: result[m[1]!] ?? true }));
  });
});
await new Promise<void>((r) => tgServer.listen(0, r));

// ---- Whisper-Mock (Groq) und Claude-Mock (Aufräumen) ----
let spoken = 'ähm also Steuer Abgabe bis Freitag';
const groq = createServer((req, res) => { req.on('data', () => {}); req.on('end', () => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ text: ` ${spoken} ` })); }); });
await new Promise<void>((r) => groq.listen(0, r));
const claude = await startMockClaude((req) => {
  const sys = JSON.stringify(req.body.system ?? '');
  if (sys.includes('You clean up') || sys.includes('You add punctuation')) return text('Steuer-Abgabe bis Freitag.');
  return text('Alles klar.');
});
after(() => { tgServer.close(); groq.close(); return claude.close(); });

process.env.STELLA_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'stella-telegram-'));
process.env.STELLA_SECRET = 'test-secret-1234567890';
process.env.STELLA_ALLOW_REGISTRATION = 'true';
process.env.STELLA_PUBLIC_URL = 'https://stella.example.com';
process.env.TELEGRAM_BASE_URL = `http://127.0.0.1:${(tgServer.address() as AddressInfo).port}`;
process.env.TELEGRAM_MIN_GAP_MS = '0';
process.env.OPENROUTER_API_KEY = '';
process.env.GROQ_API_KEY = 'gsk_test-key-1234567890';
process.env.GROQ_BASE_URL = `http://127.0.0.1:${(groq.address() as AddressInfo).port}/groq`;
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key-123456';
process.env.ANTHROPIC_BASE_URL = claude.url;
process.env.STELLA_CLAUDE_RETRY_MS = '5';

const { config } = await import('../config.ts');
const { register, HttpError, requireUser } = await import('../auth.ts');
const { db, getUser, updateUserSettings, listItems, recentMessages } = await import('../db.ts');
const { setKey, telegramKey, keyStatus } = await import('../keys.ts');
const tgmod = await import('./telegram.ts');
const { markdownToTelegramHtml, splitForTelegram, escapeHtml } = await import('./telegramHtml.ts');
const { notify, setPushForTests, notifyChannels } = await import('./deliver.ts');

const app = Fastify();
app.setErrorHandler((err: Error, _req, reply) => reply.code(err instanceof HttpError ? err.status : 500).send({ error: err.message }));
tgmod.registerTelegramWebhook(app);
await app.register(async (api) => { api.addHook('preHandler', requireUser); tgmod.registerTelegramRoutes(api); });
await app.ready();
after(() => app.close());

const owner = register('Owner', 'owner@example.com', 'supergeheim', 'Europe/Vienna');
const mia = register('Mia', 'mia@example.com', 'supergeheim', 'Europe/Vienna');
updateUserSettings(mia.user.id, { locale: 'de', tone: 'nett' });
const auth = (t: string) => ({ authorization: `Bearer ${t}` });
const sentTo = (chat: string) => calls.filter((c) => c.method === 'sendMessage' && String(c.body.chat_id) === chat);
let updateId = 1000;
const webhook = (update: Record<string, unknown>, secret?: string) =>
  app.inject({ method: 'POST', url: '/api/channels/telegram/webhook', headers: secret === undefined ? {} : { 'x-telegram-bot-api-secret-token': secret }, payload: { update_id: ++updateId, ...update } });
const send = async (chat: number, msg: Record<string, unknown>, from = {}) => {
  const r = await webhook({ message: { message_id: updateId, chat: { id: chat, type: 'private' }, from, ...msg } }, telegramKey()!.secret);
  await tgmod.pendingWork;
  return r;
};

test('Token eintragen setzt den Webhook mit geheimem Token, Benutzername wird gemerkt, ohne Token geht nichts', async () => {
  assert.equal((await webhook({ message: { chat: { id: 1, type: 'private' }, text: 'hi' } }, 'irgendwas')).statusCode, 401, 'nicht eingerichtet');
  assert.throws(() => setKey('telegram', 'nicht-ok'), /Bot-Token/);
  setKey('telegram', BOT_TOKEN);
  const r = await tgmod.registerWebhook();
  assert.equal(r.ok, true, r.message);
  const hook = calls.find((c) => c.method === 'setWebhook')!;
  assert.equal(hook.body.url, 'https://stella.example.com/api/channels/telegram/webhook');
  assert.equal(hook.body.secret_token, telegramKey()!.secret);
  assert.ok(telegramKey()!.secret.length >= 32);
  assert.deepEqual(hook.body.allowed_updates, ['message', 'callback_query']);
  assert.equal(telegramKey()!.username, 'StellaTestBot');
  assert.equal(keyStatus().telegram.set, true);
  assert.equal(keyStatus().telegram.lastOk !== null, true);
});

test('Webhook mit falschem oder fehlendem Secret → 401, mit richtigem → 200', async () => {
  const msg = { message: { chat: { id: 5, type: 'private' }, text: 'hallo' } };
  assert.equal((await webhook(msg, 'falsch')).statusCode, 401);
  assert.equal((await webhook(msg)).statusCode, 401);
  assert.equal((await webhook(msg, telegramKey()!.secret)).statusCode, 200);
  await tgmod.pendingWork;
});

test('Verknüpfen: Einmal-Link mit /start, gültig 10 Minuten, nur einmal, Begrüßung in Sprache und Ton', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/channels/telegram/link', headers: auth(mia.token) });
  assert.equal(res.statusCode, 200);
  const { token, url, expiresAt } = res.json() as { token: string; url: string; expiresAt: string };
  assert.equal(url, `https://t.me/StellaTestBot?start=${token}`);
  assert.ok(Math.abs(Date.parse(expiresAt) - Date.now() - 10 * 60_000) < 5000);
  assert.ok(!(db.prepare('SELECT hash FROM channel_tokens').all() as { hash: string }[]).some((r) => r.hash === token), 'nur der Hash liegt in der Datenbank');

  await send(777, { text: `/start ${token}` }, { language_code: 'de' });
  assert.equal(tgmod.chatOf(mia.user.id), '777');
  assert.match(String(sentTo('777').at(-1)!.body.text), /^Hallo Mia! Du bist verbunden/);
  assert.equal(((await app.inject({ method: 'GET', url: '/api/channels/telegram', headers: auth(mia.token) })).json() as { linked: boolean }).linked, true);

  // zweiter Versuch mit demselben Token
  await send(888, { text: `/start ${token}` }, { language_code: 'es' });
  assert.match(String(sentTo('888').at(-1)!.body.text), /caducado/, 'Antwort in der Sprache aus Telegram');
  assert.equal(tgmod.userByChat('888'), null);

  // abgelaufen
  const t2 = (await app.inject({ method: 'POST', url: '/api/channels/telegram/link', headers: auth(owner.token) })).json() as { token: string };
  db.prepare('UPDATE channel_tokens SET expires_at = ?').run(new Date(Date.now() - 1000).toISOString());
  await send(999, { text: `/start ${t2.token}` });
  assert.match(String(sentTo('999').at(-1)!.body.text), /expired/);
  assert.equal(tgmod.userByChat('999'), null);
});

test('Unbekannte Chats bekommen eine kurze Erklärung, höchstens 3 pro Stunde', async () => {
  const before = sentTo('4242').length;
  for (let i = 0; i < 6; i++) await send(4242, { text: 'hallo?' });
  assert.equal(sentTo('4242').length - before, 3);
  assert.match(String(sentTo('4242')[0]!.body.text), /connect Telegram/);
});

test('Text landet im Chat (via Telegram) und Stella antwortet dort, mit HTML und Ja/Rückgängig-Knöpfen', async () => {
  await send(777, { text: 'Steuer Abgabe Freitag' });
  assert.ok(listItems(mia.user.id, { kind: 'assignment' }).some((i) => i.title === 'Abgabe'), 'normal verarbeitet');
  const msgs = recentMessages(mia.user.id, 10);
  assert.equal(msgs.find((m) => m.role === 'user' && m.text.startsWith('Steuer Abgabe'))!.via, 'telegram');
  assert.ok(msgs.filter((m) => m.role === 'assistant').some((m) => m.via === 'telegram'));
  const out = sentTo('777').at(-1)!.body;
  assert.equal(out.parse_mode, 'HTML');
  const buttons = (out.reply_markup?.inline_keyboard?.[0] ?? []) as { text: string; callback_data: string }[];
  assert.ok(buttons.some((b) => /^u:[0-9a-f-]{36}$/.test(b.callback_data) && b.text === 'Rückgängig'), 'Erledigtes hat „Rückgängig“');
});

test('Callback „Rückgängig“ macht die Aktion rückgängig', async () => {
  const out = sentTo('777').filter((c) => c.body.reply_markup).at(-1)!.body;
  const undoBtn = (out.reply_markup.inline_keyboard[0] as { callback_data: string }[]).find((b) => b.callback_data.startsWith('u:'))!;
  const id = undoBtn.callback_data.slice(2);
  assert.equal((db.prepare('SELECT status FROM actions WHERE id = ?').get(id) as { status: string }).status, 'done');
  const r = await webhook({ callback_query: { id: 'cb1', data: undoBtn.callback_data, message: { chat: { id: 777 } } } }, telegramKey()!.secret);
  assert.equal(r.statusCode, 200);
  await tgmod.pendingWork;
  assert.equal((db.prepare('SELECT status FROM actions WHERE id = ?').get(id) as { status: string }).status, 'undone');
  assert.ok(calls.some((c) => c.method === 'answerCallbackQuery' && c.body.callback_query_id === 'cb1'));
  assert.equal(String(sentTo('777').at(-1)!.body.text), 'Rückgängig gemacht.');
  // fremde Aktions-Id (nicht von dieser Person) → Fehlermeldung statt Absturz
  await webhook({ callback_query: { id: 'cb2', data: `u:${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}`, message: { chat: { id: 777 } } } }, telegramKey()!.secret);
  await tgmod.pendingWork;
  assert.match(String(sentTo('777').at(-1)!.body.text), /^Das hat nicht geklappt/);
});

test('Sprachnachricht (OGG) → getFile → Abschrift, aufgeräumt wie in der App', async () => {
  const before = recentMessages(mia.user.id, 50).length;
  await send(777, { voice: { file_id: 'voice1', duration: 9, mime_type: 'audio/ogg' } });
  assert.ok(calls.some((c) => c.method === 'getFile' && c.body.file_id === 'voice1'));
  const user = recentMessages(mia.user.id, 50).filter((m) => m.role === 'user').at(-1)!;
  assert.equal(user.text, 'Steuer-Abgabe bis Freitag.');
  const att = user.attachments.find((a) => a.kind === 'audio')!;
  assert.equal(att.transcriptRaw, spoken);
  assert.equal(att.duration, 9);
  assert.equal(user.via, 'telegram');
  assert.ok(recentMessages(mia.user.id, 50).length > before);
});

test('Foto → Anhang am Chat (Bild), Bildunterschrift wird Text', async () => {
  await send(777, { photo: [{ file_id: 'small', width: 90, height: 90, file_size: 800 }, { file_id: 'big', width: 1280, height: 960, file_size: 5000 }], caption: 'Mathe Arbeitsblatt' });
  assert.ok(calls.some((c) => c.method === 'getFile' && c.body.file_id === 'big'), 'das größte Foto wird geholt');
  const user = recentMessages(mia.user.id, 50).filter((m) => m.role === 'user').at(-1)!;
  assert.equal(user.text, 'Mathe Arbeitsblatt');
  assert.deepEqual(user.attachments.map((a) => a.kind), ['image']);
});

test('/briefing, /stop und Gruppen', async () => {
  await send(777, { text: '/briefing' });
  assert.match(String(sentTo('777').at(-1)!.body.text), /Hallo|Guten|Mia/);
  const n = sentTo('-100').length;
  await webhook({ message: { chat: { id: -100, type: 'group' }, text: 'hallo' } }, telegramKey()!.secret);
  await tgmod.pendingWork;
  assert.equal(sentTo('-100').length, n, 'Gruppen werden ignoriert');
});

test('notify(): nach Einstellung Push, Telegram oder beides; ohne Verknüpfung kommt es als Push', async () => {
  const pushes: string[] = [];
  setPushForTests(async (_id, p) => { pushes.push(p.body); });
  const n = () => sentTo('777').length;
  assert.deepEqual(notifyChannels(mia.user.id), ['push']);

  let before = n();
  await notify(mia.user.id, { title: 'Stella', body: 'nur Push' });
  assert.deepEqual([pushes.length, n() - before], [1, 0]);

  updateUserSettings(mia.user.id, { notifyVia: ['push', 'telegram'] });
  before = n(); pushes.length = 0;
  await notify(mia.user.id, { title: 'Stella', body: 'beides', text: 'beides **fett**' });
  assert.deepEqual([pushes.length, n() - before], [1, 1]);
  assert.equal(sentTo('777').at(-1)!.body.text, 'beides <b>fett</b>');

  updateUserSettings(mia.user.id, { notifyVia: ['telegram'] });
  before = n(); pushes.length = 0;
  await notify(mia.user.id, { title: 'Stella', body: 'nur Telegram' });
  assert.deepEqual([pushes.length, n() - before], [0, 1]);

  // /stop trennt – wer nur Telegram wollte, bekommt wieder Push
  await send(777, { text: '/stop' });
  assert.equal(tgmod.chatOf(mia.user.id), null);
  assert.deepEqual(getUser(mia.user.id)!.settings.notifyVia, ['push']);
  pushes.length = 0; before = n();
  updateUserSettings(mia.user.id, { notifyVia: ['telegram'] });
  await notify(mia.user.id, { title: 'Stella', body: 'nicht verknüpft' });
  assert.deepEqual([pushes.length, n() - before], [1, 0], 'Rückfall auf Push');
  setPushForTests();
});

test('Senden: höchstens eine Nachricht pro Sekunde und Chat (Puffer), lange Texte werden geteilt', async () => {
  config.telegram.minGapMs = 250;
  const t0 = Date.now();
  await Promise.all([1, 2, 3].map((i) => tgmod.sendTo('55', { text: `n${i}` })));
  assert.ok(Date.now() - t0 >= 480, `drei Nachrichten brauchen mindestens zwei Pausen (${Date.now() - t0} ms)`);
  const times = sentTo('55').map((c) => c.body.text);
  assert.deepEqual(times, ['n1', 'n2', 'n3'], 'Reihenfolge bleibt');
  config.telegram.minGapMs = 0;
  const before = sentTo('56').length;
  await tgmod.sendTo('56', { text: Array.from({ length: 12 }, (_, i) => `Absatz ${i} ${'x'.repeat(500)}`).join('\n\n') });
  assert.ok(sentTo('56').length - before >= 2);
  assert.ok(sentTo('56').every((c) => String(c.body.text).length <= 4096));
});

test('Fehler im HTML: Telegram lehnt ab → derselbe Text ohne Formatierung', async () => {
  const before = sentTo('57').length;
  await tgmod.sendTo('57', { text: 'komisch <bad> text' });
  const got = sentTo('57').slice(before);
  assert.equal(got.length, 2);
  assert.equal(got[1]!.body.parse_mode, undefined);
  assert.equal(got[1]!.body.text, 'komisch <bad> text');
});

test('HTML-Escape: nichts Fremdes kommt durch, Links nur mit http(s)', () => {
  assert.equal(escapeHtml('<script>&"x"'), '&lt;script&gt;&amp;"x"');
  assert.equal(markdownToTelegramHtml('**fett** und <b>nicht</b> & mehr'), '<b>fett</b> und &lt;b&gt;nicht&lt;/b&gt; &amp; mehr');
  assert.equal(markdownToTelegramHtml('[Karte](https://example.com/a?x=1&y=2)'), '<a href="https://example.com/a?x=1&amp;y=2">Karte</a>');
  assert.equal(markdownToTelegramHtml('[böse](javascript:alert(1))'), '[böse](javascript:alert(1))');
  assert.equal(markdownToTelegramHtml('[x](https://a.b/"onmouseover="y)'), '[x](https://a.b/"onmouseover="y)', 'Anführungszeichen im Link → kein Link');
  assert.equal(markdownToTelegramHtml('`a<b>` und ```\nx < y\n```'), '<code>a&lt;b&gt;</code> und <pre>x &lt; y</pre>');
  assert.equal(markdownToTelegramHtml('- eins\n* zwei'), '• eins\n• zwei');
  assert.deepEqual(splitForTelegram('kurz'), ['kurz']);
});

test('Trennen in der App und Schlüssel entfernen', async () => {
  const u = register('Tom', 'tom@example.com', 'supergeheim', 'Europe/Vienna');
  const { token } = (await app.inject({ method: 'POST', url: '/api/channels/telegram/link', headers: auth(u.token) })).json() as { token: string };
  await send(321, { text: `/start ${token}` });
  assert.equal(tgmod.chatOf(u.user.id), '321');
  const r = await app.inject({ method: 'DELETE', url: '/api/channels/telegram', headers: auth(u.token) });
  assert.equal((r.json() as { linked: boolean }).linked, false);
  assert.equal(tgmod.userByChat('321'), null);
  // ohne Token: Verknüpfen nicht möglich
  await tgmod.unregisterWebhook();
  assert.ok(calls.some((c) => c.method === 'deleteWebhook'));
  setKey('telegram', null);
  assert.equal(telegramKey(), null);
  assert.equal((await app.inject({ method: 'POST', url: '/api/channels/telegram/link', headers: auth(u.token) })).statusCode, 409);
});
