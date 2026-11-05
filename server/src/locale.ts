// Sprache und Land der Nutzerin: aus ihren Einstellungen, Englisch als Standard.

import { DEFAULT_LOCALE, formatDay, isCountry, isLocale, LANGUAGE_NAMES_EN, schoolTerms, t, voice, type Country, type Locale, type SchoolTerms } from '@stella/shared';
import { config } from './config.ts';
import type { User } from './db.ts';

type HasSettings = Pick<User, 'settings'> & { edition?: User['edition'] };

export const userLocale = (u: HasSettings): Locale =>
  isLocale(u.settings.locale) ? u.settings.locale : isLocale(config.defaultLocale) ? config.defaultLocale : DEFAULT_LOCALE;
export const userCountry = (u: HasSettings): Country | undefined => (isCountry(u.settings.country) ? u.settings.country : undefined);
export const userTerms = (u: HasSettings): SchoolTerms => schoolTerms(userLocale(u), u.settings.country);
export const languageName = (u: HasSettings): string => LANGUAGE_NAMES_EN[userLocale(u)];

/** Stellas feste Texte in Sprache und Ton dieser Nutzerin */
export const voiceOf = (u: HasSettings) => voice(u.settings.tone, userLocale(u));

/** Text aus dem Sprachkatalog in der Sprache dieser Nutzerin */
export const tr = (u: HasSettings, key: string, vars?: Record<string, string | number>) => t(userLocale(u), key, vars, u.edition);

/** Begrüßung im ersten Chat: Text der Stimme (Ton, Sprache) plus – in Stella for Students – Beispiele mit Schulwörtern */
export function welcomeText(u: HasSettings & { name: string }): string {
  const base = voiceOf(u).welcome(u.name);
  if (u.edition !== 'students') return base;
  const extra = tr(u, 'students.welcome.examples');
  return extra === 'students.welcome.examples' ? base : `${base}\n\n${extra}`;
}

/** „heute“, „morgen“ oder „Freitag, 13. Nov.“ in der Sprache dieser Nutzerin */
export const dayFor = (u: HasSettings, ymd: string, today?: string) => formatDay(userLocale(u), ymd, today);
