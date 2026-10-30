import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

// Mock-OpenRouter: merkt sich den System-Prompt des Agenten
const prompts: string[] = [];
const mock = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/models') { res.end(JSON.stringify({ data: [{ id: 'good/model:free', supported_parameters: ['tools'] }] })); return; }
    prompts.push(String(JSON.parse(body).messages[0]?.content ?? ''));
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Klar!' } }] }));
  });
});
await new Promise<void>((r) => mock.listen(0, r));
after(() => mock.close());

process.env.STELLA_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'stella-p6-'));
process.env.STELLA_SECRET = 'test-secret-1234567890';
process.env.STELLA_ALLOW_REGISTRATION = 'true';
process.env.OPENROUTER_API_KEY = 'test';
process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;

const { register } = await import('./auth.ts');
const { db, getUser, newId } = await import('./db.ts');
const { handleChat } = await import('./assistant.ts');
const { applyProfile } = await import('./profile.ts');
const { quickActions } = await import('./quick.ts');
const { STYLE_RULES } = await import('@stella/shared');

const school = register('Lukas', 'lukas@example.com', 'supergeheim', 'Europe/Vienna').user;
const job = register('Mia', 'mia@example.com', 'supergeheim', 'Europe/Vienna').user;
applyProfile(getUser(job.id)!, { situation: 'work', features: ['planner', 'mails', 'shopping', 'goals', 'finance'], workHours: { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' } });
applyProfile(getUser(school.id)!, { situation: 'school', features: ['planner', 'homework', 'mails'] });

const ids = (u: { id: string }, hour: number) => quickActions(getUser(u.id)!, hour).actions.map((a) => a.id);

test('Schnellaktionen nach Profil: Schule sieht HÜ und Foto, Job sieht Einkauf, Ziele, Ausgaben', () => {
  const s = ids(school, 14);
  assert.ok(s.includes('photo') && s.includes('homework') && s.includes('voice') && s.includes('week') && s.includes('mail'));
  assert.ok(!s.includes('shopping') && !s.includes('spending') && !s.includes('goal'));
  const j = ids(job, 14);
  assert.ok(j.includes('shopping') && j.includes('goal') && j.includes('spending') && j.includes('mail') && j.includes('voice'));
  assert.ok(!j.includes('photo') && !j.includes('homework'), 'keine Schul-Chips im Job');
});

test('Schnellaktionen nach Tageszeit: morgens Briefing zuerst, abends „Hab ich was vergessen?“, tagsüber kein Briefing vorn', () => {
  assert.equal(ids(job, 8)[0], 'briefing');
  assert.equal(ids(job, 20)[0], 'forgot');
  assert.notEqual(ids(job, 14)[0], 'briefing');
  assert.equal(ids(job, 14).at(-1), 'briefing');
});

test('leerer Chat: genau vier große Karten, jede mit Aktion', () => {
  const { cards } = quickActions(getUser(job.id)!, 9);
  assert.equal(cards.length, 4);
  for (const c of cards) assert.ok(['text', 'send', 'camera', 'mic'].includes(c.kind) && c.label && c.symbol && c.icon);
  assert.ok(quickActions(getUser(job.id)!, 9).actions.filter((a) => a.kind === 'send').every((a) => !!a.text));
});

test('Antwortstil: der System-Prompt enthält die Regeln – und passt zum Profil', async () => {
  prompts.length = 0;
  await handleChat(getUser(job.id)!, 'Wie geht es dir gerade heute?', 'p1');
  await handleChat(getUser(school.id)!, 'Wie geht es dir gerade heute?', 'p2');
  const [jobPrompt, schoolPrompt] = prompts;
  for (const p of [jobPrompt!, schoolPrompt!]) {
    assert.ok(p.includes(STYLE_RULES), 'Stilregeln stehen im Prompt');
    assert.match(p, /höchstens etwa 6 Zeilen/);
    assert.match(p, /Aufzählungen/);
    assert.match(p, /keine Überschriften/i);
  }
  assert.match(jobPrompt!, /Mia arbeitet \(09:00–17:00\)/);
  assert.ok(!/zur Schule/.test(jobPrompt!) && !/solve_homework/.test(jobPrompt!), 'im Job keine Schule');
  assert.match(schoolPrompt!, /Lukas geht in Österreich zur Schule/);
  assert.match(schoolPrompt!, /solve_homework/);
});

test('„Was ist neu in der Mail?“: Überblick über die wichtigen Mails als kurze Liste', async () => {
  const none = await handleChat(getUser(job.id)!, 'Was ist neu in der Mail?', 'm0');
  assert.match(none.messages[0]!.text, /nichts Wichtiges|Nix Wichtiges/i);
  db.prepare('INSERT INTO inbox_events (id, user_id, source, sender, text, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(newId(), job.id, 'email', 'Frau Huber', 'Termin', JSON.stringify({ category: 'important', summary: 'Neuer Termin am Freitag', needsReply: true }), new Date().toISOString());
  const some = await handleChat(getUser(job.id)!, 'Was ist neu in der Mail?', 'm1');
  const text = some.messages[0]!.text;
  assert.match(text, /\*\*1 wichtige Mail\*\*/);
  assert.match(text, /- \*\*Frau Huber\*\*: Neuer Termin am Freitag/);
  assert.ok(text.split('\n').length <= 6);
});
