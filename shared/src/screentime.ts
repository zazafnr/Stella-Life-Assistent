// Bildschirmzeit-Ziele (iOS): Schwellen und Textauswahl. Gleiche Regeln in Swift (ScreenTime.swift); ein Test vergleicht die Zahlen.
// Apple erlaubt keinen Zugriff auf die Nutzungsdaten: iOS meldet nur, wenn eine vorher festgelegte Schwelle erreicht ist.

import type { Tone } from './voice.core.ts';

export const SCREEN_TIME_KINDS = ['half', 'noon', 'eighty', 'limit', 'over'] as const;
export type ScreenTimeKind = (typeof SCREEN_TIME_KINDS)[number];

/** Anzahl Varianten je Art (damit es nicht langweilig wird) */
export const SCREEN_TIME_VARIANTS: Record<ScreenTimeKind, number> = { half: 1, noon: 1, eighty: 2, limit: 2, over: 2 };

/**
 * Schwellen in Minuten für ein Tageslimit: 50 %, 80 %, 100 % und danach jede volle Stunde darüber (2 h, 3 h …, höchstens 16 h).
 * Doppelte (bei kleinen Limits) entfallen.
 */
export function screenTimeThresholds(limitMinutes: number): number[] {
  const limit = Math.max(5, Math.round(limitMinutes));
  const base = [Math.round(limit * 0.5), Math.round(limit * 0.8), limit];
  const hours: number[] = [];
  for (let h = 1; h <= 16; h++) if (h * 60 > limit) hours.push(h * 60);
  return [...new Set([...base, ...hours])].filter((m) => m > 0).sort((a, b) => a - b);
}

/** Welche Art Nachricht gehört zu einer erreichten Schwelle? `hourLocal`: Ortszeit (0–23), für die Mittags-Regel („Auf Kurs?“ vor 13 Uhr) */
export function thresholdKind(minutes: number, limitMinutes: number, hourLocal: number): ScreenTimeKind | null {
  const limit = Math.max(5, Math.round(limitMinutes));
  if (minutes >= limit) return minutes === limit ? 'limit' : 'over';
  if (minutes === Math.round(limit * 0.8)) return 'eighty';
  if (minutes === Math.round(limit * 0.5)) return hourLocal < 13 ? 'noon' : 'half';
  return null;
}

/** Prozent des Limits */
export const thresholdPercent = (minutes: number, limitMinutes: number) => Math.round((minutes / Math.max(5, limitMinutes)) * 100);

/** Katalogschlüssel der Nachricht im Ton der Person; die Variante wechselt nach Tag und Ziel (stabil, ohne Zufall) */
export function screenTimeMessageKey(tone: Tone, kind: ScreenTimeKind, seed: number): string {
  const variants = SCREEN_TIME_VARIANTS[kind];
  return variants === 1 ? `screentime.msg.${tone}.${kind}` : `screentime.msg.${tone}.${kind}.${(Math.abs(seed) % variants) + 1}`;
}

/** Alle Schlüssel (für den Test, dass jede Sprache jeden Text hat) */
export function screenTimeMessageKeys(tones: readonly Tone[]): string[] {
  return tones.flatMap((tone) => SCREEN_TIME_KINDS.flatMap((kind) => Array.from({ length: SCREEN_TIME_VARIANTS[kind] }, (_, i) => screenTimeMessageKey(tone, kind, i))));
}
