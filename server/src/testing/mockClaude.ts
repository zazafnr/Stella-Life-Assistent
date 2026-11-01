// Simulierte Anthropic-Messages-API für Tests (Format der echten API: Werkzeuge, Ablehnung, 429, Cache-Zähler).

import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';

export interface MockRequest { path: string; headers: Record<string, string | string[] | undefined>; body: any }

export type MockReply =
  | { status: number; error: { type: string; message: string } }
  | { content: Record<string, unknown>[]; stop_reason?: string; usage?: Partial<Usage>; model?: string };

interface Usage { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

export const text = (t: string): MockReply => ({ content: [{ type: 'text', text: t }] });
export const toolUse = (name: string, input: Record<string, unknown>, id = `toolu_${name}`): MockReply => ({
  content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use',
});
export const refusal = (): MockReply => ({ content: [], stop_reason: 'refusal' });
export const httpError = (status: number, type = status === 429 ? 'rate_limit_error' : 'api_error'): MockReply => ({
  status, error: { type, message: `mock ${status}` },
});

/**
 * `script` entscheidet pro Anfrage. Der Mock simuliert auch das Prompt-Caching: Sieht er Werkzeuge + festen Systemteil
 * mit cache_control zum zweiten Mal unverändert, meldet er die Tokens als `cache_read_input_tokens`.
 */
export async function startMockClaude(script: (req: MockRequest, n: number) => MockReply) {
  const requests: MockRequest[] = [];
  const seenPrefixes = new Set<string>();
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      const path = (req.url ?? '').split('?')[0]!;
      if (path === '/v1/models') { res.end(JSON.stringify({ data: [{ id: 'claude-haiku-5-5', type: 'model' }], has_more: false })); return; }
      const body = raw ? JSON.parse(raw) : {};
      const entry: MockRequest = { path, headers: req.headers, body };
      requests.push(entry);
      const reply = script(entry, requests.length);
      if ('error' in reply) {
        res.statusCode = reply.status;
        res.end(JSON.stringify({ type: 'error', error: reply.error }));
        return;
      }
      const usage: Usage = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...reply.usage };
      const system = Array.isArray(body.system) ? body.system : [];
      const cachedPart = system.find((b: { cache_control?: unknown }) => b.cache_control);
      if (cachedPart && !reply.usage) {
        const key = createHash('sha256').update(JSON.stringify([body.model, body.tools ?? [], cachedPart.text])).digest('hex');
        if (seenPrefixes.has(key)) { usage.cache_read_input_tokens = 800; usage.input_tokens = 200; } else { usage.cache_creation_input_tokens = 800; seenPrefixes.add(key); }
      }
      res.end(JSON.stringify({
        id: `msg_${requests.length}`, type: 'message', role: 'assistant', model: reply.model ?? body.model,
        content: reply.content, stop_reason: reply.stop_reason ?? 'end_turn', stop_sequence: null, usage,
      }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
    close: () => new Promise<void>((r) => { server.close(() => r()); }),
  };
}
