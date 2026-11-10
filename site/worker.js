// evolsior.com: Worker nur für /assets/video/* (run_worker_first in wrangler.jsonc). Alles andere kommt direkt als statische Datei.
// Grund: Workers Static Assets beantworten Range-Anfragen mit 200 und der ganzen Datei, ohne Accept-Ranges.
// Safari spielt so kein Video ab. Hier wird die Datei ohne Range geholt und genau ein Bereich als 206 ausgeliefert.

const TYPES = { mp4: 'video/mp4', jpg: 'image/jpeg', jpeg: 'image/jpeg', webm: 'video/webm', vtt: 'text/vtt; charset=utf-8' };
const BASE_HEADERS = {
  'Accept-Ranges': 'bytes',
  'Cache-Control': 'public, max-age=31536000, immutable',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

// "bytes=a-b", "bytes=a-", "bytes=-n" → { start, end } (end inklusive); null = Header ignorieren (ganze Datei); false = 416
export function parseRange(header, size) {
  const m = /^\s*bytes\s*=\s*(.*)$/i.exec(header || '');
  if (!m) return null; // andere Einheit: ignorieren
  const spec = m[1].trim();
  if (spec.includes(',')) return null; // mehrere Bereiche: nicht unterstützt, ganze Datei (RFC 9110 erlaubt das Ignorieren)
  const r = /^(\d*)\s*-\s*(\d*)$/.exec(spec);
  if (!r || (r[1] === '' && r[2] === '')) return false;
  let start, end;
  if (r[1] === '') { // Suffix: die letzten n Bytes
    const n = Number(r[2]);
    if (n === 0 || size === 0) return false;
    start = Math.max(0, size - n); end = size - 1;
  } else {
    start = Number(r[1]);
    const last = r[2] === '' ? size - 1 : Number(r[2]);
    if (start >= size || last < start) return false;
    end = Math.min(last, size - 1);
  }
  return { start, end };
}

// schneidet [start, end] aus einem Byte-Stream, ohne die ganze Datei in den Speicher zu legen
function sliceStream(body, start, end) {
  const reader = body.getReader();
  let pos = 0;
  return new ReadableStream({
    async pull(ctrl) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) { ctrl.close(); return; }
        const from = pos; pos += value.byteLength;
        if (pos <= start) continue;
        const s = Math.max(0, start - from), e = Math.min(value.byteLength, end + 1 - from);
        if (e > s) ctrl.enqueue(value.subarray(s, e));
        if (pos > end) { ctrl.close(); reader.cancel().catch(() => {}); }
        return;
      }
    },
    cancel(reason) { return reader.cancel(reason); },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/assets/video/')) return env.ASSETS.fetch(request);

    const method = request.method;
    if (method !== 'GET' && method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }

    // Datei immer vollständig und ohne Range holen
    const asset = await env.ASSETS.fetch(new Request(url.toString(), { method: 'GET' }));
    if (!asset.ok || !asset.body) return asset; // 404-Seite usw. unverändert

    const ext = url.pathname.split('.').pop().toLowerCase();
    const headers = new Headers(BASE_HEADERS);
    headers.set('Content-Type', TYPES[ext] || asset.headers.get('Content-Type') || 'application/octet-stream');
    const etag = asset.headers.get('ETag');
    if (etag) headers.set('ETag', etag);

    let size = Number(asset.headers.get('Content-Length'));
    let body = asset.body;
    if (!Number.isFinite(size) || size <= 0 || !asset.headers.has('Content-Length')) {
      // Fallback ohne Content-Length: einmal puffern
      const buf = await asset.arrayBuffer();
      size = buf.byteLength;
      body = new Blob([buf]).stream();
    }

    const finish = (status, start, end) => {
      const len = end - start + 1;
      headers.set('Content-Length', String(len));
      if (status === 206) headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
      if (method === 'HEAD') { body.cancel().catch(() => {}); return new Response(null, { status, headers }); }
      const part = status === 206 ? sliceStream(body, start, end) : body;
      const { readable, writable } = new FixedLengthStream(len);
      part.pipeTo(writable).catch(() => {});
      return new Response(readable, { status, headers });
    };

    let range = request.headers.get('Range');
    const ifRange = request.headers.get('If-Range');
    if (range && ifRange && ifRange !== etag) range = null; // Datei hat sich geändert: ganze Datei

    if (!range) {
      const inm = request.headers.get('If-None-Match');
      if (etag && inm && inm.split(',').some((t) => t.trim() === etag || t.trim() === '*')) {
        body.cancel().catch(() => {});
        headers.delete('Content-Type');
        return new Response(null, { status: 304, headers });
      }
      return finish(200, 0, size - 1);
    }

    const r = parseRange(range, size);
    if (r === null) return finish(200, 0, size - 1);
    if (r === false) {
      body.cancel().catch(() => {});
      headers.set('Content-Range', `bytes */${size}`);
      headers.set('Content-Length', '0');
      headers.delete('Content-Type');
      return new Response(null, { status: 416, headers });
    }
    return finish(206, r.start, r.end);
  },
};
