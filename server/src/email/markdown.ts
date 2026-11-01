// Stellas Antworten (Markdown: fett, Kursiv, Listen, Links, Code) als sicheres E-Mail-HTML. Alles wird zuerst escaped,
// Links nur mit http(s)/mailto. Dazu die Klartext-Fassung.

import { escapeHtml, safeUrl } from './layout.ts';

const FONT = "'Geist', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
const P = `margin:0 0 14px;font:400 16px/1.55 ${FONT};color:#3F3F46`;

/** Zeilen-Formatierung: Text wurde schon escaped */
function inline(escaped: string): string {
  return escaped
    .replace(/`([^`\n]+)`/g, '<code style="background:#F4F4F5;border-radius:6px;padding:1px 5px;font-size:14px">$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong style="font-weight:600">$1</strong>')
    .replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?:;])/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?:;])/g, '$1<em>$2</em>')
    // [Text](https://…) – die Adresse wurde mit escaped, &amp; bleibt gültig im href
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, (_m, label: string, url: string) =>
      `<a href="${safeUrl(url.replace(/&amp;/g, '&')).replace(/&/g, '&amp;')}" style="color:#09090B;text-decoration:underline">${label}</a>`)
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_m, pre: string, url: string) =>
      `${pre}<a href="${url}" style="color:#09090B;text-decoration:underline">${url}</a>`);
}

export function markdownToEmail(markdown: string): { html: string; text: string } {
  const lines = String(markdown ?? '').replace(/\r/g, '').split('\n');
  const html: string[] = [];
  let list: string[] = [];
  let para: string[] = [];
  const flushList = () => {
    if (!list.length) return;
    html.push(`<ul style="margin:0 0 14px;padding-left:22px;font:400 16px/1.55 ${FONT};color:#3F3F46">${list.map((i) => `<li style="margin:0 0 4px">${inline(escapeHtml(i))}</li>`).join('')}</ul>`);
    list = [];
  };
  const flushPara = () => {
    if (!para.length) return;
    html.push(`<p class="body" style="${P}">${inline(escapeHtml(para.join('\n'))).replace(/\n/g, '<br>')}</p>`);
    para = [];
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = /^\s*(?:[-*•]|\d+[.)])\s+(.+)$/.exec(line);
    if (bullet) { flushPara(); list.push(bullet[1]!); continue; }
    if (!line.trim()) { flushList(); flushPara(); continue; }
    flushList();
    const heading = /^#{1,4}\s+(.+)$/.exec(line);
    if (heading) { flushPara(); html.push(`<p class="ink" style="margin:6px 0 8px;font:600 17px/1.4 ${FONT};color:#09090B">${inline(escapeHtml(heading[1]!))}</p>`); continue; }
    para.push(line);
  }
  flushList();
  flushPara();
  const text = String(markdown ?? '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1').replace(/^#{1,4}\s+/gm, '').replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)').trim();
  return { html: html.join('\n    '), text };
}
