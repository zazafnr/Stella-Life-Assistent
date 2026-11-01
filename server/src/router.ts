// Modell-Router nach Kosten: Haiku (light) erledigt fast alles, Sonnet (heavy) nur schwere Aufgaben und nur mit Kontingent.
// Die Kontingente selbst kommen mit den Abos in Paket 5 (`checkQuota`/`consume` sind bis dahin ein Stub, der alles erlaubt).

import type { Tier } from './llm-types.ts';
import type { User } from './db.ts';

export type { QuotaKind } from './billing.ts';
import { consumeQuota, quotaFor, type QuotaKind } from './billing.ts';

export interface QuotaResult { ok: boolean; reason?: 'limit' | 'homework_only'; used?: number; limit?: number }

/** Kontingent prüfen (Abo-Limits aus billing.ts). `homework`: die Profi-Aufgabe ist das Lösen einer Hausübung. */
export function checkQuota(user: User, kind: QuotaKind, opts: { homework?: boolean } = {}): QuotaResult {
  const q = quotaFor(user, kind, opts);
  return { ok: q.ok, reason: q.reason, used: q.used, limit: q.limit };
}

/** Verbrauch buchen */
export function consume(user: User, kind: QuotaKind): void { consumeQuota(user, kind); }

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
/** Restaurants, Reservieren, Verfügbarkeit („lagernd?“) in den unterstützten Sprachen: Profi-Aufgabe mit Websuche */
export const ERRAND_RE = /\b(restaurant\w*|reserv\w*|tisch\s+(?:für|fuer)|essen\s+gehen|abendessen\s+gehen|lagernd|auf\s+lager|vorr[äa]tig|verf[üu]gbar\w*|in\s+stock|available|book\s+a\s+table|table\s+for|where\s+can\s+i\s+(?:buy|get)|wo\s+(?:bekomme|kriege)\s+ich|mesa\s+para|reservar|restaurante|en\s+stock|disponible|r[ée]server|une\s+table|en\s+rupture|tavolo\s+per|prenot\w+|disponibil\w+|mesa\s+para|dispon[íi]vel|em\s+estoque|masa\s+ayırt\w*|rezervasyon|stokta|rezerwacj\w*|stolik|dost[ęe]pn\w+|w\s+magazynie)\b/i;

export function pickTier(_user: User, input: TierInput): Tier {
  if (input.hasImage && input.solve) return 'heavy';
  if (input.kind === 'homework' || input.kind === 'weekplan' || input.kind === 'research') return 'heavy';
  if (input.text && THOROUGH_RE.test(input.text)) return 'heavy';
  if (input.kind === 'chat' && input.text && ERRAND_RE.test(input.text)) return 'heavy';
  return 'light';
}

/**
 * Gewünschte Stufe mit Kontingent abgleichen. Ist die Profi-Aufgabe nicht mehr drin, macht Haiku weiter
 * (`downgraded`: Stella sagt das in einem Satz). Verbraucht wird erst, wenn Sonnet wirklich lief (`consume`).
 */
export function resolveTier(user: User, wanted: Tier, opts: { homework?: boolean } = {}): { tier: Tier; downgraded: boolean; reason?: 'limit' | 'homework_only' } {
  if (wanted === 'light') return { tier: 'light', downgraded: false };
  const q = checkQuota(user, 'pro_task', opts);
  return q.ok ? { tier: 'heavy', downgraded: false } : { tier: 'light', downgraded: true, reason: q.reason };
}
