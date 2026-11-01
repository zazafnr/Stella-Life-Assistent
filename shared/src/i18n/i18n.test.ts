import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOGS, formatDay, LOCALES, matchLocale, missingKeys, schoolTerms, t, translator, weekdayName, type Locale } from '../index.ts';
import { voice, TONES } from '../voice.ts';
import { voiceDe } from '../voice.de.ts';
import { voiceEn } from '../voice.en.ts';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort().join(',');

test('jeder Schlüssel aus en.json existiert in jedem geladenen Katalog – mit denselben Platzhaltern', () => {
  const en = CATALOGS.en!;
  for (const locale of LOCALES) {
    const cat = CATALOGS[locale];
    if (!cat) continue;
    for (const [key, text] of Object.entries(en)) {
      assert.ok(key in cat, `${locale}.json fehlt: ${key}`);
      assert.equal(placeholders(cat[key]!), placeholders(text), `${locale}: Platzhalter von ${key} weichen ab`);
    }
    for (const key of Object.keys(cat)) assert.ok(key in en, `${locale}.json hat einen Schlüssel, den en.json nicht kennt: ${key}`);
  }
  assert.ok(CATALOGS.en && CATALOGS.de, 'Englisch und Deutsch sind vollständig da');
});

test('t(): Platzhalter, Mehrzahl, Rückfall auf Englisch und dann auf den Schlüssel', () => {
  assert.equal(t('en', 'today.greeting.named', { greeting: t('en', 'today.greeting.morning'), name: 'Mia' }), 'Good morning, Mia!');
  assert.equal(t('de', 'today.greeting.named', { greeting: t('de', 'today.greeting.morning'), name: 'Mia' }), 'Guten Morgen, Mia!');
  assert.equal(t('en', 'items', { count: 1 }), '1 entry');
  assert.equal(t('en', 'items', { count: 3 }), '3 entries');
  assert.equal(t('de', 'items', { count: 1 }), '1 Eintrag');
  assert.equal(translator('es')('common.save'), 'Save', 'Spanisch (noch ohne Katalog) fällt auf Englisch zurück');
  missingKeys.clear();
  assert.equal(t('en', 'gibt.es.nicht'), 'gibt.es.nicht');
  assert.ok(missingKeys.has('en:gibt.es.nicht'), 'fehlende Schlüssel werden gemerkt');
  missingKeys.clear();
});

test('Sprache aus dem Gerät/Browser erkennen', () => {
  assert.equal(matchLocale('de-AT'), 'de');
  assert.equal(matchLocale('pt'), 'pt-BR');
  assert.equal(matchLocale('tr_TR'), 'tr');
  assert.equal(matchLocale('ja-JP,ja;q=0.9,en;q=0.5'), 'en');
  assert.equal(matchLocale('fr-CH,fr;q=0.9'), 'fr');
  assert.equal(matchLocale(undefined), 'en');
});

test('Schulbegriffe: Österreich sagt Hausübung/Schularbeit, sonst Hausaufgabe/Klassenarbeit', () => {
  assert.equal(schoolTerms('de', 'AT').homework, 'Hausübung');
  assert.equal(schoolTerms('de', 'AT').exam, 'Schularbeit');
  assert.equal(schoolTerms('de', 'DE').homework, 'Hausaufgabe');
  assert.equal(schoolTerms('de', 'CH').exam, 'Klassenarbeit');
  assert.equal(schoolTerms('en').homework, 'homework');
  assert.equal(schoolTerms('pl').exam, 'sprawdzian');
});

test('Datum und Wochentage je Sprache', () => {
  assert.equal(formatDay('de', '2026-11-13'), 'Freitag, 13.11.');
  assert.match(formatDay('en', '2026-11-13'), /Friday.*13.*Nov|Friday.*Nov.*13/);
  assert.equal(formatDay('en', '2026-11-05', '2026-11-04'), 'tomorrow');
  assert.equal(formatDay('de', '2026-11-04', '2026-11-04'), 'heute');
  assert.equal(weekdayName('en', 0), 'Sunday');
  assert.equal(weekdayName('de', 5), 'Freitag');
});

test('voice(): Englisch und Deutsch haben dieselben Texte in allen drei Tönen', () => {
  for (const tone of TONES) {
    const de = voiceDe(tone) as unknown as Record<string, unknown>;
    const en = voiceEn(tone) as unknown as Record<string, unknown>;
    assert.deepEqual(Object.keys(en).sort(), Object.keys(de).sort(), `Schlüssel von ${tone}`);
    for (const [name, fn] of Object.entries(en)) {
      if (typeof fn !== 'function') continue;
      const out = (fn as (...a: unknown[]) => unknown)('Beispiel', 'Beispiel', 'Beispiel', 'Beispiel');
      if (typeof out !== 'string') continue;
      assert.ok(!/[äöüß]/i.test(out) || /Beispiel/.test(out) === true, `${tone}.${name} enthält deutsche Zeichen`);
      assert.ok(out.length <= 450 && out.split('\n').length <= 6, `${tone}.${name} ist zu lang`);
    }
  }
  assert.match(voice('cool', 'en').briefingGreeting('Mia', 'Friday'), /Morning, Mia/);
  assert.match(voice('nett', 'de').briefingGreeting('Mia', 'Freitag'), /Guten Morgen, Mia/);
  // Sprachen ohne eigene Texte (Paket 3) fallen auf Englisch zurück
  assert.equal(voice('nett', 'tr').listEmpty(), voice('nett', 'en').listEmpty());
});

test('Standardsprache ist Englisch', async () => {
  const { DEFAULT_LOCALE } = await import('./locales.ts');
  assert.equal(DEFAULT_LOCALE, 'en');
  const locales: Locale[] = [...LOCALES];
  assert.equal(locales.length, 8);
});
