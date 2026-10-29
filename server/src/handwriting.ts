// Schreibt Text "per Hand" auf liniertes Heftpapier (PNG).
//
// Damit es nach DEINER Schrift aussieht: auf calligraphr.com eine Vorlage ausdrucken, mit deinem
// Stift ausfüllen, einscannen → du bekommst eine Schriftdatei (.ttf) aus deiner Handschrift.
// Die lädst du in Stella hoch (Einstellungen → Handschrift). Ohne eigene Schrift nimmt Stella "Caveat".
// Jeder Buchstabe wird minimal gedreht/verschoben/skaliert, damit es nicht nach Computer aussieht.

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { config } from './config.ts';
import { getBrowser } from './browser.ts';

const require = createRequire(import.meta.url);
const fontDir = path.join(config.dataDir, 'fonts');

const FONT_TYPES: Record<string, string> = { ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2' };

export function userFontPath(userId: string): string | null {
  if (!existsSync(fontDir)) return null;
  const file = readdirSync(fontDir).find((f) => f.startsWith(`${userId}.`));
  return file ? path.join(fontDir, file) : null;
}

export function saveUserFont(userId: string, data: Buffer, ext: string) {
  if (!FONT_TYPES[ext]) throw new Error('Nur .ttf, .otf, .woff oder .woff2');
  mkdirSync(fontDir, { recursive: true });
  const old = userFontPath(userId);
  if (old) unlinkSync(old);
  writeFileSync(path.join(fontDir, `${userId}.${ext}`), data);
}

export function deleteUserFont(userId: string) {
  const old = userFontPath(userId);
  if (old) unlinkSync(old);
}

function fontFaces(userId: string): { css: string; family: string; size: number } {
  const own = userFontPath(userId);
  if (own) {
    const ext = path.extname(own).slice(1);
    const b64 = readFileSync(own).toString('base64');
    return { css: `@font-face{font-family:Hand;src:url(data:${FONT_TYPES[ext]};base64,${b64});}`, family: 'Hand', size: 30 };
  }
  const files = ['caveat-latin-400-normal.woff2', 'caveat-latin-ext-400-normal.woff2'];
  const css = files.map((f) => {
    const b64 = readFileSync(require.resolve(`@fontsource/caveat/files/${f}`)).toString('base64');
    return `@font-face{font-family:Hand;src:url(data:font/woff2;base64,${b64});}`;
  }).join('');
  return { css, family: 'Hand', size: 35 };
}

/** Kleiner, reproduzierbarer Zufall – gleicher Text sieht beim erneuten Rendern gleich aus. */
function rng(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function handChar(ch: string, rand: () => number): string {
  const rot = (rand() - 0.5) * 4;
  const dy = (rand() - 0.5) * 2.6;
  const sc = 0.95 + rand() * 0.1;
  const op = 0.86 + rand() * 0.14;
  return `<span style="transform:translateY(${dy.toFixed(1)}px) rotate(${rot.toFixed(1)}deg) scale(${sc.toFixed(2)});opacity:${op.toFixed(2)}">${esc(ch)}</span>`;
}

/** Eine Zeile mit __einfach__ und ==doppelt== unterstrichenen Stellen (gleiches Format wie FreeNotes). */
function handLine(line: string, rand: () => number): string {
  const segments: { text: string; underline: 0 | 1 | 2 }[] = [];
  let underline: 0 | 1 | 2 = 0;
  let buf = '';
  for (let i = 0; i < line.length; i++) {
    const pair = line.slice(i, i + 2);
    if ((pair === '==' && underline !== 1) || (pair === '__' && underline !== 2)) {
      if (buf) segments.push({ text: buf, underline });
      buf = '';
      underline = underline ? 0 : pair === '==' ? 2 : 1;
      i++;
      continue;
    }
    buf += line[i];
  }
  if (buf) segments.push({ text: buf, underline });

  return segments.map((seg) => {
    const words = seg.text.split(/(\s+)/).map((word) => (/^\s+$/.test(word) || !word
      ? word && ' '
      : `<span class="w">${[...word].map((ch) => handChar(ch, rand)).join('')}</span>`)).join('');
    if (!seg.underline) return words;
    const wobble = () => (3 + rand() * 4).toFixed(1);
    const path = (y: number) => `<path d="M1 ${y} Q 25 ${wobble()} 50 ${y} T 99 ${wobble()}" stroke="currentColor" stroke-width="1.6" fill="none" vector-effect="non-scaling-stroke"/>`;
    return `<span class="u">${words}<svg viewBox="0 0 100 ${seg.underline === 2 ? 14 : 10}" preserveAspectRatio="none" class="u${seg.underline}">` +
      `${path(6)}${seg.underline === 2 ? path(11) : ''}</svg></span>`;
  }).join('');
}

export async function renderHandwriting(userId: string, doc: { text: string; date?: string }): Promise<Buffer> {
  const rand = rng(JSON.stringify(doc));
  const font = fontFaces(userId);
  const LINE = 48;
  const [first = '', ...rest] = doc.text.split('\n');
  const body = rest.map((l) => (l.trim()
    ? `<p style="margin-left:${(rand() * 6).toFixed(0)}px">${handLine(l, rand)}</p>`
    : '<p>&nbsp;</p>')).join('\n');

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    ${font.css}
    body{margin:0;background:#fff}
    .paper{width:1100px;min-height:${LINE * 12}px;padding:${LINE * 2}px 70px ${LINE}px 120px;box-sizing:border-box;position:relative;
      background-color:#fdfcf7;
      background-image:linear-gradient(to right,transparent 98px,#e7a3a3 98px,#e7a3a3 100px,transparent 100px),
        repeating-linear-gradient(to bottom,transparent 0,transparent ${LINE - 1}px,#b8cfe8 ${LINE - 1}px,#b8cfe8 ${LINE}px);
      background-position:0 -${Math.round(LINE * 0.2)}px;
      font-family:${font.family},cursive;font-size:${font.size}px;line-height:${LINE}px;color:#1d3484}
    p{margin:0;min-height:${LINE}px}
    .w{white-space:nowrap;display:inline-block}
    .w span{display:inline-block}
    .top{display:flex;justify-content:space-between;align-items:baseline}
    .u{position:relative;display:inline-block}
    .u svg{position:absolute;left:-4px;width:calc(100% + 8px);bottom:2px;height:10px}
    .u svg.u2{height:14px;bottom:-2px}
  </style></head><body><div class="paper">
    <p class="top"><span>${handLine(first, rand)}</span>${doc.date ? `<span style="font-size:0.85em">${handLine(doc.date, rand)}</span>` : ''}</p>
    ${body}
  </div></body></html>`;

  const browser = await getBrowser();
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: 1.5 });
  try {
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    return await page.locator('.paper').screenshot({ type: 'png' });
  } finally {
    await page.close();
  }
}
