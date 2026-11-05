// Übersetzungen für die Web-App. `useT()` gibt eine Funktion t('schlüssel', { name }) in der Sprache der Nutzerin.
// Vor der Anmeldung gilt die Sprache des Browsers bzw. die zuletzt gewählte (localStorage).

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { DEFAULT_LOCALE, isLocale, matchLocale, t as translate, type Locale } from '@stella/shared';
import { useStore } from './store.ts';
import { appConfig } from './app.ts';

const KEY = `${appConfig().storagePrefix}.locale`;

function stored(): Locale | null {
  try { const v = localStorage.getItem(KEY); return isLocale(v) ? v : null; } catch { return null; }
}

/** Sprache des Browsers, falls Stella sie kann, sonst Englisch */
export const browserLocale = (): Locale => matchLocale(typeof navigator === 'undefined' ? '' : (navigator.languages?.join(',') || navigator.language));

let chosen: Locale | null = stored();
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

/** Sprache merken (vor der Anmeldung gewählt oder aus dem Konto) und alle Texte neu zeichnen */
export function rememberLocale(l: Locale) {
  if (chosen === l) return;
  chosen = l;
  try { localStorage.setItem(KEY, l); } catch { /* ohne Speicher geht es auch */ }
  listeners.forEach((fn) => fn());
}

/** Aktuelle Sprache: Einstellung der Nutzerin → zuletzt gewählt → Browser → Englisch */
export function useLocale(): Locale {
  const fromMe = useStore((s) => s.me?.settings.locale);
  const picked = useSyncExternalStore(subscribe, () => chosen);
  return isLocale(fromMe) ? fromMe : picked ?? browserLocale() ?? DEFAULT_LOCALE;
}

export function useT() {
  const locale = useLocale();
  return useCallback((key: string, vars?: Record<string, string | number>) => translate(locale, key, vars), [locale]);
}

/** `<html lang>` auf die aktuelle Sprache setzen */
export function useHtmlLang() {
  const locale = useLocale();
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
}
