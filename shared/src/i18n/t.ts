// Übersetzen: t(locale, 'schlüssel', { name }). Fehlt ein Schlüssel, gilt Englisch, dann der Schlüssel selbst.
// Platzhalter {name}; Mehrzahl über Intl.PluralRules mit Schlüsseln "key#one" / "key#other" und der Variable `count`.

import { DEFAULT_LOCALE, type Locale } from './locales.ts';
import en from './catalog/en.json' with { type: 'json' };
import de from './catalog/de.json' with { type: 'json' };

export type Catalog = Record<string, string>;

/** Alle geladenen Kataloge. Weitere Sprachen (Paket 3) kommen hier dazu. */
export const CATALOGS: Partial<Record<Locale, Catalog>> = { en, de };

/** Für Tests: ein Schlüssel, der fehlt, wird hier gesammelt */
export const missingKeys = new Set<string>();

const fmt = (text: string, vars?: Record<string, string | number>) =>
  vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text;

function lookup(locale: Locale, key: string): string | undefined {
  return CATALOGS[locale]?.[key];
}

export function t(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  let found: string | undefined;
  if (vars && typeof vars.count === 'number') {
    const rule = new Intl.PluralRules(locale).select(vars.count);
    found = lookup(locale, `${key}#${rule}`) ?? lookup(locale, `${key}#other`);
    if (found === undefined && locale !== DEFAULT_LOCALE) found = lookup(DEFAULT_LOCALE, `${key}#${new Intl.PluralRules(DEFAULT_LOCALE).select(vars.count)}`) ?? lookup(DEFAULT_LOCALE, `${key}#other`);
  }
  found ??= lookup(locale, key) ?? lookup(DEFAULT_LOCALE, key);
  if (found === undefined) { missingKeys.add(`${locale}:${key}`); return key; }
  return fmt(found, vars);
}

/** Übersetzer für eine feste Sprache */
export const translator = (locale: Locale) => (key: string, vars?: Record<string, string | number>) => t(locale, key, vars);

// ---------- Datum, Zahlen, Geld nach Sprache ----------

/**
 * Ein Tag als Text: „heute“/„morgen“/„übermorgen“ (nur mit `today`), sonst Wochentag + Datum in der Sprache.
 * Deutsch behält das gewohnte Format „Freitag, 13.11.“.
 */
export function formatDay(locale: Locale, ymd: string, today?: string): string {
  if (today) {
    const diff = Math.round((Date.parse(`${ymd}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
    if (diff === 0) return t(locale, 'date.today');
    if (diff === 1) return t(locale, 'date.tomorrow');
    if (diff === 2) return t(locale, 'date.dayAfterTomorrow');
  }
  const d = new Date(`${ymd}T12:00:00Z`);
  if (locale === 'de') {
    const wd = new Intl.DateTimeFormat('de', { weekday: 'long', timeZone: 'UTC' }).format(d);
    return `${wd}, ${d.getUTCDate()}.${d.getUTCMonth() + 1}.`;
  }
  return new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(d);
}

/** Wochentag ausgeschrieben (0 = Sonntag … 6 = Samstag) */
export const weekdayName = (locale: Locale, weekday0Sun: number) =>
  new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 7 + weekday0Sun, 12)));


export const formatDate = (locale: Locale, d: Date | string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'numeric' }) =>
  new Intl.DateTimeFormat(locale, opts).format(typeof d === 'string' ? new Date(`${d.length === 10 ? `${d}T12:00:00` : d}`) : d);

export const formatNumber = (locale: Locale, n: number, opts?: Intl.NumberFormatOptions) => new Intl.NumberFormat(locale, opts).format(n);

export const formatMoney = (locale: Locale, amount: number, currency = 'EUR') =>
  new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
