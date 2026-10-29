import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

// Simuliertes OpenRouter: ein überlastetes Modell, ein funktionierendes, das ein Werkzeug aufruft.
const calls: { model: string; messages: { role: string; content: string }[] }[] = [];
const mock = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/models') {
      res.end(JSON.stringify({
        data: [
          { id: 'busy/model:free', context_length: 1e6, supported_parameters: ['tools'] },
          { id: 'good/model:free', context_length: 1e5, supported_parameters: ['tools'] },
          { id: 'notools/model:free', context_length: 1e6, supported_parameters: [] },
          { id: 'paid/model', context_length: 1e6, supported_parameters: ['tools'], pricing: { prompt: '0.001', completion: '0.002' } },
        ],
      }));
      return;
    }
    const json = JSON.parse(body);
    calls.push(json);
    if (json.model === 'busy/model:free') { res.statusCode = 429; res.end('{"error":"rate limited"}'); return; }
    const hasToolResult = json.messages.some((m: { role: string }) => m.role === 'tool');
    res.end(JSON.stringify({
      choices: [{
        message: hasToolResult
          ? { role: 'assistant', content: 'Erledigt! Zahnarzt ist eingetragen 🦷' }
          : {
            role: 'assistant', content: null,
            tool_calls: [{ id: 't1', type: 'function', function: { name: 'create_entry', arguments: JSON.stringify({ kind: 'event', title: 'Zahnarzt', due: '2026-11-20', time: '14:30' }) } }],
          },
      }],
    }));
  });
});
await new Promise<void>((r) => mock.listen(0, r));

process.env.STELLA_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'stella-agent-'));
process.env.OPENROUTER_API_KEY = 'test';
process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;
process.env.STELLA_SECRET = 'test-secret-1234567890';

const { register } = await import('./auth.ts');
const { listItems } = await import('./db.ts');
const { handleChat } = await import('./assistant.ts');
const { modelChain } = await import('./llm.ts');

test('automatische Modellwahl: nur kostenlose mit Tools, Router als letzte Rettung', async () => {
  assert.deepEqual(await modelChain(), ['busy/model:free', 'good/model:free', 'openrouter/free']);
});

test('freie Frage → KI ruft Werkzeug auf → Termin im Planer, Ausweichen bei 429', async () => {
  const { user } = register('Lukas', 'l@example.com', 'supergeheim', 'Europe/Vienna');
  const res = await handleChat(user, 'Ich hab am 20. November um halb 3 einen Zahnarzttermin, kannst du das eintragen?', 'x1');
  assert.equal(res.messages.at(-1)!.text, 'Erledigt! Zahnarzt ist eingetragen 🦷');
  assert.equal(listItems(user.id).find((i) => i.title === 'Zahnarzt')?.time, '14:30');
  assert.ok(calls.some((c) => c.model === 'busy/model:free'));
  assert.ok(calls.some((c) => c.model === 'good/model:free'));
  // Systemprompt enthält das heutige Datum, damit die KI rechnen kann
  assert.match(calls.at(-1)!.messages[0].content, /Heute ist/);
  mock.close();
});
