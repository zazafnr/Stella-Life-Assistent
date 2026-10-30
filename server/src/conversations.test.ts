import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

// Mock: OpenRouter (Agent) und Groq (Titel). Der Agent-Aufruf merkt sich, was er als Verlauf bekommen hat.
const agentSaw: string[][] = [];
let titleAnswer = '„Mathe Schularbeit lernen.“';
const mock = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/models') { res.end(JSON.stringify({ data: [{ id: 'good/model:free', supported_parameters: ['tools'] }] })); return; }
    const json = JSON.parse(body || '{}');
    if (req.url === '/groq/chat/completions') { res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: titleAnswer } }] })); return; }
    agentSaw.push((json.messages as { role: string; content: string }[]).filter((m) => m.role !== 'system').map((m) => m.content));
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Alles gut!' } }] }));
  });
});
await new Promise<void>((r) => mock.listen(0, r));
after(() => mock.close());
const base = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;

process.env.STELLA_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'stella-conv-'));
process.env.STELLA_SECRET = 'test-secret-1234567890';
process.env.STELLA_ALLOW_REGISTRATION = 'true';
process.env.OPENROUTER_API_KEY = 'test';
process.env.OPENROUTER_BASE_URL = base;
process.env.GROQ_API_KEY = 'gsk_test-key-1234567890';
process.env.GROQ_BASE_URL = `${base}/groq`;

const { register } = await import('./auth.ts');
const { addMessage, backfillConversations, createConversation, conversationMessages, db, getUser, newId, todayConversation } = await import('./db.ts');
const { handleChat } = await import('./assistant.ts');
const { cleanTitle, listConversations, maybeTitle, startConversation, titleDue } = await import('./conversations.ts');
const { addDays, dayLabel, todayIn } = await import('@stella/shared');

const { user: created } = register('Lukas', 'lukas@example.com', 'supergeheim', 'Europe/Vienna');
const user = () => getUser(created.id)!;
const today = todayIn('Europe/Vienna');
const convOf = (messageId: string) => (db.prepare('SELECT conversation_id AS c FROM messages WHERE id = ?').get(messageId) as { c: string }).c;

test('Nachrichten ohne Chat gehen in den neuesten von heute – Stella selbst eingeschlossen', () => {
  const briefing = addMessage(created.id, 'assistant', '☀️ Guten Morgen!');
  const today1 = todayConversation(created.id, false)!;
  assert.equal(convOf(briefing.id), today1);
  const second = addMessage(created.id, 'assistant', 'Noch was');
  assert.equal(convOf(second.id), today1, 'kein zweiter Chat');
});

test('Tageswechsel: gibt es für heute noch keinen Chat, wird einer angelegt', () => {
  const u2 = register('Mia', 'mia@example.com', 'supergeheim', 'Europe/Vienna').user;
  const old = createConversation(u2.id, addDays(today, -1));
  addMessage(u2.id, 'user', 'gestern', { conversationId: old });
  const fresh = addMessage(u2.id, 'assistant', 'Guten Morgen');
  assert.notEqual(convOf(fresh.id), old);
  assert.equal((db.prepare('SELECT day FROM conversations WHERE id = ?').get(convOf(fresh.id)) as { day: string }).day, today);
});

test('„Neuer Chat“ trennt den Verlauf – die KI sieht nur den aktuellen Chat', async () => {
  const a = startConversation(created.id);
  const r1 = await handleChat(user(), 'Wie geht es dir gerade heute?', 'c1', [], a);
  assert.equal(r1.conversationId, a);
  agentSaw.length = 0;
  const b = startConversation(created.id);
  assert.notEqual(a, b, 'der erste Chat hat schon Nachrichten → ein neuer entsteht');
  const r2 = await handleChat(user(), 'Und wie war dein Wochenende denn so?', 'c2', [], b);
  assert.equal(r2.conversationId, b);
  const history = agentSaw.at(-1)!;
  assert.ok(history.some((m) => m.includes('Wochenende')));
  assert.ok(!history.some((m) => m.includes('Wie geht es dir')), 'Verlauf aus dem anderen Chat bleibt draußen');
  assert.equal(convOf(r2.userMessage!.id), b);
  assert.ok(r2.messages.every((m) => convOf(m.id) === b), 'auch die Antwort liegt im neuen Chat');
});

test('einen alten Chat fortsetzen: Antwort bleibt dort, „heute“ bleibt unberührt', async () => {
  const old = createConversation(created.id, addDays(today, -2));
  addMessage(created.id, 'user', 'Wie lernt man am besten Vokabeln?', { conversationId: old });
  const todays = todayConversation(created.id, false);
  const res = await handleChat(user(), 'Und was war nochmal der erste Tipp dazu?', 'c3', [], old);
  assert.equal(res.conversationId, old);
  assert.ok(res.messages.every((m) => convOf(m.id) === old));
  assert.equal(todayConversation(created.id, false), todays);
});

test('fremde oder unbekannte Chat-Id wird ignoriert → neuester von heute', async () => {
  const res = await handleChat(user(), 'Was ist eigentlich Photosynthese genau?', 'c4', [], newId());
  assert.equal(res.conversationId, todayConversation(created.id, false));
});

test('Migration: alte Nachrichten werden pro Kalendertag (Zeitzone Wien) einem Chat zugeordnet', () => {
  const u = register('Tim', 'tim@example.com', 'supergeheim', 'Europe/Vienna').user;
  const raw = (iso: string, text: string) => db.prepare('INSERT INTO messages (id, user_id, role, text, attachments, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(newId(), u.id, 'user', text, '[]', iso);
  raw('2026-10-27T10:00:00.000Z', 'Dienstag früh');
  raw('2026-10-27T15:00:00.000Z', 'Dienstag nachmittag');
  raw('2026-10-28T23:30:00.000Z', 'schon Donnerstag in Wien (00:30)'); // 28.10. 23:30 UTC = 29.10. 00:30 in Wien (MEZ)
  raw('2026-10-29T08:00:00.000Z', 'Donnerstag früh');
  backfillConversations();
  const convs = db.prepare('SELECT id, day, created_at, updated_at FROM conversations WHERE user_id = ? ORDER BY day').all(u.id) as { id: string; day: string; created_at: string; updated_at: string }[];
  assert.deepEqual(convs.map((c) => c.day), ['2026-10-27', '2026-10-29']);
  const texts = (id: string) => conversationMessages(u.id, id, 10).map((m) => m.text);
  assert.deepEqual(texts(convs[0]!.id), ['Dienstag früh', 'Dienstag nachmittag']);
  assert.deepEqual(texts(convs[1]!.id), ['schon Donnerstag in Wien (00:30)', 'Donnerstag früh']);
  assert.equal(convs[0]!.updated_at, '2026-10-27T15:00:00.000Z');
  backfillConversations(); // zweiter Lauf ändert nichts
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM conversations WHERE user_id = ?').get(u.id) as { n: number }).n, 2);
});

test('Titel-Regeln: ab 4 Nachrichten, nur bei mehreren Chats am Tag oder langem Chat', () => {
  assert.equal(titleDue({ title: null, count: 3, chatsThatDay: 3 }), false);
  assert.equal(titleDue({ title: null, count: 4, chatsThatDay: 1 }), false);
  assert.equal(titleDue({ title: null, count: 4, chatsThatDay: 2 }), true);
  assert.equal(titleDue({ title: null, count: 12, chatsThatDay: 1 }), true);
  assert.equal(titleDue({ title: 'Schon einer', count: 12, chatsThatDay: 2 }), false);
});

test('Titel kommt von Groq: höchstens 5 Wörter, ohne Anführungszeichen und Punkt', async () => {
  assert.equal(cleanTitle('„Mathe Schularbeit lernen.“'), 'Mathe Schularbeit lernen');
  assert.equal(cleanTitle('Ein sehr langer Titel mit viel zu vielen Wörtern drin'), 'Ein sehr langer Titel mit');
  assert.equal(cleanTitle('  '), null);

  const u = register('Eva', 'eva@example.com', 'supergeheim', 'Europe/Vienna').user;
  const c1 = createConversation(u.id);
  const c2 = createConversation(u.id);
  for (let i = 0; i < 4; i++) addMessage(u.id, i % 2 ? 'assistant' : 'user', `Nachricht ${i}`, { conversationId: c1 });
  addMessage(u.id, 'user', 'nur eine', { conversationId: c2 });
  assert.equal(await maybeTitle(u.id, c1), 'Mathe Schularbeit lernen');
  assert.equal(await maybeTitle(u.id, c2), null, 'zu kurz');
  const list = listConversations(getUser(u.id)!);
  assert.equal(list.find((c) => c.id === c1)!.label, 'Mathe Schularbeit lernen');
  assert.equal(list.find((c) => c.id === c2)!.label, 'Heute', 'ohne Titel steht der Tag da');
});

test('Liste: leere Chats fehlen, neueste zuerst, Tag als Beschriftung', () => {
  assert.equal(dayLabel(today, today), 'Heute');
  assert.equal(dayLabel(addDays(today, -1), today), 'Gestern');
  assert.match(dayLabel('2026-11-04', '2026-11-20'), /^Mi, 4\.11\.$/);
  const u = register('Leo', 'leo@example.com', 'supergeheim', 'Europe/Vienna').user;
  const empty = createConversation(u.id);
  assert.equal(listConversations(getUser(u.id)!).length, 0);
  assert.equal(startConversation(u.id), empty, 'ein leerer Chat wird wiederverwendet');
  const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const old = createConversation(u.id, addDays(today, -3), threeDaysAgo);
  addMessage(u.id, 'user', 'alt', { conversationId: old, createdAt: threeDaysAgo });
  addMessage(u.id, 'user', 'neu', { conversationId: empty });
  assert.deepEqual(listConversations(getUser(u.id)!).map((c) => c.lastMessage), ['neu', 'alt']);
});
