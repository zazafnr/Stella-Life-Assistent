import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.STELLA_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'stella-onb-'));
process.env.STELLA_SECRET = 'test-secret-1234567890';
process.env.STELLA_ALLOW_REGISTRATION = 'true';

const { config } = await import('./config.ts');
const { register } = await import('./auth.ts');
const { getUser, updateUserSettings } = await import('./db.ts');
const { setKey } = await import('./keys.ts');
const { setMailTransportFactory } = await import('./mailer.ts');
const { shouldAskLocation, recordLocationAnswer, locationAskText } = await import('./location.ts');

const sent: { to: string; subject: string; html?: string }[] = [];
setMailTransportFactory(() => ({ sendMail: async (m: { to: string; subject: string; html?: string }) => { sent.push(m); return {} as never; } }));
setKey('smtp', { host: 'smtp.example.com', port: 465, user: 'noreply@evolsior.com', pass: 'x', from: 'Stella <noreply@evolsior.com>' });
after(() => { /* nichts offen */ });

const mk = (name: string, locale: 'de' | 'es' | 'en', notify: boolean) => {
  const { user } = register(name, `${name.toLowerCase()}@example.com`, 'supergeheim', 'Europe/Vienna');
  updateUserSettings(user.id, { locale, ...(notify ? { notify: { freenotes: true } } : {}) });
  return user.id;
};

test('Standort: „Später“ wird beim ersten Bedarf erneut gefragt, „Nein“ nicht', () => {
  const id = mk('Lena', 'de', false);
  assert.equal(shouldAskLocation(getUser(id)!), true, 'nie gefragt');
  recordLocationAnswer(getUser(id)!, 'later');
  assert.equal(shouldAskLocation(getUser(id)!), true);
  assert.ok(locationAskText(getUser(id)!).includes('Standort'));
  recordLocationAnswer(getUser(id)!, 'denied');
  assert.equal(shouldAskLocation(getUser(id)!), false);
  recordLocationAnswer(getUser(id)!, 'granted');
  assert.equal(shouldAskLocation(getUser(id)!), false);
});
