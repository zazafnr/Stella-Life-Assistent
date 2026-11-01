import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { httpError, refusal, startMockClaude, text, toolUse, type MockReply, type MockRequest } from './testing/mockClaude.ts';

// Simuliertes OpenRouter, um zu sehen, ob der Notfall-Weg genutzt wird
let openRouterCalls = 0;
const openRouter = createServer((req, res) => {
  req.on('data', () => {});
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/models') { res.end(JSON.stringify({ data: [{ id: 'good/model:free', context_length: 1e5, supported_parameters: ['tools'] }] })); return; }
    openRouterCalls++;
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Notfall-Antwort' } }] }));
  });
});
await new Promise<void>((r) => openRouter.listen(0, r));

let script: (req: MockRequest, n: number) => MockReply = () => text('ok');
const claude = await startMockClaude((req, n) => script(req, n));

process.env.STELLA_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'stella-claude-'));
process.env.STELLA_SECRET = 'test-secret-1234567890';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key-123456';
process.env.ANTHROPIC_BASE_URL = claude.url;
process.env.STELLA_CLAUDE_RETRY_MS = '5';
process.env.OPENROUTER_API_KEY = 'test';
process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${(openRouter.address() as AddressInfo).port}`;

const { register } = await import('./auth.ts');
const { complete, LlmUnavailable } = await import('./llm.ts');
const { buildClaudeRequest } = await import('./claude.ts');
const { costMicroUsd, costForUser, costTotals } = await import('./costs.ts');
const { pickTier, resolveTier } = await import('./router.ts');
const { handleChat } = await import('./assistant.ts');
const { setServerAiSettings, testKey } = await import('./keys.ts');
const { db } = await import('./db.ts');

after(async () => { await claude.close(); openRouter.close(); });

const { user } = register('Lukas', 'l@example.com', 'supergeheim', 'Europe/Vienna');
const today = new Date().toISOString().slice(0, 10);

const TOOLS = [
  { type: 'function' as const, function: { name: 'create_entry', description: 'Eintrag anlegen', parameters: { type: 'object', properties: { title: { type: 'string' }, due: { type: 'string' } }, required: ['title', 'due'] } } },
  { type: 'function' as const, function: { name: 'list_entries', description: 'Einträge zeigen', parameters: { type: 'object', properties: { from: { type: 'string' } } } } },
];

test('Umwandlung: Werkzeug-Runde, Bild und zwei Ergebnisse in einer Nutzer-Nachricht', () => {
  const body = buildClaudeRequest([
    { role: 'system', content: 'FEST', dynamic: 'JETZT 12:00' },
    { role: 'user', content: [{ type: 'text', text: 'Was ist das?' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] },
    { role: 'assistant', content: 'Ich schaue nach.', tool_calls: [
      { id: 'call/1', type: 'function', function: { name: 'create_entry', arguments: '{"title":"A","due":"2026-11-02"}' } },
      { id: 'call/2', type: 'function', function: { name: 'list_entries', arguments: '' } },
    ] },
    { role: 'tool', tool_call_id: 'call/1', content: '{"ok":true}' },
    { role: 'tool', tool_call_id: 'call/2', content: '[]' },
  ], TOOLS, { strict: true });

  assert.deepEqual(body.messages.map((m) => m.role), ['user', 'assistant', 'user'], 'beide Ergebnisse in EINER Nutzer-Nachricht');
  const user0 = body.messages[0]!.content as Record<string, any>[];
  assert.equal(user0[1]!.type, 'image');
  assert.deepEqual(user0[1]!.source, { type: 'base64', media_type: 'image/png', data: 'AAAA' });
  const assistant = body.messages[1]!.content as Record<string, any>[];
  assert.equal(assistant[0]!.type, 'text');
  assert.deepEqual(assistant[1], { type: 'tool_use', id: 'call_1', name: 'create_entry', input: { title: 'A', due: '2026-11-02' } }, 'ID bereinigt, Argumente per JSON.parse');
  assert.deepEqual(assistant[2]!.input, {}, 'kaputte/leere Argumente → leeres Objekt');
  const results = body.messages[2]!.content as Record<string, any>[];
  assert.deepEqual(results.map((r) => [r.type, r.tool_use_id]), [['tool_result', 'call_1'], ['tool_result', 'call_2']]);
  // Werkzeuge: Objekte geschlossen; strict nur bei Werkzeugen ohne optionale Felder; Cache-Punkt am letzten Werkzeug
  assert.equal(body.tools![0]!.strict, true);
  assert.equal(body.tools![1]!.strict, undefined);
  assert.equal((body.tools![0]!.input_schema as any).additionalProperties, false);
  assert.deepEqual(body.tools!.at(-1)!.cache_control, { type: 'ephemeral' });
  // System: fester Teil mit Cache-Punkt, veränderlicher danach
  assert.equal(body.system[0]!.text, 'FEST');
  assert.deepEqual(body.system[0]!.cache_control, { type: 'ephemeral' });
  assert.equal(body.system[1]!.text, 'JETZT 12:00');
  assert.equal(body.system[1]!.cache_control, undefined);
});

test('Umwandlung: Rohblöcke (Denken) gehen unverändert zurück, kein Vorbefüllen am Ende', () => {
  const thinking = { type: 'thinking', thinking: '', signature: 'sig' };
  const body = buildClaudeRequest([
    { role: 'user', content: 'Hi' },
    { role: 'assistant', content: null, raw: [thinking, { type: 'tool_use', id: 'toolu_1', name: 'x', input: {} }] },
    { role: 'tool', tool_call_id: 'toolu_1', content: 'ok' },
    { role: 'assistant', content: 'Fertig' },
  ], undefined);
  assert.deepEqual((body.messages[1]!.content as unknown[])[0], thinking);
  assert.equal(body.messages.at(-1)!.role, 'user', 'endet mit "user"');
});

test('Router: Bild lösen → heavy, Text → light, "gründlich" → heavy', () => {
  const u = user;
  assert.equal(pickTier(u, { hasImage: true, solve: true }), 'heavy');
  assert.equal(pickTier(u, { hasImage: true }), 'light', 'Bild allein reicht nicht');
  assert.equal(pickTier(u, { text: 'Trag Zahnarzt am Freitag ein', kind: 'chat' }), 'light');
  assert.equal(pickTier(u, { text: 'Bitte plan das gründlich', kind: 'chat' }), 'heavy');
  assert.equal(pickTier(u, { kind: 'weekplan' }), 'heavy');
  assert.equal(pickTier(u, { kind: 'research' }), 'heavy');
  assert.deepEqual(resolveTier(u, 'heavy'), { tier: 'heavy', downgraded: false });
});

test('Kosten-Rechnung: Haiku, Sonnet, Cache, langer Prompt, Websuche', () => {
  // Preis je Mio. Tokens in $ × Tokens = Mikro-Dollar
  assert.equal(costMicroUsd('claude-haiku-5-5', { input: 1000, output: 200 }), 200); // 1000×0,10 + 200×0,50
  assert.equal(costMicroUsd('claude-sonnet-5-5', { input: 1000, output: 200 }), 4000); // 1000×2 + 200×10
  assert.equal(costMicroUsd('claude-sonnet-5-5', { input: 0, output: 0, cacheRead: 1000 }), 200, 'Cache-Lesen 0,20 $');
  assert.equal(costMicroUsd('claude-haiku-5-5', { input: 120_000, output: 1000 }), 120_000 * 0.5 + 1000 * 2.5, 'über 100K: höherer Tarif');
  assert.equal(costMicroUsd('claude-sonnet-5-5', { input: 0, output: 0, webSearches: 3 }), 30_000, '1 Cent je Suche');
  assert.equal(costMicroUsd('unbekannt', { input: 5, output: 5 }), 0);
});

test('light: Haiku, Effort low, keine Temperatur, Werkzeug-Aufruf kommt als JSON-Text zurück; Kosten werden gezählt', async () => {
  script = () => toolUse('create_entry', { title: 'Zahnarzt', due: '2026-11-20' }, 'toolu_abc');
  const before = costForUser(user.id, today, today).totalMicroUsd;
  const { message, model } = await complete([{ role: 'system', content: 'Sys' }, { role: 'user', content: 'Zahnarzt' }], TOOLS, { userId: user.id });
  const req = claude.requests.at(-1)!;
  assert.equal(req.body.model, 'claude-haiku-5-5');
  assert.equal(model, 'claude-haiku-5-5');
  assert.deepEqual(req.body.output_config, { effort: 'low' });
  assert.deepEqual(req.body.tool_choice, { type: 'auto' }, 'keine Zwangs-Werkzeuge');
  assert.equal(req.body.temperature, undefined);
  assert.ok(req.headers['x-api-key'] === 'sk-ant-test-key-123456' || /sk-ant-test-key-123456/.test(String(req.headers.authorization)), JSON.stringify(Object.keys(req.headers)));
  assert.deepEqual(message.tool_calls, [{ id: 'toolu_abc', type: 'function', function: { name: 'create_entry', arguments: JSON.stringify({ title: 'Zahnarzt', due: '2026-11-20' }) } }]);
  assert.equal(costForUser(user.id, today, today).totalMicroUsd - before, 200, '1000 ein, 200 aus bei Haiku');
  assert.ok(costTotals(today, today).byModel.some((r) => r.model === 'claude-haiku-5-5'));
});

test('heavy: Sonnet mit Server-Fallback "default"; Ablehnung von Haiku wird mit Sonnet wiederholt', async () => {
  script = () => text('Gelöst');
  await complete([{ role: 'user', content: 'Rechne' }], undefined, { tier: 'heavy', userId: user.id });
  let req = claude.requests.at(-1)!;
  assert.equal(req.body.model, 'claude-sonnet-5-5');
  assert.equal(req.body.fallbacks, 'default');
  assert.match(String(req.headers['anthropic-beta']), /server-side-fallback-2026-07-01/);
  assert.deepEqual(req.body.output_config, { effort: 'medium' });

  const n = claude.requests.length;
  script = (r) => (r.body.model === 'claude-haiku-5-5' ? refusal() : text('Sonnet hat es übernommen'));
  const res = await complete([{ role: 'user', content: 'Frage' }], undefined, {});
  assert.equal(res.message.content, 'Sonnet hat es übernommen');
  assert.deepEqual(claude.requests.slice(n).map((r) => r.body.model), ['claude-haiku-5-5', 'claude-sonnet-5-5']);

  // die ganze Kette lehnt ab → klarer Fehler statt leerer Antwort
  script = () => refusal();
  await assert.rejects(complete([{ role: 'user', content: 'x' }], undefined, {}), LlmUnavailable);
  req = claude.requests.at(-1)!;
});

test('Ausweichkette: 429 → eine Wiederholung; heavy fällt danach auf Haiku; OpenRouter nur mit Erlaubnis und nie für Mails', async () => {
  // 429 beim ersten Mal, dann klappt es
  let n0 = claude.requests.length;
  script = (_r, n) => (n === n0 + 1 ? httpError(429) : text('nach Wiederholung'));
  assert.equal((await complete([{ role: 'user', content: 'a' }], undefined, {})).message.content, 'nach Wiederholung');
  assert.equal(claude.requests.length - n0, 2);

  // Sonnet dauerhaft überlastet → Haiku übernimmt
  n0 = claude.requests.length;
  script = (r) => (r.body.model === 'claude-sonnet-5-5' ? httpError(529, 'overloaded_error') : text('Haiku statt Sonnet'));
  const r2 = await complete([{ role: 'user', content: 'b' }], undefined, { tier: 'heavy' });
  assert.equal(r2.message.content, 'Haiku statt Sonnet');
  assert.deepEqual(claude.requests.slice(n0).map((r) => r.body.model), ['claude-sonnet-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']);

  // alles kaputt: ohne Erlaubnis kein OpenRouter
  script = () => httpError(500);
  openRouterCalls = 0;
  await assert.rejects(complete([{ role: 'user', content: 'c' }], undefined, {}), LlmUnavailable);
  assert.equal(openRouterCalls, 0);

  // mit Erlaubnis des Owners: Notfall über OpenRouter – aber nie für vertrauliche Inhalte (Mails)
  setServerAiSettings({ allowFreeFallback: true });
  assert.equal((await complete([{ role: 'user', content: 'd' }], undefined, {})).message.content, 'Notfall-Antwort');
  assert.equal(openRouterCalls, 1);
  await assert.rejects(complete([{ role: 'user', content: 'Mail-Inhalt' }], undefined, { private: true }), LlmUnavailable);
  assert.equal(openRouterCalls, 1, 'Mail-Inhalte gehen nie an Gratis-Anbieter');
  setServerAiSettings({ allowFreeFallback: false });
});

test('Chat-Agent: Haiku ruft escalate → derselbe Zug läuft einmal mit Sonnet', async () => {
  const n0 = claude.requests.length;
  script = (r) => {
    if (r.body.model === 'claude-haiku-5-5') return toolUse('escalate', { reason: 'lange Planung' }, 'toolu_esc');
    const hasResult = JSON.stringify(r.body.messages).includes('tool_result');
    return hasResult ? text('Plan steht (Sonnet)') : toolUse('create_entry', { title: 'Plan', due: '2026-11-20', kind: 'todo' }, 'toolu_s1');
  };
  const res = await handleChat(user, 'Plan mir bitte eine komplizierte Projektwoche', 'esc1');
  assert.equal(res.messages.at(-1)!.text, 'Plan steht (Sonnet)');
  const models = claude.requests.slice(n0).map((r) => r.body.model);
  assert.deepEqual(models, ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-sonnet-5-5']);
  // Haiku bekam escalate zu sehen, Sonnet nicht mehr
  assert.ok(claude.requests[n0]!.body.tools.some((t: any) => t.name === 'escalate'));
  assert.ok(!claude.requests[n0 + 1]!.body.tools.some((t: any) => t.name === 'escalate'));
});

test('Caching: der feste Teil (Werkzeuge + System) bleibt zwischen zwei Anfragen identisch, die zweite liest aus dem Cache', async () => {
  script = () => text('Hallo');
  const n0 = claude.requests.length;
  await handleChat(user, 'Hallo Stella, wie geht es dir?', 'c1');
  await new Promise((r) => setTimeout(r, 1100)); // andere Uhrzeit/Sekunde im veränderlichen Teil
  await handleChat(user, 'Noch eine freie Frage ohne Schlagwort', 'c2');
  const [a, b] = claude.requests.slice(n0).filter((r) => r.body.tools);
  assert.ok(a && b);
  assert.deepEqual(a.body.tools, b.body.tools);
  assert.equal(a.body.system[0].text, b.body.system[0].text, 'fester Teil unverändert');
  assert.ok(a.body.system[0].cache_control && a.body.tools.at(-1).cache_control);
  assert.ok(!/\d\d:\d\d/.test(a.body.system[0].text), 'keine Uhrzeit im festen Teil');
  assert.match(a.body.system[1].text, /Jetzt: .*Uhr/);
  // der Mock meldet beim zweiten Mal Cache-Treffer – das landet in der Kostenzählung
  const row = db.prepare('SELECT SUM(cache_read_tokens) AS n FROM llm_cost WHERE user_id = ?').get(user.id) as { n: number };
  assert.ok(row.n > 0, 'cache_read_input_tokens wurde mitgezählt');
});

test('Schlüssel "Testen": Anthropic fragt die Modell-Liste ab', async () => {
  const r = await testKey('anthropic');
  assert.equal(r.ok, true);
});
