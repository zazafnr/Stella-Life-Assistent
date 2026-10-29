// OpenRouter-Anbindung mit automatischer Modellwahl und Ausweichkette.
//
// Kostenlose Modelle kommen und gehen ständig. Statt eins fest einzutragen, holt Stella
// alle paar Stunden die aktuelle Liste, nimmt die ":free"-Modelle mit Tool-Unterstützung
// und probiert sie der Reihe nach. Ist eins überlastet (429) oder weg (404), geht's mit
// dem nächsten weiter – zuletzt über OpenRouters eigenen Zufalls-Router "openrouter/free".

import { config } from './config.ts';

export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }

export type LlmMessage =
  | { role: 'system' | 'user'; content: string }
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

let cachedModels: string[] = [];
let lastRefresh = 0;
const cooldownUntil = new Map<string, number>();

export const llmAvailable = () => !!config.openrouter.apiKey;

async function refreshModels(): Promise<string[]> {
  if (Date.now() - lastRefresh < REFRESH_MS && cachedModels.length) return cachedModels;
  try {
    const res = await fetch(`${config.openrouter.baseUrl}/models`, { signal: AbortSignal.timeout(15_000) });
    const { data } = (await res.json()) as { data: ModelInfo[] };
    const usable = data.filter((m) => {
      const free = m.id.endsWith(':free') || (Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0);
      return (!config.openrouter.freeOnly || free) && m.supported_parameters?.includes('tools');
    });
    const rank = (m: ModelInfo) => {
      const hint = PREFERRED_HINTS.findIndex((h) => m.id.toLowerCase().includes(h));
      return (hint === -1 ? PREFERRED_HINTS.length : hint) * 1e9 - (m.context_length ?? 0);
    };
    cachedModels = usable.sort((a, b) => rank(a) - rank(b)).map((m) => m.id).slice(0, 5);
    lastRefresh = Date.now();
  } catch (err) {
    console.warn('Modell-Liste von OpenRouter nicht abrufbar:', (err as Error).message);
  }
  return cachedModels;
}

export async function modelChain(): Promise<string[]> {
  const configured = config.openrouter.models;
  const auto = configured.length ? [] : await refreshModels();
  return [...new Set([...configured, ...auto, FALLBACK_ROUTER])];
}

export async function modelStatus() {
  return {
    configured: llmAvailable(),
    chain: llmAvailable() ? await modelChain() : [],
    coolingDown: [...cooldownUntil].filter(([, t]) => t > Date.now()).map(([m]) => m),
  };
}

export class LlmUnavailable extends Error {}

export interface CompletionResult { message: Extract<LlmMessage, { role: 'assistant' }>; model: string }

export async function complete(messages: LlmMessage[], tools?: ToolDef[], opts: { json?: boolean } = {}): Promise<CompletionResult> {
  if (!llmAvailable()) throw new LlmUnavailable('Kein OPENROUTER_API_KEY gesetzt.');
  const errors: string[] = [];

  for (const model of await modelChain()) {
    if ((cooldownUntil.get(model) ?? 0) > Date.now()) continue;
    try {
      const res = await fetch(`${config.openrouter.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: AbortSignal.timeout(60_000),
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
          temperature: 0.4,
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
