import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.STELLA_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'stella-int-'));
process.env.STELLA_SECRET = 'test-secret-1234567890';

const { parseQr } = await import('./untis.ts');
const { normalizeCookies } = await import('./books.ts');

test('WebUntis-QR-Code wird gelesen', () => {
  assert.deepEqual(parseQr('untis://setschool?url=neilo.webuntis.com&school=bg-musterschule&user=MaxMus&key=ABCDEF123456'), {
    server: 'neilo.webuntis.com', school: 'bg-musterschule', username: 'MaxMus', key: 'ABCDEF123456',
  });
  assert.throws(() => parseQr('untis://setschool?url=x'));
});

test('Cookies aus Browser-Erweiterungen werden für den unsichtbaren Browser umgewandelt', () => {
  const cookies = normalizeCookies([
    { name: 'session', value: 'abc', domain: '.scook.at', path: '/', expirationDate: 1893456000.5, httpOnly: true, secure: true, sameSite: 'no_restriction' },
    { name: 'kaputt' },
  ]);
  assert.equal(cookies.length, 1);
  assert.deepEqual(cookies[0], {
    name: 'session', value: 'abc', domain: '.scook.at', path: '/', expires: 1893456000, httpOnly: true, secure: true, sameSite: 'None',
  });
});
