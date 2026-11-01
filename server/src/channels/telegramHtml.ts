// Markdown (so wie Stella es schreibt) → Telegram-HTML (`parse_mode: 'HTML'`). Erst alles escapen, dann die wenigen Auszeichnungen setzen.

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string) => escapeHtml(s).replace(/"/g, '&quot;');

/** Nur http(s)-Links; alles andere bleibt einfacher Text */
const safeUrl = (u: string) => /^https?:\/\/[^\s<>"]+$/i.test(u);

export function markdownToTelegramHtml(md: string): string {
  const parts: string[] = [];
  // Codeblöcke und `Code` zuerst herausnehmen, damit darin nichts ersetzt wird
  let text = md.replace(/```[a-z]*\n?([\s\S]*?)```/g, (_m, code: string) => { parts.push(`<pre>${escapeHtml(code.trim())}</pre>`); return `\u0000${parts.length - 1}\u0000`; });
  text = text.replace(/`([^`\n]+)`/g, (_m, code: string) => { parts.push(`<code>${escapeHtml(code)}</code>`); return `\u0000${parts.length - 1}\u0000`; });
  text = escapeHtml(text);
  text = text.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, (m, label: string, url: string) => {
    const raw = url.replace(/&amp;/g, '&');
    return safeUrl(raw) ? `<a href="${escapeAttr(raw)}">${label}</a>` : m;
  });
  text = text.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:]|$)/g, '$1<i>$2</i>');
  text = text.replace(/^(\s*)[-*] /gm, '$1• ');
  return text.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => parts[Number(i)]!);
}

/** Telegram erlaubt höchstens 4096 Zeichen: an Absätzen teilen (ein einzelner Riesenabsatz wird hart geteilt) */
export function splitForTelegram(html: string, max = 4000): string[] {
  if (html.length <= max) return [html];
  const chunks: string[] = [];
  let cur = '';
  for (const para of html.split(/\n{2,}/)) {
    const piece = para.length > max ? para.match(new RegExp(`[\\s\\S]{1,${max}}`, 'g'))! : [para];
    for (const p of piece) {
      if (cur && cur.length + p.length + 2 > max) { chunks.push(cur); cur = p; } else cur = cur ? `${cur}\n\n${p}` : p;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}
