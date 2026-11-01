import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { screenTimeThresholds, thresholdKind, thresholdPercent, screenTimeMessageKey, screenTimeMessageKeys, TONES, LOCALES, t } from './index.ts';

test('Schwellen: 50 %, 80 %, 100 % und danach jede volle Stunde darüber', () => {
  assert.deepEqual(screenTimeThresholds(60), [30, 48, 60, 120, 180, 240, 300, 360, 420, 480, 540, 600, 660, 720, 780, 840, 900, 960]);
  assert.deepEqual(screenTimeThresholds(90).slice(0, 5), [45, 72, 90, 120, 180]);
  assert.deepEqual(screenTimeThresholds(240).slice(0, 6), [120, 192, 240, 300, 360, 420], 'unter 4 Stunden wird nichts doppelt');
  assert.deepEqual(screenTimeThresholds(5).slice(0, 4), [3, 4, 5, 60], 'sehr kleine Limits bleiben sinnvoll');
  assert.ok(screenTimeThresholds(120).every((m, i, a) => i === 0 || m > a[i - 1]!), 'aufsteigend, keine Doppelten');
});

test('Art der Nachricht: Mittags-Regel, 80 %, Limit, darüber', () => {
  assert.equal(thresholdKind(30, 60, 11), 'noon', '50 % vor 13 Uhr: „Auf Kurs?“');
  assert.equal(thresholdKind(30, 60, 13), 'half');
  assert.equal(thresholdKind(48, 60, 9), 'eighty');
  assert.equal(thresholdKind(60, 60, 15), 'limit');
  assert.equal(thresholdKind(120, 60, 15), 'over');
  assert.equal(thresholdKind(35, 60, 15), null);
  assert.equal(thresholdPercent(48, 60), 80);
});

test('Texte: jede Art in jedem Ton und jeder Sprache, Variante wechselt stabil, Platzhalter stimmen', () => {
  assert.equal(screenTimeMessageKey('nett', 'half', 5), 'screentime.msg.nett.half');
  assert.equal(screenTimeMessageKey('frech', 'limit', 0), 'screentime.msg.frech.limit.1');
  assert.equal(screenTimeMessageKey('frech', 'limit', 1), 'screentime.msg.frech.limit.2');
  assert.equal(screenTimeMessageKey('frech', 'limit', 2), 'screentime.msg.frech.limit.1');
  for (const key of screenTimeMessageKeys(TONES)) {
    for (const l of LOCALES) {
      const msg = t(l, key, { name: 'TikTok', hours: 3 });
      assert.ok(msg && msg !== key, `${l} fehlt ${key}`);
      assert.ok(msg.includes('TikTok'), `${l} ${key} nennt das Ziel nicht`);
      assert.ok(!msg.includes('{'), `${l} ${key} hat einen offenen Platzhalter`);
      if (key.includes('.over.')) assert.ok(msg.includes('3'), `${l} ${key} nennt die Stunden nicht`);
    }
  }
});

test('Die Swift-Fassung rechnet gleich (Schwellen und Arten)', () => {
  const swift = readFileSync(new URL('../../ios/Stella.swiftpm/Core/ScreenTime.swift', import.meta.url), 'utf8');
  for (const needle of ['limit * 0.5', 'limit * 0.8', 'h * 60 > Int(limit)', 'hourLocal < 13', '1...16']) assert.ok(swift.includes(needle), `Swift: ${needle}`);
});
