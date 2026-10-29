// OpenRouter-Anbindung mit automatischer Modellwahl und Ausweichkette.
//
// Kostenlose Modelle kommen und gehen ständig. Statt eins fest einzutragen, holt Stella
// alle paar Stunden die aktuelle Liste, nimmt die ":free"-Modelle mit Tool-Unterstützung
// und probiert sie der Reihe nach. Ist eins überlastet (429) oder weg (404), geht's mit
// dem nächsten weiter – zuletzt über OpenRouters eigenen Zufalls-Router "openrouter/free".

import { config } from './config.ts';
import { db } from './db.ts';

export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }

export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

export type LlmMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | ContentPart[] }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface ToolDef {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

interface ModelInfo {
  id: string;
  context_length?: number;
  supported_parameters?: string[];
  architecture?: { input_modalities?: string[] };
  pricing?: { prompt?: string; completion?: string };
}

const FALLBACK_ROUTER = 'openrouter/free';
const REFRESH_MS = 6 * 60 * 60 * 1000;

/**
 * Vorlieben für die automatische Wahl: Teilstrings von Modell-IDs, die (Stand Ende Oktober 2026)
 * gut mit Deutsch und Tool-Aufrufen umgehen. Überschreibbar mit STELLA_MODELS.
 */
const PREFERRED_HINTS = ['inkling', 'nemotron-3-super', 'gemma-4', 'qwen', 'deepseek', 'llama-4', 'mistral', 'glm'];

type Capability = 'tools' | 'vision';

let catalog: ModelInfo[] = [];
let lastRefresh = 0;
const cooldownUntil = new Map<string, number>();

export const llmAvailable = () => !!config.openrouter.apiKey;

async function refreshCatalog(): Promise<ModelInfo[]> {
  if (Date.now() - lastRefresh < REFRESH_MS && catalog.length) return catalog;
  try {
    const res = await fetch(`${config.openrouter.baseUrl}/models`, { signal: AbortSignal.timeout(15_000) });
    const { data } = (await res.json()) as { data: ModelInfo[] };
    catalog = data;
    lastRefresh = Date.now();
  } catch (err) {
    console.warn('Modell-Liste von OpenRouter nicht abrufbar:', (err as Error).message);
  }
  return catalog;
}

function pick(models: ModelInfo[], capability: Capability): string[] {
  const usable = models.filter((m) => {
    const free = m.id.endsWith(':free') || (Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0);
    if (config.openrouter.freeOnly && !free) return false;
    return capability === 'tools'
      ? m.supported_parameters?.includes('tools')
      : m.architecture?.input_modalities?.includes('image');
  });
  const rank = (m: ModelInfo) => {
    const hint = PREFERRED_HINTS.findIndex((h) => m.id.toLowerCase().includes(h));
    return (hint === -1 ? PREFERRED_HINTS.length : hint) * 1e9 - (m.context_length ?? 0);
  };
  return usable.sort((a, b) => rank(a) - rank(b)).map((m) => m.id).slice(0, 5);
}

export async function modelChain(capability: Capability = 'tools'): Promise<string[]> {
  const configured = capability === 'tools' ? config.openrouter.models : config.openrouter.visionModels;
  const auto = configured.length ? [] : pick(await refreshCatalog(), capability);
  return [...new Set([...configured, ...auto, FALLBACK_ROUTER])];
}

export async function modelStatus() {
  return {
    configured: llmAvailable(),
    chain: llmAvailable() ? await modelChain('tools') : [],
    visionChain: llmAvailable() ? await modelChain('vision') : [],
    coolingDown: [...cooldownUntil].filter(([, t]) => t > Date.now()).map(([m]) => m),
    usedToday: usageToday(),
    dailyLimit: config.openrouter.dailyLimit,
  };
}

export class LlmUnavailable extends Error {}

// ---------- Tagesbudget ----------
// OpenRouter zählt Gratis-Anfragen pro Tag (UTC). Hintergrund-Arbeit (Mails sortieren) darf nur
// die Hälfte nutzen, damit für Chat und HÜs immer etwas übrig bleibt.

const utcDay = () => new Date().toISOString().slice(0, 10);

export function usageToday(): number {
  const row = db.prepare('SELECT requests FROM llm_usage WHERE day = ?').get(utcDay()) as { requests: number } | undefined;
  return row?.requests ?? 0;
}

function countRequest() {
  db.prepare('INSERT INTO llm_usage (day, requests) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET requests = requests + 1').run(utcDay());
}

function checkBudget(background: boolean) {
  const limit = config.openrouter.dailyLimit;
  if (!limit) return;
  const used = usageToday();
  if (background && used >= limit * 0.5) throw new LlmUnavailable('Tagesbudget für Hintergrund-Aufgaben aufgebraucht.');
  if (used >= limit) throw new LlmUnavailable(`Tageslimit von ${limit} KI-Anfragen erreicht (ab 1 Uhr nachts geht's wieder).`);
}

export interface CompletionResult { message: Extract<LlmMessage, { role: 'assistant' }>; model: string }

export async function complete(messages: LlmMessage[], tools?: ToolDef[],
  opts: { json?: boolean; vision?: boolean; timeoutMs?: number; background?: boolean } = {}): Promise<CompletionResult> {
  if (!llmAvailable()) throw new LlmUnavailable('Kein OPENROUTER_API_KEY gesetzt.');
  const errors: string[] = [];

  for (const model of await modelChain(opts.vision ? 'vision' : 'tools')) {
    if ((cooldownUntil.get(model) ?? 0) > Date.now()) continue;
    checkBudget(!!opts.background);
    countRequest();
    try {
      const res = await fetch(`${config.openrouter.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
        headers: {
          Authorization: `Bearer ${config.openrouter.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': config.publicUrl,
          'X-Title': 'Stella Life Assistant',
        },
        body: JSON.stringify({
          model,
          messages,
          ...(tools?.length ? { tools, tool_choice: 'auto' } : {}),
          ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
          temperature: opts.vision ? 0.1 : 0.4,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        errors.push(`${model}: ${res.status} ${body.slice(0, 160)}`);
        // Überlastet oder Tageslimit → eine Weile in Ruhe lassen
        if (res.status === 429) cooldownUntil.set(model, Date.now() + (body.includes('per-day') ? 3_600_000 : 60_000));
        if (res.status === 404 || res.status === 400) cooldownUntil.set(model, Date.now() + REFRESH_MS);
        continue;
      }
      const json = (await res.json()) as { choices?: { message: CompletionResult['message'] }[]; error?: { message: string } };
      const message = json.choices?.[0]?.message;
      if (!message) { errors.push(`${model}: leere Antwort ${json.error?.message ?? ''}`); continue; }
      return { message, model };
    } catch (err) {
      errors.push(`${model}: ${(err as Error).message}`);
    }
  }
  throw new LlmUnavailable(`Kein Modell erreichbar.\n${errors.join('\n')}`);
}
