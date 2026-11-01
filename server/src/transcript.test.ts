import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { startMockClaude, text, httpError, type MockRequest } from './testing/mockClaude.ts';

// Whisper-Mock: liefert, was `raw` gerade ist
let raw = 'ähm also ich muss halt morgen um 15 Uhr zum Zahnarzt ähm zum Zahnarzt';
const groq = createServer((req, res) => {
  req.on('data', () => {});
  req.on('end', () => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ text: ` ${raw} ` })); });
});
await new Promise<void>((r) => groq.listen(0, r));

// Claude-Mock: Aufräum-Anfragen erkennt er am Systemtext; alles andere ist der Chat-Agent
let cleanReply: string | 'down' = 'Ich muss morgen um 15 Uhr zum Zahnarzt.';
const cleanups: MockRequest[] = [];
const agentTexts: string[] = [];
const claude = await startMockClaude((req) => {
  const sys = JSON.stringify(req.body.system ?? '');
  if (sys.includes('You clean up the speech-to-text') || sys.includes('You add punctuation')) {
    cleanups.push(req);
    return cleanReply === 'down' ? httpError(500) : text(cleanReply);
  }
  agentTexts.push(JSON.stringify(req.body.messages));
  return text('Alles klar.');
});
after(() => { groq.close(); return claude.close(); });

process.env.STELLA_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'stella-transcript-'));
process.env.STELLA_SECRET = 'test-secret-1234567890';
process.env.STELLA_ALLOW_REGISTRATION = 'true';
process.env.OPENROUTER_API_KEY = '';
process.env.GROQ_API_KEY = 'gsk_test-key-1234567890';
process.env.GROQ_BASE_URL = `http://127.0.0.1:${(groq.address() as AddressInfo).port}/groq`;
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key-123456';
process.env.ANTHROPIC_BASE_URL = claude.url;
process.env.STELLA_CLAUDE_RETRY_MS = '5';

const { register } = await import('./auth.ts');
const { updateUserSettings, getUser } = await import('./db.ts');
const { handleAudio } = await import('./audio.ts');
const { cleanTranscript, numbersIn, looksFaithful } = await import('./transcript.ts');
const billing = await import('./billing.ts');

const reg = register('Lena', 'lena@example.com', 'supergeheim', 'Europe/Vienna');
updateUserSettings(reg.user.id, { locale: 'de' });
const user = () => getUser(reg.user.id)!;
const recording = Buffer.alloc(5000, 7);
type Att = { transcriptRaw?: string; transcript?: string; duration?: number; kind: string };

test('Aufräumen: sauberer Text im Chat, Rohtext und Dauer hängen an der Aufnahme, Stella verarbeitet den sauberen Text', async () => {
  cleanups.length = 0; agentTexts.length = 0;
  const used = billing.usedCount(user(), 'ai_message');
  const res = await handleAudio(user(), { audio: recording, mime: 'audio/mp4', durationSec: 12.4, clientId: 'c1' });
  assert.equal(res.transcript, 'Ich muss morgen um 15 Uhr zum Zahnarzt.');
  assert.equal(res.userMessage!.text, 'Ich muss morgen um 15 Uhr zum Zahnarzt.');
  const att = res.userMessage!.attachments.find((a: Att) => a.kind === 'audio') as Att;
  assert.equal(att.transcriptRaw, raw);
  assert.equal(att.transcript, 'Ich muss morgen um 15 Uhr zum Zahnarzt.');
  assert.equal(att.duration, 12);
  assert.ok(!agentTexts.some((t) => t.includes('ähm')), 'was weiterverarbeitet wird, ist der bereinigte Text (nie der Rohtext)');
  // Prompt: Beispiele, light/low, nur Claude (nie Gratis-Modelle)
  const body = cleanups[0]!.body;
  assert.match(JSON.stringify(body.system), /NEVER add content/);
  assert.match(JSON.stringify(body.system), /Examples/);
  assert.ok(String(body.model).includes('haiku'));
  // zählt nicht als KI-Nachricht (nur die Antwort des Agenten zählt wie immer eine)
  assert.ok(billing.usedCount(user(), 'ai_message') - used <= 1, 'Aufräumen verbraucht kein eigenes Kontingent');
});

test('Zahlen, Daten und Namen müssen gleich bleiben – sonst gilt der Rohtext', async () => {
  raw = 'Mathe Seite 45 Nummer 3 bis Freitag 14.11.';
  cleanReply = 'Mathe, Seite 46, Nummer 3, bis Freitag, 14.11.';
  const r = await cleanTranscript(raw, user());
  assert.deepEqual(r, { text: raw, raw, cleaned: false });
  cleanReply = 'Mathe: Seite 45, Nummer 3, bis Freitag, 14.11.';
  const ok = await cleanTranscript(raw, user());
  assert.equal(ok.cleaned, true);
  assert.deepEqual(numbersIn(ok.text), numbersIn(raw));
  assert.ok(looksFaithful('a 1 b', 'a 1 b.'));
  assert.ok(!looksFaithful('a 1 b', 'a 2 b'));
  assert.ok(!looksFaithful('kurz', 'kurz '.repeat(30)), 'nichts dazuerfinden: viel längerer Text wird abgelehnt');
});

test('Sehr kurze Nachricht (unter 6 Wörtern): nur Satzzeichen', async () => {
  cleanups.length = 0;
  raw = 'ja passt morgen';
  cleanReply = 'Ja, passt morgen.';
  const r = await cleanTranscript(raw, user());
  assert.equal(r.text, 'Ja, passt morgen.');
  assert.match(JSON.stringify(cleanups[0]!.body.system), /very short/);
});

test('Ausfall der Bereinigung: der Rohtext gilt, kein Fehler für die Person', async () => {
  raw = 'Zahnarzt morgen um 15 Uhr bitte nicht vergessen';
  cleanReply = 'down';
  const res = await handleAudio(user(), { audio: recording, mime: 'audio/mp4', clientId: 'c2' });
  assert.equal(res.transcript, raw);
  const att = res.userMessage!.attachments.find((a: Att) => a.kind === 'audio') as Att;
  assert.equal(att.transcriptRaw, raw);
  assert.equal(att.transcript, undefined, 'nichts Bereinigtes gespeichert');
});

test('Ohne Claude-Schlüssel bleibt der Rohtext (vertrauliche Inhalte gehen nie an Gratis-Modelle)', async () => {
  const { setKey } = await import('./keys.ts');
  raw = 'noch ein Test mit genug Wörtern drin';
  cleanReply = 'Noch ein Test mit genug Wörtern drin.';
  const before = cleanups.length;
  const prevKey = process.env.ANTHROPIC_API_KEY;
  setKey('anthropic', null);
  const { config } = await import('./config.ts');
  const savedKey = config.anthropic.apiKey;
  config.anthropic.apiKey = '';
  const r = await cleanTranscript(raw, user());
  config.anthropic.apiKey = savedKey;
  process.env.ANTHROPIC_API_KEY = prevKey;
  assert.equal(r.cleaned, false);
  assert.equal(cleanups.length, before, 'es ging keine Anfrage raus');
});
