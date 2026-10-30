import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.STELLA_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'stella-auth-'));
process.env.STELLA_SECRET = 'test-secret-1234567890';
process.env.STELLA_ALLOW_REGISTRATION = 'true';

const { register, login } = await import('./auth.ts');

register('Lukas', 'lukas@example.com', 'richtiges-passwort', 'Europe/Vienna');

const status = (fn: () => unknown) => {
  try { fn(); return 200; } catch (err) { return (err as { status?: number }).status; }
};

test('nach 8 Fehlversuchen ist die E-Mail 15 Minuten gesperrt – auch für das richtige Passwort', () => {
  for (let i = 0; i < 8; i++) assert.equal(status(() => login('lukas@example.com', 'falsch', undefined, `10.0.0.${i}`)), 401);
  assert.equal(status(() => login('Lukas@Example.com', 'richtiges-passwort', undefined, '10.0.1.1')), 429);
});

test('eine Adresse, die viele Konten durchprobiert, wird gesperrt', () => {
  for (let i = 0; i < 8; i++) assert.equal(status(() => login(`raten${i}@example.com`, 'x', undefined, '203.0.113.9')), 401);
  assert.equal(status(() => login('noch-eine@example.com', 'x', undefined, '203.0.113.9')), 429);
});

test('erfolgreicher Login setzt die Zähler zurück', () => {
  register('Mia', 'mia@example.com', 'miapasswort', 'Europe/Vienna');
  for (let i = 0; i < 5; i++) status(() => login('mia@example.com', 'falsch', undefined, '198.51.100.1'));
  assert.ok(login('mia@example.com', 'miapasswort', undefined, '198.51.100.1').token);
  for (let i = 0; i < 7; i++) assert.equal(status(() => login('mia@example.com', 'falsch', undefined, '198.51.100.1')), 401);
});
