// Claude-Anbindung (Anthropic Messages API über das offizielle SDK).
//
// Der Rest von Stella spricht seit jeher das OpenAI-Format (LlmMessage/ToolDef). Dieses Modul übersetzt
// hin und zurück, wählt das Modell nach Stufe (light = Haiku, heavy = Sonnet), zählt Tokens und Kosten
// und kümmert sich um Zwischenspeicher (Prompt-Caching), Wiederholung und Ablehnungen.

import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.ts';
import { recordCost } from './costs.ts';
import { recordKeyResult, serverKey } from './keys.ts';
import { LlmRefused, LlmUnavailable, type ContentPart, type LlmMessage, type Tier, type ToolCall, type ToolDef } from './llm-types.ts';

export const claudeAvailable = () => !!serverKey('anthropic');

export type Effort = 'low' | 'medium';

export interface ClaudeOptions {
  tier: Tier;
  effort?: Effort;
  json?: boolean;
  timeoutMs?: number;
  maxTokens?: number;
  userId?: string;
  /** Server-Werkzeuge von Claude (Websuche …), die neben den eigenen Werkzeugen laufen */
  serverTools?: Record<string, unknown>[];
}

export interface ClaudeResult {
  message: Extract<LlmMessage, { role: 'assistant' }>;
  model: string;
  /** Kosten dieser Anfrage in Mikro-Dollar */
  costMicroUsd: number;
}

// ---------- Client ----------

let cached: { key: string; base: string; client: Anthropic } | null = null;

function client(): Anthropic {
  const key = serverKey('anthropic');
  const base = config.anthropic.baseUrl;
  if (!cached || cached.key !== key || cached.base !== base) {
    // maxRetries 0: Wiederholen und Ausweichen steuert Stella selbst (eine Wiederholung, dann Haiku, dann Notfall)
    cached = { key, base, client: new Anthropic({ apiKey: key, ...(base ? { baseURL: base } : {}), maxRetries: 0 }) };
  }
  return cached.client;
}

// ---------- Umwandlung OpenAI-Format → Anthropic ----------

/** Anthropic erlaubt in Werkzeug-IDs nur [a-zA-Z0-9_-] */
const safeId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'tool_0';

type Block = Record<string, unknown>;
type AnthropicMessage = { role: 'user' | 'assistant'; content: string | Block[] };

function imageBlock(url: string): Block {
  const m = /^data:([^;,]+);base64,(.+)$/s.exec(url);
  return m
    ? { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } }
    : { type: 'image', source: { type: 'url', url } };
}

function partToBlock(p: ContentPart): Block {
  return p.type === 'text' ? { type: 'text', text: p.text } : imageBlock(p.image_url.url);
}

/** Argumente eines Werkzeug-Aufrufs immer mit JSON.parse lesen – nie am Text herumraten */
function parseArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || '{}') as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Schema für `strict: true`: alle Objekte geschlossen (additionalProperties: false) */
function closeObjects(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(closeObjects);
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) out[k] = closeObjects(v);
  if (out.type === 'object') {
    if (out.additionalProperties === undefined) out.additionalProperties = false;
    if (out.properties === undefined) out.properties = {};
  }
  return out;
}

/** Strict-Werkzeuge haben Grenzen (u. a. Zahl optionaler Felder). Nur Werkzeuge ohne optionale Felder bekommen strict. */
function strictEligible(schema: unknown): boolean {
  if (Array.isArray(schema)) return schema.every(strictEligible);
  if (!schema || typeof schema !== 'object') return true;
  const s = schema as Record<string, unknown>;
  if (s.type === 'object') {
    const props = Object.keys((s.properties as object | undefined) ?? {});
    const required = new Set((s.required as string[] | undefined) ?? []);
    if (!props.every((p) => required.has(p))) return false;
  }
  return Object.values(s).every(strictEligible);
}

export interface ClaudeRequestBody {
  system: Block[];
  messages: AnthropicMessage[];
  tools?: Block[];
}

const MAX_STRICT_TOOLS = 20;

/**
 * Anfrage bauen. Reihenfolge für den Cache: Werkzeuge → fester Systemteil | veränderlicher Systemteil → Verlauf.
 * Nur Aufrufer mit `dynamic` (der Chat-Agent) bekommen Cache-Punkte; bei allem anderen würde Schreiben mehr kosten als es spart.
 */
export function buildClaudeRequest(messages: LlmMessage[], tools: ToolDef[] | undefined, opts: { json?: boolean; strict?: boolean; serverTools?: Record<string, unknown>[] } = {}): ClaudeRequestBody {
  const fixed: string[] = [];
  const dynamic: string[] = [];
  let cacheable = false;
  const out: AnthropicMessage[] = [];
  const push = (role: 'user' | 'assistant', blocks: Block[]) => {
    if (!blocks.length) return;
    const last = out[out.length - 1];
    if (last && last.role === role) (last.content as Block[]).push(...blocks);
    else out.push({ role, content: [...blocks] });
  };

  for (const m of messages) {
    if (m.role === 'system') {
      fixed.push(m.content);
      if (m.dynamic !== undefined) { cacheable = true; if (m.dynamic) dynamic.push(m.dynamic); }
    } else if (m.role === 'user') {
      push('user', typeof m.content === 'string' ? (m.content.trim() ? [{ type: 'text', text: m.content }] : []) : m.content.map(partToBlock));
    } else if (m.role === 'assistant') {
      if (m.raw?.length) { push('assistant', m.raw as Block[]); continue; }
      const blocks: Block[] = [];
      if (m.content?.trim()) blocks.push({ type: 'text', text: m.content });
      for (const c of m.tool_calls ?? []) blocks.push({ type: 'tool_use', id: safeId(c.id), name: c.function.name, input: parseArgs(c.function.arguments) });
      push('assistant', blocks);
    } else {
      // alle Ergebnisse einer Runde gehören in EINE Nutzer-Nachricht
      push('user', [{ type: 'tool_result', tool_use_id: safeId(m.tool_call_id), content: m.content || '(leer)' }]);
    }
  }

  // Die API verlangt: beginnt mit "user", endet mit "user" (kein Vorbefüllen der Antwort)
  if (out[0]?.role === 'assistant') out.unshift({ role: 'user', content: [{ type: 'text', text: '(früherer Verlauf ausgeblendet)' }] });
  if (out.length && out[out.length - 1]!.role === 'assistant') out.push({ role: 'user', content: [{ type: 'text', text: 'Weiter.' }] });

  const system: Block[] = [];
  if (fixed.length) system.push({ type: 'text', text: fixed.join('\n\n'), ...(cacheable ? { cache_control: { type: 'ephemeral' } } : {}) });
  if (dynamic.length) system.push({ type: 'text', text: dynamic.join('\n\n') });
  if (opts.json) system.push({ type: 'text', text: 'Antworte ausschließlich mit gültigem JSON, ohne Text davor oder danach.' });

  let strictCount = 0;
  const toolBlocks: Block[] = (tools ?? []).map((t) => {
    const schema = closeObjects(t.function.parameters) as Record<string, unknown>;
    const strict = !!opts.strict && strictCount < MAX_STRICT_TOOLS && strictEligible(schema);
    if (strict) strictCount++;
    return { name: t.function.name, description: t.function.description, input_schema: schema, ...(strict ? { strict: true } : {}) };
  });
  const serverTools = opts.serverTools ?? [];
  const allTools = [...toolBlocks, ...serverTools];
  if (cacheable && allTools.length) allTools[allTools.length - 1] = { ...allTools[allTools.length - 1]!, cache_control: { type: 'ephemeral' } };

  // out enthält nur Block-Arrays
  return { system, messages: out, ...(allTools.length ? { tools: allTools } : {}) };
}

// ---------- Aufruf ----------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isRetryable = (err: unknown) =>
  err instanceof Anthropic.APIConnectionError || (err instanceof Anthropic.APIError && (err.status === 429 || (err.status ?? 0) >= 500));

type ClaudeMessage = {
  content: Block[]; stop_reason: string | null; model: string;
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null; server_tool_use?: { web_search_requests?: number } | null };
};

async function callOnce(model: string, heavy: boolean, body: ClaudeRequestBody, opts: ClaudeOptions): Promise<ClaudeMessage> {
  const params = {
    model,
    max_tokens: opts.maxTokens ?? (heavy ? 16_000 : 8_000),
    system: body.system,
    messages: body.messages,
    ...(body.tools ? { tools: body.tools, tool_choice: { type: 'auto' } } : {}),
    // Haiku 5.5 denkt von selbst mit; wie viel, bestimmt allein die Stufe "effort". Keine Temperatur: nicht-Standardwerte lehnt die API ab.
    output_config: { effort: opts.effort ?? (heavy ? 'medium' : 'low') },
  };
  const requestOptions = { timeout: opts.timeoutMs ?? (heavy ? 120_000 : 60_000) };
  // Sonnet: bei einer Ablehnung der Sicherheitsfilter übernimmt serverseitig ein anderes Modell ("default")
  const res = heavy
    ? await client().beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } as never, requestOptions)
    : await client().messages.create(params as never, requestOptions);
  return res as unknown as ClaudeMessage;
}

function fromClaude(res: ClaudeMessage): Extract<LlmMessage, { role: 'assistant' }> {
  const text = res.content.filter((b) => b.type === 'text').map((b) => String(b.text ?? '')).join('').trim();
  const calls: ToolCall[] = res.content.filter((b) => b.type === 'tool_use').map((b) => ({
    id: String(b.id), type: 'function', function: { name: String(b.name), arguments: JSON.stringify(b.input ?? {}) },
  }));
  return { role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}), raw: res.content };
}

/** Eine Anfrage an Claude, mit einer Wiederholung bei 429/5xx. */
async function attempt(tier: Tier, req: ClaudeRequestBody, opts: ClaudeOptions): Promise<ClaudeResult> {
  const model = config.anthropic.models[tier];
  const heavy = tier === 'heavy';
  let res: ClaudeMessage;
  try {
    try {
      res = await callOnce(model, heavy, req, opts);
    } catch (err) {
      if (!isRetryable(err)) throw err;
      await sleep(config.anthropic.retryMs);
      res = await callOnce(model, heavy, req, opts);
    }
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      recordKeyResult('anthropic', false, 'Anthropic lehnt den Schlüssel ab');
    }
    throw err;
  }
  recordKeyResult('anthropic', true);
  const u = res.usage;
  const costMicroUsd = recordCost(res.model || model, {
    input: u.input_tokens, output: u.output_tokens, cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0, webSearches: u.server_tool_use?.web_search_requests ?? 0,
  }, opts.userId);

  if (res.stop_reason === 'refusal') throw new LlmRefused('Die KI hat diese Anfrage aus Sicherheitsgründen abgelehnt.');
  const message = fromClaude(res);
  // Abgeschnittene Werkzeug-Aufrufe sind unbrauchbar; abgeschnittener Text ist besser als nichts
  if (res.stop_reason === 'max_tokens' && message.tool_calls?.length) throw new LlmUnavailable('Die Antwort der KI wurde abgeschnitten (max_tokens).');
  return { message, model: res.model || model, costMicroUsd };
}

/**
 * Anfrage an Claude. Ausweichkette: Wiederholung bei 429/5xx (in `attempt`) → bei heavy Haiku statt Sonnet
 * → Fehler (der Aufrufer in llm.ts probiert danach ggf. den Notfall-Anbieter).
 * Bei einer Ablehnung durch Haiku (kein serverseitiger Ersatz) versucht es Sonnet mit Server-Fallback.
 */
export async function completeClaude(messages: LlmMessage[], tools: ToolDef[] | undefined, opts: ClaudeOptions): Promise<ClaudeResult> {
  const build = (strict: boolean) => buildClaudeRequest(messages, tools, { json: opts.json, strict, serverTools: opts.serverTools });
  const run = async (tier: Tier): Promise<ClaudeResult> => {
    try {
      return await attempt(tier, build(config.anthropic.strictTools), opts);
    } catch (err) {
      // Schema-Probleme bei strict nicht zum Absturz werden lassen: einmal ohne strict
      if (err instanceof Anthropic.BadRequestError && config.anthropic.strictTools && /strict|schema/i.test(err.message)) {
        return attempt(tier, build(false), opts);
      }
      throw err;
    }
  };
  try {
    return await run(opts.tier);
  } catch (err) {
    if (err instanceof LlmRefused && opts.tier === 'light') return run('heavy');
    if (opts.tier === 'heavy' && !(err instanceof LlmRefused) && err instanceof Error && !(err instanceof LlmUnavailable && /abgeschnitten/.test(err.message))) {
      try { return await run('light'); } catch { /* der ursprüngliche Fehler zählt */ }
    }
    if (err instanceof LlmUnavailable) throw err;
    throw new LlmUnavailable(`Claude nicht erreichbar: ${(err as Error).message}`.slice(0, 300));
  }
}
