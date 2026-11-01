// KI-Kosten pro Anfrage, Tag, Nutzer und Modell. Grundlage für die Abo-Limits (Paket 5), die Anzeige in den
// Einstellungen und das Firmen-Dashboard. Rechnet in Mikro-Dollar (1 000 000 = 1 $), damit nichts rundet.

import { config } from './config.ts';
import { db } from './db.ts';

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  /** Websuchen des Claude-Server-Werkzeugs */
  webSearches?: number;
}

/** Kosten einer Anfrage in Mikro-Dollar. Preis je Mio. Tokens in $ × Tokens = Mikro-Dollar. */
export function costMicroUsd(model: string, u: TokenUsage): number {
  const p = config.pricing.models[model];
  const search = Math.round((u.webSearches ?? 0) * config.pricing.webSearch * 1e6);
  if (!p) return search;
  const promptTokens = u.input + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
  const long = p.longThreshold !== undefined && promptTokens > p.longThreshold;
  const inRate = long ? (p.longInput ?? p.input) : p.input;
  const outRate = long ? (p.longOutput ?? p.output) : p.output;
  // Cache-Preise hängen am Eingabepreis (Lesen 0,1×, Schreiben 1,25×), falls nicht ausdrücklich gesetzt
  const crRate = p.cacheRead ?? inRate * 0.1;
  const cwRate = p.cacheWrite ?? inRate * 1.25;
  return Math.round(u.input * inRate + u.output * outRate + (u.cacheRead ?? 0) * crRate + (u.cacheWrite ?? 0) * cwRate) + search;
}

const utcDay = () => new Date().toISOString().slice(0, 10);

export function recordCost(model: string, u: TokenUsage, userId = ''): number {
  const cost = costMicroUsd(model, u);
  db.prepare(`INSERT INTO llm_cost (day, user_id, model, requests, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_micro_usd)
    VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)
    ON CONFLICT(day, user_id, model) DO UPDATE SET requests = requests + 1, input_tokens = input_tokens + excluded.input_tokens,
      output_tokens = output_tokens + excluded.output_tokens, cache_read_tokens = cache_read_tokens + excluded.cache_read_tokens,
      cache_write_tokens = cache_write_tokens + excluded.cache_write_tokens, cost_micro_usd = cost_micro_usd + excluded.cost_micro_usd`)
    .run(utcDay(), userId, model, u.input, u.output, u.cacheRead ?? 0, u.cacheWrite ?? 0, cost);
  return cost;
}

export interface CostRow {
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costMicroUsd: number;
}

export interface CostSummary { totalMicroUsd: number; requests: number; byModel: CostRow[] }

const sumRows = (rows: CostRow[]): CostSummary => ({
  totalMicroUsd: rows.reduce((a, r) => a + r.costMicroUsd, 0),
  requests: rows.reduce((a, r) => a + r.requests, 0),
  byModel: rows,
});

const SELECT = `SELECT model, SUM(requests) AS requests, SUM(input_tokens) AS inputTokens, SUM(output_tokens) AS outputTokens,
  SUM(cache_read_tokens) AS cacheReadTokens, SUM(cost_micro_usd) AS costMicroUsd FROM llm_cost`;

/** Kosten eines Nutzers von `from` bis `to` (inklusive, YYYY-MM-DD, UTC-Tage) */
export function costForUser(userId: string, from: string, to: string): CostSummary {
  return sumRows(db.prepare(`${SELECT} WHERE user_id = ? AND day >= ? AND day <= ? GROUP BY model ORDER BY costMicroUsd DESC`).all(userId, from, to) as CostRow[]);
}

/** Kosten aller Nutzer (und des Hintergrunds ohne Nutzer) im Zeitraum */
export function costTotals(from: string, to: string): CostSummary {
  return sumRows(db.prepare(`${SELECT} WHERE day >= ? AND day <= ? GROUP BY model ORDER BY costMicroUsd DESC`).all(from, to) as CostRow[]);
}

/** Kosten je Nutzer im Zeitraum – für das Dashboard (teuerste zuerst) */
export function costPerUser(from: string, to: string): { userId: string; costMicroUsd: number; requests: number }[] {
  return db.prepare(`SELECT user_id AS userId, SUM(cost_micro_usd) AS costMicroUsd, SUM(requests) AS requests FROM llm_cost
    WHERE day >= ? AND day <= ? AND user_id != '' GROUP BY user_id ORDER BY costMicroUsd DESC`).all(from, to) as { userId: string; costMicroUsd: number; requests: number }[];
}

export const microUsdToEur = (micro: number) => (micro / 1e6) * config.pricing.eurPerUsd;

/** Heute und dieser Monat (UTC) für die Einstellungen */
export function costOverview() {
  const day = utcDay();
  return { today: costTotals(day, day), month: costTotals(`${day.slice(0, 7)}-01`, day), eurPerUsd: config.pricing.eurPerUsd };
}
