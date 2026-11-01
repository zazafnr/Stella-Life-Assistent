import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOGS, formatDay, LOCALES, matchLocale, missingKeys, schoolTerms, t, translator, weekdayName, type Locale } from '../index.ts';
import { voice, TONES } from '../voice.ts';
import { voiceDe } from '../voice.de.ts';
import { voiceEn } from '../voice.en.ts';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort().join(',');

const baseKey = (k: string) => k.split('#')[0]!;

test('alle acht Kataloge sind vollständig: jeder Schlüssel aus en.json, gleiche Platzhalter, keine Fremdschlüssel', () => {
  const en = CATALOGS.en;
  for (const locale of LOCALES) {
    const cat = CATALOGS[locale];
    for (const [key, text] of Object.entries(en)) {
      assert.ok(key in cat, `${locale}.json fehlt: ${key}`);
      assert.equal(placeholders(cat[key]!), placeholders(text), `${locale}: Platzhalter von ${key} weichen ab`);
      assert.ok(cat[key]!.trim().length > 0 || /\.text$|: $/.test(en[key]!) || en[key]!.trim().length === 0, `${locale}.${key} ist leer`);
    }
    // weitere Mehrzahlformen (pl: #few, #many) sind erlaubt, sonst nichts, was Englisch nicht kennt
    for (const key of Object.keys(cat)) {
      assert.ok(key in en || `${baseKey(key)}#other` in en, `${locale}.json hat einen Schlüssel, den en.json nicht kennt: ${key}`);
      if (!(key in en)) assert.equal(placeholders(cat[key]!), placeholders(en[`${baseKey(key)}#other`]!), `${locale}: Platzhalter von ${key}`);
    }
  }
});

test('polnische Mehrzahl hat alle vier Formen für jede Zählung', () => {
  for (const base of Object.keys(CATALOGS.en).filter((k) => k.endsWith('#other')).map(baseKey)) {
    for (const form of ['one', 'few', 'many', 'other']) assert.ok(`${base}#${form}` in CATALOGS.pl, `pl fehlt ${base}#${form}`);
  }
  assert.equal(t('pl', 'chat.messageCount', { count: 1 }), '1 wiadomość');
  assert.equal(t('pl', 'chat.messageCount', { count: 3 }), '3 wiadomości');
  assert.equal(t('pl', 'chat.messageCount', { count: 5 }), '5 wiadomości');
  assert.equal(t('pl', 'briefing.lessons', { count: 2 }), '2 lekcje');
  assert.equal(t('pl', 'briefing.lessons', { count: 12 }), '12 lekcji');
});

// Enge Stellen in der Oberfläche: Tabs und Ton-Namen. Übertragen heißt kürzer formulieren, nicht Schrift verkleinern.
const SHORT = (k: string) => /^nav\.(today|chat|planner|goals|inbox|health|finance|settings)$/.test(k) || /^tone\.(nett|frech|cool)$/.test(k);

test('kurze Texte (Tabs und Ton-Namen) sind höchstens 1,6 × so lang wie das Englische – mindestens 12 Zeichen Luft', () => {
  const en = CATALOGS.en;
  for (const locale of LOCALES) {
    for (const key of Object.keys(en).filter(SHORT)) {
      const limit = Math.max(12, Math.ceil(en[key]!.length * 1.6));
      assert.ok(CATALOGS[locale][key]!.length <= limit, `${locale}.${key} ist zu lang: "${CATALOGS[locale][key]}" (${CATALOGS[locale][key]!.length} > ${limit})`);
    }
  }
});

test('Slogan und Markenkern: Leitspruch bleibt englisch, der Stella-Slogan ist in jeder Sprache übertragen', () => {
  const slogans: Record<string, string> = {
    en: 'Let Stella handle your life.', de: 'Stella kümmert sich um den Rest.', es: 'Deja que Stella se encargue.', fr: "Laisse Stella s'en occuper.",
    it: 'Lascia fare a Stella.', 'pt-BR': 'Deixa com a Stella.', tr: 'Gerisini Stella halleder.', pl: 'Zostaw to Stelli.',
  };
  for (const locale of LOCALES) {
    assert.equal(CATALOGS[locale]['auth.tagline'], slogans[locale]);
    assert.match(CATALOGS[locale]['email.code.body']!, /Stella by EVOLSIOR – Built to become/, `${locale}: Markenkern bleibt englisch`);
  }
});

test('t(): Platzhalter, Mehrzahl, Rückfall auf Englisch und dann auf den Schlüssel', () => {
  assert.equal(t('en', 'today.greeting.named', { greeting: t('en', 'today.greeting.morning'), name: 'Mia' }), 'Good morning, Mia!');
  assert.equal(t('de', 'today.greeting.named', { greeting: t('de', 'today.greeting.morning'), name: 'Mia' }), 'Guten Morgen, Mia!');
  assert.equal(t('en', 'chat.messageCount', { count: 1 }), '1 message');
  assert.equal(t('en', 'chat.messageCount', { count: 3 }), '3 messages');
  assert.equal(t('de', 'chat.messageCount', { count: 1 }), '1 Nachricht');
  assert.equal(translator('es')('common.save'), 'Guardar');
  assert.equal(translator('tr')('settings.version', { version: '1.0' }), 'Sürüm 1.0');
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
});

test('voice() in allen acht Sprachen und drei Tönen: kurz, mit allen Angaben, ohne Platzhalter-Reste', () => {
  const probes: Record<string, unknown[]> = {
    homeworkTomorrow: ['MATHE-A'], examTomorrow: ['MATHE-B'], dueTomorrow: ['MATHE-C'], reminderNow: ['MATHE-D'],
    remindSet: ['MORGEN-E', 'ZAHNARZT-E'], noted: ['MATHE-F'], moved: ['MATHE-G', 'FREITAG-G'], deleted: ['MATHE-H'], listAdded: ['MILCH-I', 1],
    done: ['MATHE-J', 2], briefingGreeting: ['MIA-K', 'WOCHENTAG-K'], welcome: ['MIA-L'],
  };
  for (const locale of LOCALES) {
    for (const tone of TONES) {
      const v = voice(tone, locale) as unknown as Record<string, (...a: unknown[]) => string | boolean>;
      for (const [name, args] of Object.entries(probes)) {
        const out = String(v[name]!(...args));
        assert.ok(out.length <= 450 && out.split('\n').length <= 6, `${locale}/${tone}/${name} ist zu lang`);
        for (const a of args.filter((x) => typeof x === 'string')) assert.ok(out.includes(a as string), `${locale}/${tone}/${name} lässt "${a}" weg`);
        assert.ok(!/undefined|\[object|\$\{/.test(out), `${locale}/${tone}/${name}: ${out}`);
      }
      for (const busy of [true, false]) assert.ok(String(v.briefingClosing!(busy)).length > 3);
    }
  }
  // die Töne unterscheiden sich in jeder Sprache
  for (const locale of LOCALES) {
    const set = new Set(TONES.map((tone) => voice(tone, locale).remindSet('X-WANN', 'X-WAS')));
    assert.equal(set.size, 3, `${locale}: drei verschiedene Töne`);
  }
});

test('Standardsprache ist Englisch', async () => {
  const { DEFAULT_LOCALE } = await import('./locales.ts');
  assert.equal(DEFAULT_LOCALE, 'en');
  const locales: Locale[] = [...LOCALES];
  assert.equal(locales.length, 8);
});
