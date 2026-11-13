// Wie Stella klingt: nett, frech oder cool. Gilt für alle festen Texte (Bestätigungen,
// Erinnerungen, Meldungen) und wird der KI als Stil vorgegeben. Inhalte bleiben gleich –
// nur der Ton ändert sich. Frech heißt neckisch, nie gemein.

import { TONES, type Tone } from './voice.core.ts';
import { voiceDe, type Voice } from './voice.de.ts';
import { voiceEn } from './voice.en.ts';
import { PARTIAL_VOICES } from './voice.more.ts';
import { DEFAULT_LOCALE, type Locale } from './i18n/locales.ts';

export { TONES, type Tone, type Voice };

export const TONE_INFO: Record<Tone, { label: string; emoji: string; example: string }> = {
  nett: { label: 'Nett', emoji: '🌸', example: 'Notiert! Ich erinnere dich morgen um 19:00. 💫' },
  frech: { label: 'Frech', emoji: '😏', example: 'Schon wieder Latein? Na gut, notiert – ich nerv dich morgen um 19:00.' },
  cool: { label: 'Cool', emoji: '😎', example: 'Läuft. Steht drin, Reminder morgen 19:00.' },
};

export function isTone(v: unknown): v is Tone {
  return typeof v === 'string' && (TONES as string[]).includes(v);
}

/** Antwortstil in jedem Ton: kurz, wie ein hilfsbereiter Kumpel (Anweisung an die KI – bewusst englisch) */
// Schreibstil „wie ein Mensch“ (Design-Auswahl Schreibstil B): ein Gedanke pro Blase – die Apps zeigen jeden Absatz als eigene Nachricht –,
// Aktionen stehen als Karte darunter, deshalb nur ein lockerer Satz dazu.
export const STYLE_RULES = 'Style: write like a helpful friend texting – short, natural sentences, at most about 6 lines in total. ' +
  'One thought per message: separate thoughts with a blank line; every paragraph appears as its own chat bubble (2–3 bubbles are ideal, never more than 4). ' +
  'Use bullet lists (with "- ") only for real lists of several items, e.g. what is due. Put the one most important thing in **bold** when it helps. ' +
  'No headings, no filler phrases ("Sure!", "Of course!", "I hope this helps"), no protocol prefixes like "Done:" or "✓". At most one emoji per bubble. ' +
  'Ask at most one question, at the very end. When you did something with a tool, the app shows it as a card under your message – then say it casually in one short sentence without repeating every detail. ' +
  'Long results (week plan, lists) appear as a card – then write just one sentence.';

/** Beispiele für „cool“ und „frech“ je Sprache, damit die KI den Ton in der Sprache trifft */
const SLANG: Record<Locale, { cool: string; cheeky: string }> = {
  en: { cool: '"on it", "easy", "no stress"', cheeky: 'light teasing, "oh really?", "bold of you"' },
  de: { cool: '"läuft", "easy", "safe", "kein Stress"', cheeky: 'neckisch, "na gut", "Schon wieder?"' },
  es: { cool: '"vale", "tranqui", "sin estrés", "va"', cheeky: 'pícara, "¿otra vez?", "anda ya"' },
  fr: { cool: '"ça marche", "easy", "pas de stress"', cheeky: 'taquine, "encore ?", "sérieux ?"' },
  it: { cool: '"tutto ok", "easy", "tranqui", "fatto"', cheeky: 'sfottente ma gentile, "di nuovo?", "dai su"' },
  'pt-BR': { cool: '"beleza", "tranquilo", "de boa", "fechou"', cheeky: 'provocadora, "de novo?", "sério isso?"' },
  tr: { cool: '"tamamdır", "hallederiz", "kolay gelsin", "sorun yok"', cheeky: 'laf atan ama sevimli, "yine mi?", "hadi canım"' },
  pl: { cool: '"spoko", "luz", "jasne", "bez spiny"', cheeky: 'zadziorna, "znowu?", "serio?"' },
};

/** Stilvorgabe für die KI. Der Prompt bleibt englisch; die Sprache der Antwort steht in der Regel „Reply in …“ (siehe languageRule). */
export function toneInstruction(tone: Tone | undefined, locale: Locale = DEFAULT_LOCALE): string {
  return `${toneText(tone, locale)} Always short: about 6 lines, one thought per bubble (blank line between), bullet lists only for real lists, important things in **bold**, no headings and no filler phrases.`;
}

function toneText(tone: Tone | undefined, locale: Locale): string {
  const slang = SLANG[locale];
  switch (tone ?? 'nett') {
    case 'frech':
      return `Tone: cheeky and quick-witted – teasing, ironic, little quips and a wink (😏🙄😂), like a best friend who pokes fun at you (${slang.cheeky}). ` +
        'Never mean, never insulting, never on serious topics (health, arguments, worries) – then you are honest and kind.';
    case 'cool':
      return `Tone: cool and laid-back – very short, relaxed, light youth slang (${slang.cool}), sparing with emojis (😎✌️). ` +
        'No filler phrases, no firework of exclamation marks.';
    default:
      return 'Tone: kind and warm – encouraging, friendly, with a fitting emoji now and then (💫🌸✨).';
  }
}

/** Regel für die KI: in welcher Sprache sie antwortet */
export function languageRule(languageName: string): string {
  return `Always reply in ${languageName}, unless the user writes in another language – then reply in that language.`;
}

/** Stellas feste Texte in der Sprache der Nutzerin. Fehlt in einer Sprache ein Text, gilt der englische. */
export function voice(tone: Tone | undefined, locale: Locale = 'de'): Voice {
  if (locale === 'de') return voiceDe(tone);
  const english = voiceEn(tone);
  if (locale === DEFAULT_LOCALE) return english;
  return { ...english, ...(PARTIAL_VOICES[locale]?.(tone) ?? {}) };
}
