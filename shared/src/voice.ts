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
export const STYLE_RULES = 'Style: answer like a helpful friend – short, at most about 6 lines. Prefer bullet lists (with "- ") over paragraphs. ' +
  'Put important things in **bold**. No headings, no filler phrases ("Sure!", "Of course!", "I hope this helps"). Even in the kind tone: warm but brief. ' +
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
  return `${toneText(tone, locale)} Always short: about 6 lines, bullet lists instead of paragraphs, important things in **bold**, no headings and no filler phrases.`;
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
      return 'Tone: kind and warm – encouraging, friendly, happily with fitting emojis (💫🌸✨).';
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
