import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

// Mock-Groq: ordnet nach dem Betreff ein – "Rabatt" = Werbung, "Newsletter" = unwichtig, "Bestellung" = neutral, sonst wichtig
const groqCalls: number[] = [];
const mock = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/groq/chat/completions') {
      const prompt = JSON.parse(body).messages[1].content as string;
      const mails = JSON.parse(prompt.slice(prompt.indexOf('\n[') + 1, prompt.indexOf('\n\nFormat:'))) as { id: number; subject: string }[];
      groqCalls.push(mails.length);
      const category = (s: string) => /rabatt/i.test(s) ? 'spam' : /newsletter/i.test(s) ? 'newsletter' : /bestellung/i.test(s) ? 'normal' : 'important';
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify({ mails: mails.map((m) => ({
        id: m.id, category: category(m.subject), summary: m.subject, confidence: 0.95, reason: category(m.subject) === 'important' ? 'persönlich' : undefined, needsReply: false, deadline: null })) }) } }] }));
      return;
    }
    res.end('{}');
  });
});
await new Promise<void>((r) => mock.listen(0, r));
after(() => mock.close());
const base = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;

process.env.STELLA_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'stella-mail-'));
process.env.STELLA_SECRET = 'test-secret-1234567890';
process.env.OPENROUTER_API_KEY = '';
process.env.GROQ_API_KEY = 'gsk_test-key-1234567890';
process.env.GROQ_BASE_URL = `${base}/groq`;

const { register } = await import('./auth.ts');
const { db, getUser, updateUserSettings } = await import('./db.ts');
const { classify, checkAllMail, cleanBody, getMailBody, mailAction, moveMail, purgeMailBodies, saveAccounts, setMailClientFactory, setSenderRule, senderRule } = await import('./mail.ts');

const { user: created } = register('Lukas', 'lukas@example.com', 'supergeheim', 'Europe/Vienna');
saveAccounts(created.id, [{ id: 'acc1', provider: 'gmail', label: 'Privat', host: 'imap.gmail.com', port: 993, user: 'lukas@gmail.com', pass: 'x' }]);

const mail = (uid: number, subject: string, address = `absender${uid}@example.com`) => ({
  uid, messageId: `<m${uid}@example.com>`, from: `Absender ${uid}`, fromAddress: address, subject, date: new Date().toISOString(), snippet: `Text zu ${subject}`, hasUnsubscribe: false,
});

test('Einordnung über Groq: alle vier Klassen', async () => {
  const v = await classify([mail(1, 'Wandertag Einverständnis'), mail(2, 'Deine Bestellung ist unterwegs'), mail(3, 'Newsletter Oktober'), mail(4, '50 % Rabatt nur heute')], '2026-10-30', created.id);
  assert.equal(v.get(1)!.category, 'important');
  assert.equal(v.get(2)!.category, 'normal');
  assert.equal(v.get(3)!.category, 'newsletter');
  assert.equal(v.get(4)!.category, 'spam');
});

test('alle neuen Mails kommen dran, in Gruppen à 20', async () => {
  groqCalls.length = 0;
  const many = Array.from({ length: 45 }, (_, i) => mail(100 + i, `Hallo ${i}`));
  const v = await classify(many, '2026-10-30', created.id);
  assert.deepEqual(groqCalls, [20, 20, 5]);
  assert.equal(v.size, 45);
});

test('Absender-Regel überschreibt die KI und braucht keinen KI-Aufruf', async () => {
  setSenderRule(created.id, 'Shop@Example.com', 'important');
  groqCalls.length = 0;
  const v = await classify([mail(200, '50 % Rabatt auf alles', 'shop@example.com')], '2026-10-30', created.id);
  assert.equal(v.get(200)!.category, 'important');
  assert.equal(v.get(200)!.fromRule, true);
  assert.deepEqual(groqCalls, []);
});

test('Werbung → Papierkorb nur bei „Werbung löschen“ = auto; geschützte Wörter und Regeln', () => {
  const spam = { category: 'spam' as const, summary: '', confidence: 0.9 };
  assert.equal(mailAction(spam, '50 % Rabatt', true), 'trash');
  assert.equal(mailAction(spam, '50 % Rabatt', false), 'keep');
  assert.equal(mailAction(spam, 'Rechnung offen', true), 'keep', 'geschützte Wörter bleiben liegen');
  assert.equal(mailAction({ ...spam, fromRule: true, confidence: 1 }, 'Rechnung offen', true), 'trash', 'Absender-Regel des Nutzers zählt');
  assert.equal(mailAction({ ...spam, confidence: 0.5 }, '50 % Rabatt', true), 'keep');
  assert.equal(mailAction({ category: 'newsletter', summary: '', confidence: 1 }, 'Newsletter', true), 'keep', 'Unwichtig bleibt liegen');
  assert.equal(mailAction({ category: 'important', summary: '', confidence: 1 }, 'Hallo', true), 'notify');
});

// ----- Mock-Postfach -----

const moved: { uid: string; to: string }[] = [];
let fetchOneCalls = 0;
const raw = (subject: string, text: string, id: string) => Buffer.from(`From: Absender <a@example.com>\r\nSubject: ${subject}\r\nMessage-ID: ${id}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${text}\r\n`);
const inbox = [
  { uid: 11, subject: 'Wandertag Einverständnis', id: '<m11@x>', text: 'Bitte bis Freitag abgeben.\n> alter Text, zitiert\nLiebe Grüße\nFrau Huber' },
  { uid: 12, subject: '50 % Rabatt nur heute', id: '<m12@x>', text: 'Jetzt zuschlagen!' },
];
setMailClientFactory(async () => ({
  connect: async () => {}, logout: async () => {},
  mailbox: { uidValidity: 7n, uidNext: 13 },
  getMailboxLock: async () => ({ release() {} }),
  list: async () => [{ path: 'Papierkorb', specialUse: '\\Trash' }],
  fetch: async function* () {
    for (const m of inbox) yield { uid: m.uid, envelope: { from: [{ name: `Absender ${m.uid}`, address: `a${m.uid}@example.com` }], subject: m.subject, date: new Date(), messageId: m.id }, source: raw(m.subject, m.text, m.id) };
  },
  messageMove: async (uid: string, to: string) => { moved.push({ uid, to }); },
  search: async (q: { header: Record<string, string> }) => inbox.filter((m) => m.id === q.header['message-id']).map((m) => m.uid),
  fetchOne: async (uid: string) => { fetchOneCalls++; const m = inbox.find((x) => String(x.uid) === uid); return m ? { source: raw(m.subject, m.text, m.id) } : false; },
}) as never);

const seedState = () => db.prepare('INSERT OR REPLACE INTO mail_state (user_id, account_id, uid_validity, last_uid, checked_at) VALUES (?, ?, ?, ?, ?)').run(created.id, 'acc1', '7', 10, new Date().toISOString());
const events = () => db.prepare("SELECT id, payload FROM inbox_events WHERE user_id = ? AND source = 'email' ORDER BY created_at, rowid").all(created.id) as { id: string; payload: string }[];

test('Postfach prüfen: Werbung im Papierkorb, Wichtiges bleibt – mit uid für den Volltext', async () => {
  seedState();
  await checkAllMail(created.id);
  assert.deepEqual(moved, [{ uid: '12', to: 'Papierkorb' }]);
  const [important, ad] = events().map((e) => JSON.parse(e.payload));
  assert.equal(important.category, 'important');
  assert.equal(important.action, 'notify');
  assert.equal(important.uid, 11);
  assert.equal(important.mailbox, 'INBOX');
  assert.equal(ad.category, 'spam');
  assert.equal(ad.action, 'trash');
});

test('„Werbung löschen“ auf nie: nichts wird verschoben', async () => {
  updateUserSettings(created.id, { permissions: { mail_sort: 'never' } });
  moved.length = 0;
  db.prepare("DELETE FROM inbox_events WHERE user_id = ?").run(created.id);
  seedState();
  await checkAllMail(created.id);
  assert.deepEqual(moved, []);
  assert.equal(JSON.parse(events()[1]!.payload).action, 'keep');
  updateUserSettings(created.id, { permissions: { mail_sort: 'auto' } });
});

test('Volltext: per IMAP geholt, bereinigt, 30 Tage gemerkt, danach gelöscht', async () => {
  const id = events()[0]!.id;
  fetchOneCalls = 0;
  const first = await getMailBody(created.id, id);
  assert.equal(first.cached, false);
  assert.match(first.body, /Bitte bis Freitag abgeben\./);
  assert.ok(!first.body.includes('zitiert'), 'zitierte Zeilen fliegen raus');
  const second = await getMailBody(created.id, id);
  assert.equal(second.cached, true);
  assert.equal(fetchOneCalls, 1, 'nur ein IMAP-Abruf');
  db.prepare('UPDATE mail_bodies SET fetched_at = ?').run(new Date(Date.now() - 31 * 86_400_000).toISOString());
  purgeMailBodies();
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM mail_bodies').get() as { n: number }).n, 0);
});

test('Volltext einer in den Papierkorb gelegten Mail wird über die Message-ID gefunden', async () => {
  const adId = events()[1]!.id;
  const b = await getMailBody(created.id, adId);
  assert.match(b.body, /Jetzt zuschlagen/);
});

test('von Hand verschieben: merkt sich den Absender', async () => {
  const id = events()[1]!.id;
  const r = await moveMail(created.id, id, 'newsletter');
  assert.equal(r.restored, false);
  assert.equal(senderRule(created.id, 'a12@example.com'), 'newsletter');
  assert.equal(JSON.parse(events()[1]!.payload).category, 'newsletter');
  // das nächste Mail dieses Absenders landet gleich dort, ohne KI
  groqCalls.length = 0;
  const v = await classify([mail(300, '50 % Rabatt', 'a12@example.com')], '2026-10-30', created.id);
  assert.equal(v.get(300)!.category, 'newsletter');
  assert.deepEqual(groqCalls, []);
});

test('aus der Werbung zurückholen: Mail geht aus dem Papierkorb zurück in die Inbox', async () => {
  db.prepare('DELETE FROM inbox_events WHERE user_id = ?').run(created.id);
  db.prepare('DELETE FROM mail_rules WHERE user_id = ?').run(created.id);
  moved.length = 0;
  seedState();
  await checkAllMail(created.id);
  assert.deepEqual(moved, [{ uid: '12', to: 'Papierkorb' }]);
  const adId = events()[1]!.id;
  const r = await moveMail(created.id, adId, 'normal');
  assert.equal(r.restored, true);
  assert.deepEqual(moved.at(-1), { uid: '12', to: 'INBOX' });
  assert.equal(JSON.parse(events()[1]!.payload).action, 'restored');
  assert.equal(JSON.parse(events()[1]!.payload).category, 'normal');
});

test('Text bereinigen: Leerzeilen, Zitate, Länge', () => {
  assert.equal(cleanBody('a\r\n\r\n\r\n\r\n> zitat\r\nb  ').body, 'a\n\nb');
  const long = cleanBody('x'.repeat(30_000));
  assert.equal(long.truncated, true);
  assert.ok(long.body.length <= 20_005);
  void getUser;
});
