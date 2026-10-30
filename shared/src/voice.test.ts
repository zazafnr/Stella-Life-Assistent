import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planReminders } from './planning.ts';
import { isTone, STYLE_RULES, toneInstruction, TONES, voice } from './voice.ts';

const hw = { kind: 'homework' as const, title: 'Latein HÜ', detail: 'S. 45 Nr. 3', due: '2026-10-30' };

test('ohne Ton klingt Stella wie bisher (nett)', () => {
  const [r] = planReminders(hw, '2026-10-28');
  assert.equal(r!.message, '📚 Morgen fällig: Latein HÜ – S. 45 Nr. 3');
  assert.equal(voice(undefined).nothingAhead(7), 'Nichts offen in den nächsten 7 Tagen. 🎉');
});

test('jeder Ton hat eigene Texte, der Inhalt bleibt drin', () => {
  const texts = TONES.map((tone) => planReminders(hw, '2026-10-28', { eveningTime: '19:00', studyTime: '16:30', tone })[0]!.message);
  assert.equal(new Set(texts).size, 3);
  for (const t of texts) assert.match(t, /Latein HÜ – S\. 45 Nr\. 3/);
});

test('Varianten sind stabil und jede Phrase existiert in allen Tönen', () => {
  assert.equal(voice('frech').noted('X'), voice('frech').noted('X'));
  const keys = Object.keys(voice('nett')).filter((k) => k !== 'tone');
  for (const tone of TONES) {
    const v = voice(tone) as unknown as Record<string, unknown>;
    for (const k of keys) assert.equal(typeof v[k], 'function', `${tone}.${k}`);
  }
});

test('Ton-Prüfung und KI-Stil', () => {
  assert.ok(isTone('cool'));
  assert.ok(!isTone('böse'));
  assert.match(toneInstruction('frech'), /nie gemein/i);
});

test('feste Texte bleiben kurz: höchstens 6 Zeilen und 450 Zeichen, in jedem Ton', () => {
  for (const tone of TONES) {
    const v = voice(tone) as unknown as Record<string, unknown>;
    for (const [name, fn] of Object.entries(v)) {
      if (typeof fn !== 'function') continue;
      let out: unknown;
      try { out = (fn as (...a: unknown[]) => unknown)('Beispiel', 'Beispiel', 'Beispiel', 'Beispiel'); } catch { continue; }
      if (typeof out !== 'string') continue;
      assert.ok(out.split('\n').length <= 6, `${tone}.${name} hat mehr als 6 Zeilen`);
      assert.ok(out.length <= 450, `${tone}.${name} ist ${out.length} Zeichen lang`);
    }
  }
});

test('Antwortstil steckt in der Stilvorgabe jedes Tons', () => {
  for (const tone of TONES) assert.match(toneInstruction(tone), /etwa 6 Zeilen.*Aufzählungen.*keine Überschriften/i);
  assert.match(STYLE_RULES, /hilfsbereiter Kumpel/);
});
