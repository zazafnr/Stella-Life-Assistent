// Übersetzen: t(locale, 'schlüssel', { name }). Fehlt ein Schlüssel, gilt Englisch, dann der Schlüssel selbst.
// Platzhalter {name}; Mehrzahl über Intl.PluralRules mit Schlüsseln "key#one" / "key#other" und der Variable `count`.

import { DEFAULT_LOCALE, type Locale } from './locales.ts';
import { describeRecurrence, describeRecurrenceEn, parseRecurrence, type Recurrence } from '../recurrence.ts';
import en from './catalog/en.json' with { type: 'json' };
import de from './catalog/de.json' with { type: 'json' };
import es from './catalog/es.json' with { type: 'json' };
import fr from './catalog/fr.json' with { type: 'json' };
import it from './catalog/it.json' with { type: 'json' };
import ptBR from './catalog/pt-BR.json' with { type: 'json' };
import tr from './catalog/tr.json' with { type: 'json' };
import pl from './catalog/pl.json' with { type: 'json' };

export type Catalog = Record<string, string>;

/** Alle Kataloge. */
export const CATALOGS: Record<Locale, Catalog> = { en, de, es, fr, it, 'pt-BR': ptBR, tr, pl };

/**
 * Edition-Plugins bringen eigene Schlüssel mit (in allen acht Sprachen). Vorhandene Schlüssel des Kerns werden nicht überschrieben.
 */
export function extendCatalogs(extra: Partial<Record<Locale, Catalog>>): void {
  for (const [locale, entries] of Object.entries(extra) as [Locale, Catalog][]) {
    const target = CATALOGS[locale];
    if (!target) continue;
    for (const [k, val] of Object.entries(entries)) if (!(k in target)) target[k] = val;
  }
}

/**
 * Überschreibungen einer Edition für Schlüssel des Kerns (z. B. Schulwörter statt der neutralen Texte im normalen Stella).
 * Sie gelten nur, wenn `t(…, edition)` mit dieser Edition gerufen wird – so antwortet ein Server beiden Apps in deren Vokabular.
 */
const OVERRIDES: Partial<Record<string, Partial<Record<Locale, Catalog>>>> = {};
export function extendEditionCatalogs(edition: string, overrides: Partial<Record<Locale, Catalog>>): void {
  const target = (OVERRIDES[edition] ??= {});
  for (const [locale, entries] of Object.entries(overrides) as [Locale, Catalog][]) target[locale] = { ...target[locale], ...entries };
}

/** Für Tests: ein Schlüssel, der fehlt, wird hier gesammelt */
export const missingKeys = new Set<string>();

const fmt = (text: string, vars?: Record<string, string | number>) =>
  vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text;

function lookup(locale: Locale, key: string, edition?: string): string | undefined {
  return (edition ? OVERRIDES[edition]?.[locale]?.[key] : undefined) ?? CATALOGS[locale][key];
}

export function t(locale: Locale, key: string, vars?: Record<string, string | number>, edition?: string): string {
  let found: string | undefined;
  if (vars && typeof vars.count === 'number') {
    const rule = new Intl.PluralRules(locale).select(vars.count);
    found = lookup(locale, `${key}#${rule}`, edition) ?? lookup(locale, `${key}#other`, edition);
    if (found === undefined && locale !== DEFAULT_LOCALE) found = lookup(DEFAULT_LOCALE, `${key}#${new Intl.PluralRules(DEFAULT_LOCALE).select(vars.count)}`, edition) ?? lookup(DEFAULT_LOCALE, `${key}#other`, edition);
  }
  found ??= lookup(locale, key, edition) ?? lookup(DEFAULT_LOCALE, key, edition);
  if (found === undefined) { missingKeys.add(`${locale}:${key}`); return key; }
  return fmt(found, vars);
}

/** Übersetzer für eine feste Sprache */
export const translator = (locale: Locale, edition?: string) => (key: string, vars?: Record<string, string | number>) => t(locale, key, vars, edition);

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

// ---------- Wiederholungen in der Sprache der Person ----------

/** „every Monday and Thursday“, „werktags“ … in jeder der acht Sprachen (Deutsch und Englisch behalten ihre gewohnten Sätze) */
export function describeRecurrenceIn(locale: Locale, rec: Recurrence | string): string {
  if (locale === 'de') return describeRecurrence(rec);
  if (locale === 'en') return describeRecurrenceEn(rec);
  const r = typeof rec === 'string' ? parseRecurrence(rec) : rec;
  if (!r) return '';
  if (r.kind === 'daily') return t(locale, 'rec.daily');
  if (r.kind === 'monthly') return t(locale, 'rec.monthly', { day: r.day });
  if (r.days.join(',') === '1,2,3,4,5') return t(locale, 'rec.weekdays');
  if (r.days.join(',') === '6,7') return t(locale, 'rec.weekends');
  const names = r.days.map((d) => weekdayName(locale, d % 7));
  return t(locale, 'rec.every', { days: new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(names) });
}
