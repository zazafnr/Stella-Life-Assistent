// Gemeinsame Typen für alle KI-Anbieter (OpenAI-Format, das der Agent seit jeher benutzt).

export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }

export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

export type LlmMessage =
  /** `dynamic`: der veränderliche Teil (Datum, Lagebild, Gedächtnis). Er kommt bei Claude nach dem Cache-Punkt. */
  | { role: 'system'; content: string; dynamic?: string }
  | { role: 'user'; content: string | ContentPart[] }
  /** `raw`: Originalblöcke von Claude (inkl. Denkblöcke). Sie müssen in Werkzeug-Runden unverändert zurück. */
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[]; raw?: unknown[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface ToolDef {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export type Tier = 'light' | 'heavy';

export class LlmUnavailable extends Error {}

/** Die KI hat die Anfrage aus Sicherheitsgründen abgelehnt (stop_reason "refusal"). */
export class LlmRefused extends LlmUnavailable {}

/** Für Anbieter im OpenAI-Format: Systemteile zusammenfügen, Claude-Rohblöcke weglassen. */
export function flattenForOpenAi(messages: LlmMessage[]): unknown[] {
  return messages.map((m) => {
    if (m.role === 'system') return { role: 'system', content: m.dynamic ? `${m.content}\n\n${m.dynamic}` : m.content };
    if (m.role === 'assistant') {
      const { raw: _raw, ...rest } = m;
      return rest;
    }
    return m;
  });
}
