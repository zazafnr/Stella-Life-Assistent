import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.STELLA_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'stella-mail-'));
process.env.STELLA_SECRET = 'test-secret-1234567890';

const { senderDomain, systemSender, sendSystemMail, setMailTransportFactory } = await import('./mailer.ts');
const { setKey } = await import('./keys.ts');

test('Absender: Domain erkennen, Antworten richtig lenken', () => {
  assert.equal(senderDomain('Stella <noreply@evolsior.com>'), 'evolsior.com');
  assert.equal(senderDomain('noreply@Evolsior.com'), 'evolsior.com');
  assert.equal(senderDomain('kein absender'), null);
  assert.equal(senderDomain(undefined), null);

  assert.deepEqual(systemSender('Stella <noreply@evolsior.com>', 'noreply'), { from: 'Stella <noreply@evolsior.com>', replyTo: 'support@evolsior.com' });
  assert.deepEqual(systemSender('Stella <noreply@evolsior.com>', 'stella'), { from: 'Stella <stella@evolsior.com>', replyTo: 'stella@evolsior.com' });
  assert.deepEqual(systemSender('irgendwas', 'stella'), { from: 'irgendwas' }, 'ohne erkennbare Domain bleibt der eingetragene Absender');
  assert.deepEqual(systemSender(undefined, 'noreply'), {});
});

test('Versand: Bestätigungs-Code von noreply@ mit Antwort an support@, Stella-Mails von stella@', async () => {
  const sent: Record<string, unknown>[] = [];
  setMailTransportFactory(() => ({ sendMail: async (m: Record<string, unknown>) => { sent.push(m); return {} as never; } }));
  setKey('smtp', { host: 'smtp.example.com', port: 465, user: 'resend', pass: 'geheim', from: 'Stella <noreply@evolsior.com>' });

  await sendSystemMail('a@example.com', 'Code', '123456');
  await sendSystemMail('a@example.com', 'Hallo', 'Von Stella', 'stella');
  assert.equal(sent[0]!.from, 'Stella <noreply@evolsior.com>');
  assert.equal(sent[0]!.replyTo, 'support@evolsior.com');
  assert.equal(sent[1]!.from, 'Stella <stella@evolsior.com>');
  assert.equal(sent[1]!.replyTo, 'stella@evolsior.com');

  // ohne eingetragenen Absender: wie bisher (Benutzername), keine Antwortadresse
  setKey('smtp', { host: 'smtp.example.com', port: 465, user: 'stella@example.com', pass: 'geheim' });
  await sendSystemMail('b@example.com', 'Code', '654321');
  assert.equal(sent[2]!.from, 'Stella <stella@example.com>');
  assert.equal('replyTo' in sent[2]!, false);
  setMailTransportFactory();
});
