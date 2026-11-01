// Sprachen von Stella. Englisch ist der Standard; die Texte kommen aus den Katalogen in ./catalog.

export const LOCALES = ['en', 'de', 'es', 'fr', 'it', 'pt-BR', 'tr', 'pl'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

/** Name jeder Sprache in ihrer eigenen Sprache (für die Auswahl) */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English', de: 'Deutsch', es: 'Español', fr: 'Français', it: 'Italiano', 'pt-BR': 'Português (Brasil)', tr: 'Türkçe', pl: 'Polski',
};

/** Sprachname auf Englisch – für Anweisungen an die KI („Reply in German“) */
export const LANGUAGE_NAMES_EN: Record<Locale, string> = {
  en: 'English', de: 'German', es: 'Spanish', fr: 'French', it: 'Italian', 'pt-BR': 'Brazilian Portuguese', tr: 'Turkish', pl: 'Polish',
};

/** ISO-639-1-Code für Whisper & Co. */
export const isoLanguage = (l: Locale) => l.split('-')[0]!;

export const isLocale = (v: unknown): v is Locale => typeof v === 'string' && (LOCALES as readonly string[]).includes(v);

/** Beliebiges Sprach-Tag ("de-AT", "pt", "tr_TR", "en-US,en;q=0.9") auf eine unterstützte Sprache abbilden, sonst Englisch. */
export function matchLocale(tag: string | null | undefined): Locale {
  for (const part of String(tag ?? '').split(',')) {
    const raw = part.split(';')[0]!.trim().replace('_', '-');
    if (!raw) continue;
    const exact = LOCALES.find((l) => l.toLowerCase() === raw.toLowerCase());
    if (exact) return exact;
    const base = raw.split('-')[0]!.toLowerCase();
    const byBase = LOCALES.find((l) => l.split('-')[0]!.toLowerCase() === base);
    if (byBase) return byBase;
  }
  return DEFAULT_LOCALE;
}
