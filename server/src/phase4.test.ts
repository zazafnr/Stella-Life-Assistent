import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

// Nachgebaute KI: schreibt einen Antwort-Entwurf bzw. ruft reply_mail auf
const mock = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/models') { res.end(JSON.stringify({ data: [{ id: 'good/model:free', supported_parameters: ['tools'] }] })); return; }
    const json = JSON.parse(body);
    const sys = String(json.messages[0]?.content ?? '');
    if (sys.includes('E-Mail-Antworten im Namen')) {
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Sehr geehrte Frau Huber,\n\nich bin morgen leider krank.\n\nLiebe Grüße\nLukas' } }] }));
      return;
    }
    const hasTool = json.messages.some((m: { role: string }) => m.role === 'tool');
    const inboxId = /\[([0-9a-f-]{36})\] email/.exec(sys)?.[1];
    res.end(JSON.stringify({ choices: [{ message: hasTool
      ? { role: 'assistant', content: 'Hab dir eine Antwort geschrieben – schau kurz drüber.' }
      : { role: 'assistant', content: null, tool_calls: [{ id: 'r1', type: 'function', function: { name: 'reply_mail', arguments: JSON.stringify({ inbox_id: inboxId, instruction: 'bin morgen krank' }) } }] } }] }));
  });
});
await new Promise<void>((r) => mock.listen(0, r));
after(() => mock.close());

process.env.STELLA_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'stella-p4-'));
process.env.STELLA_SECRET = 'test-secret-1234567890';
process.env.OPENROUTER_API_KEY = 'test';
process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;

const { register } = await import('./auth.ts');
const { db, getUser, listItems, newId, recentMessages, updateUserSettings } = await import('./db.ts');
const { cleanVerdict, draftReply, getMailEvent, offerDeadline, saveAccounts } = await import('./mail.ts');
const { approve, getAction } = await import('./actions.ts');
const { findHints } = await import('./hints.ts');
const { handleChat } = await import('./assistant.ts');
const { addDays, todayIn } = await import('@stella/shared');

const { user: created } = register('Lukas', 'lukas@example.com', 'supergeheim', 'Europe/Vienna');
const user = () => getUser(created.id)!;
const today = todayIn('Europe/Vienna');
saveAccounts(created.id, [{ id: 'acc1', provider: 'gmail', label: 'Privat', host: 'imap.gmail.com', port: 993, user: 'lukas@gmail.com', pass: 'x' }]);

function mailEvent(fields: Record<string, unknown>, hoursAgo = 0) {
  const id = newId();
  db.prepare('INSERT INTO inbox_events (id, user_id, source, sender, text, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, created.id, 'email', 'Frau Huber', 'Wandertag Freitag', JSON.stringify({
      accountId: 'acc1', account: 'Privat', category: 'important', summary: 'Wandertag: Einverständnis bis Freitag abgeben',
      fromAddress: 'huber@schule.at', messageId: '<abc@schule.at>', snippet: 'Bitte die Einverständniserklärung bis Freitag abgeben.', ...fields,
    }), new Date(Date.now() - hoursAgo * 3600_000).toISOString());
  return id;
}

test('KI-Antwort wird geprüft: Frist nur gültig, in der Zukunft und mit Inhalt', () => {
  const v = cleanVerdict({ category: 'important', summary: 'x', confidence: 0.9, reason: 'Klassenvorstand', needsReply: true,
    deadline: { date: addDays(today, 3), time: '7:30', what: 'Formular abgeben' } }, today)!;
  assert.deepEqual(v.deadline, { date: addDays(today, 3), time: null, what: 'Formular abgeben' });
  assert.equal(v.needsReply, true);
  assert.equal(cleanVerdict({ category: 'important', deadline: { date: addDays(today, -1), what: 'alt' } }, today)!.deadline, null);
  assert.equal(cleanVerdict({ category: 'quatsch' }, today), null);
});

test('Frist aus einer Mail: Planer auf "selbst" → eingetragen mit Rückgängig, auf "fragen" → Karte', () => {
  const id = mailEvent({});
  offerDeadline(user(), id, 'Frau Huber', { date: addDays(today, 2), time: null, what: 'Einverständnis abgeben' });
  assert.ok(listItems(created.id, {}).some((i) => i.title === 'Einverständnis abgeben' && i.detail === 'aus der Mail von Frau Huber'));
  assert.match(recentMessages(created.id, 1)[0]!.text, /Aus der Mail von Frau Huber eingetragen/);
  assert.ok(getMailEvent(created.id, id)!.payload.deadlineActionId);

  updateUserSettings(created.id, { permissions: { planner: 'ask' } });
  offerDeadline(user(), mailEvent({}), 'Frau Huber', { date: addDays(today, 4), time: '08:00', what: 'Geld mitbringen' });
  const card = recentMessages(created.id, 1)[0]!;
  assert.match(card.text, /Soll ich das eintragen\?/);
  assert.equal(getAction(created.id, card.actionId!)!.status, 'proposed');
  updateUserSettings(created.id, { permissions: { planner: 'auto' } });
});

test('Antwort entwerfen: Sie-Form, Betreff mit Re:, Antwort an den Absender', async () => {
  const id = mailEvent({ needsReply: true });
  const d = await draftReply(user(), id, 'bin morgen krank');
  assert.equal(d.to, 'huber@schule.at');
  assert.equal(d.subject, 'Re: Wandertag Freitag');
  assert.equal(d.inReplyTo, '<abc@schule.at>');
  assert.match(d.body, /Sehr geehrte Frau Huber/);
});

test('Senden ist heikel: auch auf Bitte im Chat erst als Karte mit dem vollen Text, nach Ja wird gesendet', async () => {
  const id = mailEvent({ needsReply: true });
  const res = await handleChat(user(), 'schreib Frau Huber dass ich morgen krank bin', null);
  const card = res.messages.find((m) => m.actionId && m.text.includes('Soll ich das so senden?'))!;
  assert.ok(card, 'Karte mit dem Entwurf');
  assert.match(card.text, /> ich bin morgen leider krank\./);
  assert.equal(getAction(created.id, card.actionId!)!.status, 'proposed');
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE type = 'send_mail'`).get() as { n: number }).n, 0, 'noch nichts gesendet');

  approve(created.id, card.actionId!);
  const job = db.prepare(`SELECT payload FROM jobs WHERE type = 'send_mail'`).get() as { payload: string };
  assert.equal(JSON.parse(job.payload).to, 'huber@schule.at');
  assert.equal(JSON.parse(job.payload).eventId, id);
});

test('"Mails senden" auf "nie" → Stella sendet gar nicht', async () => {
  updateUserSettings(created.id, { permissions: { mail_send: 'never' } });
  mailEvent({ needsReply: true });
  const res = await handleChat(user(), 'antworte Frau Huber dass ich krank bin', null);
  assert.ok(!res.messages.some((m) => m.text.includes('Soll ich das so senden?')));
  updateUserSettings(created.id, { permissions: { mail_send: 'ask' } });
});

test('Mail wartet seit über 12 Stunden auf Antwort → Hinweis mit Weg in die Inbox', () => {
  const id = mailEvent({ needsReply: true }, 20);
  const h = findHints(user()).find((x) => x.key === `reply:${id}`)!;
  assert.ok(h);
  assert.deepEqual(h.open, { tab: 'inbox', label: 'Antwort schreiben' });
});
