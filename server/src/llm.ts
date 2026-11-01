// OpenRouter-Anbindung mit automatischer Modellwahl und Ausweichkette.
//
// Kostenlose Modelle kommen und gehen ständig. Statt eins fest einzutragen, holt Stella
// alle paar Stunden die aktuelle Liste, nimmt die ":free"-Modelle mit Tool-Unterstützung
// und probiert sie der Reihe nach. Ist eins überlastet (429) oder weg (404), geht's mit
// dem nächsten weiter – zuletzt über OpenRouters eigenen Zufalls-Router "openrouter/free".

import { config } from './config.ts';
import { db } from './db.ts';
import { claudeAvailable, completeClaude, type Effort } from './claude.ts';
import { costOverview } from './costs.ts';
import { recordKeyResult, serverAiSettings, serverKey } from './keys.ts';
import { flattenForOpenAi, LlmUnavailable, type LlmMessage, type ToolDef, type Tier } from './llm-types.ts';

export { LlmUnavailable, LlmRefused, flattenForOpenAi } from './llm-types.ts';
export type { ToolCall, ContentPart, LlmMessage, ToolDef, Tier } from './llm-types.ts';

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

/** Gibt es einen OpenRouter-Schlüssel (Umgebung oder in den Einstellungen)? */
export const openrouterAvailable = () => !!serverKey('openrouter');
/** Gibt es irgendeinen Anbieter für Chat-Aufgaben? (Claude oder OpenRouter) */
export const llmAvailable = () => claudeAvailable() || openrouterAvailable();
export const groqAvailable = () => !!serverKey('groq');

export type GroqTask = 'classify' | 'title' | 'extract';

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

export async function modelChain(capability: Capability = 'tools', heavy = false): Promise<string[]> {
  const configured = capability === 'tools' ? config.openrouter.models : config.openrouter.visionModels;
  const strong = heavy ? (capability === 'tools' ? config.openrouter.heavyModels : config.openrouter.heavyVisionModels) : [];
  const auto = configured.length ? [] : pick(await refreshCatalog(), capability);
  return [...new Set([...strong, ...configured, ...auto, FALLBACK_ROUTER])];
}

/** Gratis-Modelle zählen zum Tageslimit von OpenRouter, Bezahlmodelle nicht. */
function isFree(model: string): boolean {
  if (model === FALLBACK_ROUTER || model.endsWith(':free')) return true;
  const info = catalog.find((m) => m.id === model);
  return !!info && Number(info.pricing?.prompt) === 0 && Number(info.pricing?.completion) === 0;
}

export async function modelStatus() {
  const orKey = openrouterAvailable();
  return {
    configured: llmAvailable(),
    claude: {
      configured: claudeAvailable(),
      light: config.anthropic.models.light,
      heavy: config.anthropic.models.heavy,
      allowFreeFallback: serverAiSettings().allowFreeFallback,
    },
    cost: costOverview(),
    chain: orKey ? await modelChain('tools') : [],
    visionChain: orKey ? await modelChain('vision') : [],
    heavy: { tools: config.openrouter.heavyModels, vision: config.openrouter.heavyVisionModels },
    coolingDown: [...cooldownUntil].filter(([, t]) => t > Date.now()).map(([m]) => m),
    usedToday: usageToday(),
    dailyLimit: config.openrouter.dailyLimit,
    groq: { configured: groqAvailable(), models: config.groq.models, usedToday: usageTodayFor('groq') },
  };
}

// ---------- Tagesbudget ----------
// OpenRouter zählt Gratis-Anfragen pro Tag (UTC). Hintergrund-Arbeit (Mails sortieren) darf nur
// die Hälfte nutzen, damit für Chat und HÜs immer etwas übrig bleibt.

const utcDay = () => new Date().toISOString().slice(0, 10);

/** Gratis-Anfragen bei OpenRouter heute (alle Nutzer zusammen – das Limit gilt pro Schlüssel). */
export function usageToday(): number {
  return usageTodayFor('openrouter');
}

export function usageTodayFor(provider: 'openrouter' | 'groq', userId?: string): number {
  const row = (userId === undefined
    ? db.prepare('SELECT COALESCE(SUM(requests), 0) AS n FROM llm_usage WHERE day = ? AND provider = ?').get(utcDay(), provider)
    : db.prepare('SELECT COALESCE(SUM(requests), 0) AS n FROM llm_usage WHERE day = ? AND provider = ? AND user_id = ?').get(utcDay(), provider, userId)) as { n: number };
  return row.n;
}

/** Zähler je Tag, Anbieter und Nutzer – die Grundlage für spätere Limits pro Nutzer. */
function countRequest(provider: 'openrouter' | 'groq', userId = '') {
  db.prepare(`INSERT INTO llm_usage (day, provider, user_id, requests) VALUES (?, ?, ?, 1)
    ON CONFLICT(day, provider, user_id) DO UPDATE SET requests = requests + 1`).run(utcDay(), provider, userId);
}

function checkBudget(background: boolean) {
  const limit = config.openrouter.dailyLimit;
  if (!limit) return;
  const used = usageToday();
  if (background && used >= limit * 0.5) throw new LlmUnavailable('Tagesbudget für Hintergrund-Aufgaben aufgebraucht.');
  if (used >= limit) throw new LlmUnavailable(`Tageslimit von ${limit} KI-Anfragen erreicht (ab 1 Uhr nachts geht's wieder).`);
}

export interface CompletionResult { message: Extract<LlmMessage, { role: 'assistant' }>; model: string; costMicroUsd?: number }

export interface CompleteOptions {
  json?: boolean; vision?: boolean; timeoutMs?: number; background?: boolean; heavy?: boolean;
  /** 'groq' = günstiges Groq-Modell für Masse-Aufgaben (Rückfall auf OpenRouter bei 429/5xx/Fehler) */
  provider?: 'openrouter' | 'groq';
  task?: GroqTask;
  /** für den Zähler pro Nutzer */
  userId?: string;
  /**
   * Stufe nach Kosten (Paket 1): light = Claude Haiku (fast alles), heavy = Claude Sonnet (nur schwere Aufgaben,
   * entscheidet `pickTier` im Router). Ohne Angabe: light.
   */
  tier?: Tier;
  /** Denktiefe bei Claude: low für Aufräumen/Titel/Kurzfassungen, medium für den Chat-Agenten */
  effort?: Effort;
  /** Inhalte aus Mails o. Ä.: gehen nie an Gratis-Anbieter (OpenRouter) */
  private?: boolean;
  maxTokens?: number;
  /** Server-Werkzeuge von Claude (Websuche …) */
  serverTools?: Record<string, unknown>[];
}

// Groq: kurze Pause pro Modell nach 429, damit nicht jede Anfrage erst scheitert
const groqCooldown = new Map<string, number>();

async function completeGroq(messages: LlmMessage[], tools: ToolDef[] | undefined, opts: CompleteOptions): Promise<CompletionResult> {
  const model = config.groq.models[opts.task ?? 'classify'];
  if ((groqCooldown.get(model) ?? 0) > Date.now()) throw new Error(`${model} macht gerade Pause`);
  countRequest('groq', opts.userId);
  const res = await fetch(`${config.groq.baseUrl}/chat/completions`, {
    method: 'POST',
    signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
    headers: { Authorization: `Bearer ${serverKey('groq')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: flattenForOpenAi(messages),
      ...(tools?.length ? { tools, tool_choice: 'auto' } : {}),
      ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
      temperature: 0.2,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 429) groqCooldown.set(model, Date.now() + Math.min(Number(res.headers.get('retry-after')) || 20, 120) * 1000);
    if (res.status === 401 || res.status === 403) recordKeyResult('groq', false, 'Groq lehnt den Schlüssel ab');
    throw new Error(`${model}: ${res.status} ${body.slice(0, 160)}`);
  }
  const json = (await res.json()) as { choices?: { message: CompletionResult['message'] }[] };
  const message = json.choices?.[0]?.message;
  if (!message) throw new Error(`${model}: leere Antwort`);
  recordKeyResult('groq', true);
  return { message, model: `groq/${model}` };
}

export async function complete(messages: LlmMessage[], tools?: ToolDef[], opts: CompleteOptions = {}): Promise<CompletionResult> {
  const errors: string[] = [];
  if (opts.provider === 'groq' && groqAvailable()) {
    try {
      return await completeGroq(messages, tools, opts);
    } catch (err) {
      errors.push(`groq: ${(err as Error).message}`);
      if (!llmAvailable()) throw new LlmUnavailable(`Groq nicht erreichbar.\n${errors.join('\n')}`);
      // weiter mit Claude bzw. der OpenRouter-Kette
    }
  }

  if (claudeAvailable()) {
    try {
      const r = await completeClaude(messages, tools, {
        tier: opts.tier ?? (opts.heavy ? 'heavy' : 'light'), effort: opts.effort, json: opts.json,
        timeoutMs: opts.timeoutMs, maxTokens: opts.maxTokens, userId: opts.userId, serverTools: opts.serverTools,
      });
      return { message: r.message, model: r.model, costMicroUsd: r.costMicroUsd };
    } catch (err) {
      errors.push(`claude: ${(err as Error).message}`);
      // Mit Claude-Schlüssel ist OpenRouter nur der Notfall – und nur, wenn der Owner das erlaubt. Mail-Inhalte nie.
      if (opts.private || !serverAiSettings().allowFreeFallback || !openrouterAvailable()) {
        throw err instanceof LlmUnavailable ? err : new LlmUnavailable(errors.join('\n'));
      }
    }
  } else if (opts.private && !opts.vision) {
    // ohne Claude: Mail-Inhalte dürfen nicht an die Gratis-Modelle
    if (!errors.length) errors.push('Kein Claude-Schlüssel für vertrauliche Inhalte.');
    throw new LlmUnavailable(errors.join('\n'));
  }
  if (!openrouterAvailable()) throw new LlmUnavailable('Kein KI-Schlüssel gesetzt (Anthropic oder OpenRouter).');

  for (const model of await modelChain(opts.vision ? 'vision' : 'tools', opts.heavy)) {
    if ((cooldownUntil.get(model) ?? 0) > Date.now()) continue;
    if (isFree(model)) {
      checkBudget(!!opts.background);
      countRequest('openrouter', opts.userId);
    }
    try {
      const res = await fetch(`${config.openrouter.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
        headers: {
          Authorization: `Bearer ${serverKey('openrouter')}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': config.publicUrl,
          'X-Title': 'Stella Life Assistant',
        },
        body: JSON.stringify({
          model,
          messages: flattenForOpenAi(messages),
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

// ---------- Sprache → Text (Groq Whisper) ----------

const AUDIO_EXT: Record<string, string> = {
  'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/m4a': 'm4a', 'audio/aac': 'aac', 'audio/mpeg': 'mp3',
  'audio/webm': 'webm', 'video/webm': 'webm', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
};

export async function transcribe(audio: Buffer, mime: string, opts: { userId?: string } = {}): Promise<string> {
  const key = serverKey('groq');
  if (!key) throw new LlmUnavailable('Spracherkennung ist noch nicht eingerichtet (Groq-Schlüssel fehlt).');
  const type = mime.split(';')[0]!.trim().toLowerCase();
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio)], { type }), `sprache.${AUDIO_EXT[type] ?? 'm4a'}`);
  form.append('model', config.groq.models.transcribe);
  form.append('language', 'de');
  form.append('response_format', 'json');
  form.append('temperature', '0');
  countRequest('groq', opts.userId);
  let res: Response;
  try {
    res = await fetch(`${config.groq.baseUrl}/audio/transcriptions`, {
      method: 'POST', signal: AbortSignal.timeout(60_000), headers: { Authorization: `Bearer ${key}` }, body: form,
    });
  } catch (err) {
    throw new LlmUnavailable(`Spracherkennung nicht erreichbar: ${(err as Error).message}`);
  }
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 401 || res.status === 403) recordKeyResult('groq', false, 'Groq lehnt den Schlüssel ab');
    throw new LlmUnavailable(`Spracherkennung fehlgeschlagen (${res.status}) ${body.slice(0, 120)}`);
  }
  recordKeyResult('groq', true);
  const text = ((await res.json()) as { text?: string }).text?.trim() ?? '';
  if (!text) throw new LlmUnavailable('Ich konnte nichts verstehen – nochmal sprechen?');
  return text;
}
