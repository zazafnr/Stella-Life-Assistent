// Kleine Seiten im Schwarz-Weiß-Stil der Website (Rückgängig-Link, später Anmelde-Link): mehrsprachig, fürs Handy gebaut.

import { t, type Locale } from '@stella/shared';
import { escapeHtml } from './layout.ts';

export interface SimplePage {
  locale: Locale;
  title: string;
  text: string;
  /** Knopf, der ein Formular abschickt (POST) – damit Mail-Scanner, die Links aufrufen, nichts auslösen */
  form?: { action: string; button: string; fields?: Record<string, string> };
  link?: { href: string; label: string };
  tone?: 'ok' | 'warn';
  /** großer Code (z. B. 6-stelliger Anmeldecode) */
  code?: string;
  small?: string;
}

export function simplePage(p: SimplePage): string {
  const mark = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 2c.6 4.8 3.2 7.4 8 8-4.8.6-7.4 3.2-8 8-.6-4.8-3.2-7.4-8-8 4.8-.6 7.4-3.2 8-8z" fill="#FF7EB3"/></svg>';
  return `<!doctype html>
<html lang="${p.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<meta name="color-scheme" content="light dark"><title>${escapeHtml(p.title)} · Stella</title>
<style>
:root{--bg:#fff;--ink:#09090B;--muted:#71717A;--card:#F4F4F5;--line:#E4E4E7}
@media (prefers-color-scheme:dark){:root{--bg:#09090B;--ink:#FAFAFA;--muted:#A1A1AA;--card:#18181B;--line:#27272A}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px;padding:24px 20px;background:var(--bg);color:var(--ink);font:400 16px/1.55 'Geist',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif}
.brand{display:flex;align-items:center;gap:8px;font-weight:600;font-size:18px}.brand small{margin-left:10px;font-size:10px;letter-spacing:.38em;color:var(--muted);font-weight:500}
main{width:100%;max-width:440px;background:var(--card);border:1px solid var(--line);border-radius:20px;padding:30px 26px;text-align:center}
h1{margin:0 0 10px;font-size:24px;line-height:1.25;font-weight:600;letter-spacing:-.01em}p{margin:0 0 16px;color:var(--muted)}
.code{margin:18px 0 20px;padding:16px 8px;background:var(--bg);border:1px solid var(--line);border-radius:14px;font:500 36px/1.2 'Geist Mono',ui-monospace,Menlo,Consolas,monospace;letter-spacing:.3em;color:var(--ink)}
button,.btn{display:block;width:100%;height:52px;border:0;border-radius:14px;background:var(--ink);color:var(--bg);font:600 16px/52px inherit;font-family:inherit;text-align:center;text-decoration:none;cursor:pointer}
.warn h1{color:#C0306E}small.s{display:block;margin-top:16px;color:var(--muted);font-size:13px}
</style></head><body>
<div class="brand">${mark}Stella<small>EVOLSIOR</small></div>
<main class="${p.tone === 'warn' ? 'warn' : ''}"><h1>${escapeHtml(p.title)}</h1><p>${escapeHtml(p.text)}</p>
${p.code ? `<div class="code" aria-label="code">${escapeHtml(p.code)}</div>` : ''}
${p.form ? `<form method="post" action="${escapeHtml(p.form.action)}">${Object.entries(p.form.fields ?? {}).map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`).join('')}<button type="submit">${escapeHtml(p.form.button)}</button></form>` : ''}
${p.link ? `<a class="btn" href="${escapeHtml(p.link.href)}">${escapeHtml(p.link.label)}</a>` : ''}
${p.small ? `<small class="s">${escapeHtml(p.small)}</small>` : ''}
</main>
<small style="color:var(--muted);font-size:12px">${escapeHtml(t(p.locale, 'email.footer.tagline'))}</small>
</body></html>`;
}
