// Modell-Router nach Kosten: Haiku (light) erledigt fast alles, Sonnet (heavy) nur schwere Aufgaben und nur mit Kontingent.
// Die Kontingente selbst kommen mit den Abos in Paket 5 (`checkQuota`/`consume` sind bis dahin ein Stub, der alles erlaubt).

import type { Tier } from './llm-types.ts';
import type { User } from './db.ts';

export type QuotaKind = 'ai_message' | 'pro_task';

export interface QuotaResult { ok: boolean; reason?: string }

/** Paket 5 ersetzt den Rumpf: Tageslimit KI-Nachrichten, Monatskontingent Profi-Aufgaben. */
export function checkQuota(_user: User, _kind: QuotaKind): QuotaResult {
  return { ok: true };
}

/** Verbrauch buchen (Paket 5). */
export function consume(_user: User, _kind: QuotaKind): void {}

export type TaskKind = 'chat' | 'homework' | 'weekplan' | 'research';

export interface TierInput {
  text?: string;
  /** ein Bild ist dabei … */
  hasImage?: boolean;
  /** … und soll gelöst werden (Hausübung, Arbeitsblatt) */
  solve?: boolean;
  kind?: TaskKind;
}

/** „Gründlich“ / „genau“ in den unterstützten Sprachen: ein ausdrücklicher Wunsch nach der starken Stufe */
const THOROUGH_RE = /\b(gr[üu]ndlich|genau(?:er|e)?|sorgf[äa]ltig|thorough(?:ly)?|carefully|in depth|a fondo|con cuidado|en d[ée]tail|minutieusement|con precisione|a fundo|cuidadosamente|dikkatli(?:ce)?|ayr[ıi]nt[ıi]l[ıi]|dok[łl]adnie|starannie)\b/i;

/**
 * Welche Stufe braucht diese Aufgabe?
 * heavy: Bild lösen (Hausübung-Autopilot, Arbeitsblatt-Foto), Wochenplaner mit KI, Recherche, ausdrücklich „gründlich“.
 * Alles andere light. Der Chat-Agent startet immer als light und ruft bei Bedarf selbst `escalate` auf.
 */
export function pickTier(_user: User, input: TierInput): Tier {
  if (input.hasImage && input.solve) return 'heavy';
  if (input.kind === 'homework' || input.kind === 'weekplan' || input.kind === 'research') return 'heavy';
  if (input.text && THOROUGH_RE.test(input.text)) return 'heavy';
  return 'light';
}

/**
 * Gewünschte Stufe mit Kontingent abgleichen. Ist die Profi-Aufgabe nicht mehr drin, macht Haiku weiter
 * (`downgraded`: Stella sagt das in einem Satz). Verbraucht wird erst, wenn Sonnet wirklich lief (`consume`).
 */
export function resolveTier(user: User, wanted: Tier): { tier: Tier; downgraded: boolean } {
  if (wanted === 'light') return { tier: 'light', downgraded: false };
  const q = checkQuota(user, 'pro_task');
  return q.ok ? { tier: 'heavy', downgraded: false } : { tier: 'light', downgraded: true };
}
