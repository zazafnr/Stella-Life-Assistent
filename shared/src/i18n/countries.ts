// Länder: Standard-Sprache und Schul-Wortschatz. Die Sprache bestimmt die Wörter, das Land die Schul-Begriffe.

import type { Locale } from './locales.ts';
import { t } from './t.ts';

export interface SchoolTerms {
  /** Hausaufgabe, Singular/Plural */
  homework: string;
  homeworkPlural: string;
  /** größere schriftliche Prüfung */
  exam: string;
  /** kurzer Test */
  quiz: string;
}

/** ISO-3166-Länder, die Stella anbietet (Auswahl in der Einführung) */
export const COUNTRIES = ['AT', 'DE', 'CH', 'LI', 'IT', 'FR', 'ES', 'PT', 'BR', 'TR', 'PL', 'GB', 'IE', 'US', 'CA', 'AU', 'MX', 'AR', 'OTHER'] as const;
export type Country = (typeof COUNTRIES)[number];
export const isCountry = (v: unknown): v is Country => typeof v === 'string' && (COUNTRIES as readonly string[]).includes(v);

/** Name des Landes in der Sprache der Nutzerin (Intl), „OTHER“ aus dem Katalog */
export function countryName(code: string, locale: Locale): string {
  if (code === 'OTHER') return t(locale, 'country.other');
  try { return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code; } catch { return code; }
}

/** Für die Sprachwahl: aus dem Land der wahrscheinlichste Sprachvorschlag */
export const COUNTRY_LOCALE: Partial<Record<Country, Locale>> = {
  AT: 'de', DE: 'de', CH: 'de', LI: 'de', IT: 'it', FR: 'fr', ES: 'es', MX: 'es', AR: 'es', PT: 'pt-BR', BR: 'pt-BR', TR: 'tr', PL: 'pl',
  GB: 'en', IE: 'en', US: 'en', CA: 'en', AU: 'en',
};

/**
 * Schulbegriffe je Sprache und Land. Deutsch: Österreich sagt „Hausübung“/„Schularbeit“, Deutschland und die Schweiz
 * „Hausaufgabe“/„Klassenarbeit“. Die übrigen Sprachen haben je ein Wort pro Begriff (Paket 3 ergänzt Feinheiten je Land).
 */
const TERMS: Record<Locale, SchoolTerms> = {
  en: { homework: 'homework', homeworkPlural: 'homework', exam: 'exam', quiz: 'quiz' },
  de: { homework: 'Hausaufgabe', homeworkPlural: 'Hausaufgaben', exam: 'Klassenarbeit', quiz: 'Test' },
  es: { homework: 'deberes', homeworkPlural: 'deberes', exam: 'examen', quiz: 'control' },
  fr: { homework: 'devoirs', homeworkPlural: 'devoirs', exam: 'contrôle', quiz: 'interro' },
  it: { homework: 'compiti', homeworkPlural: 'compiti', exam: 'verifica', quiz: 'interrogazione' },
  'pt-BR': { homework: 'lição de casa', homeworkPlural: 'lições de casa', exam: 'prova', quiz: 'teste' },
  tr: { homework: 'ödev', homeworkPlural: 'ödevler', exam: 'sınav', quiz: 'yazılı' },
  pl: { homework: 'zadanie domowe', homeworkPlural: 'zadania domowe', exam: 'sprawdzian', quiz: 'kartkówka' },
};

const COUNTRY_OVERRIDES: Partial<Record<Locale, Partial<Record<Country, Partial<SchoolTerms>>>>> = {
  de: { AT: { homework: 'Hausübung', homeworkPlural: 'Hausübungen', exam: 'Schularbeit' } },
  es: { MX: { exam: 'examen', quiz: 'quiz' } },
  fr: { CH: { exam: 'épreuve' } },
};

export function schoolTerms(locale: Locale, country?: string | null): SchoolTerms {
  const base = TERMS[locale];
  const over = isCountry(country) ? COUNTRY_OVERRIDES[locale]?.[country] : undefined;
  return over ? { ...base, ...over } : base;
}
