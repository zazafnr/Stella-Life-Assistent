// Bilder für die E-Mails: ruhiger Himmel mit Wolken und Stern im App-Stil, 1200×400 (Retina für 600 px), als PNG.
// Gmail zeigt keine SVG – deshalb PNG. Abgelegt unter web/public/mail/ (öffentlich: https://stella.evolsior.com/mail/…).
//
//   STELLA_CHROMIUM_PATH=/opt/pw-browsers/chromium npx tsx scripts/mail-art.ts

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const out = path.resolve(import.meta.dirname, '../web/public/mail');
mkdirSync(out, { recursive: true });

const STAR = 'M12 2c.6 4.8 3.2 7.4 8 8-4.8.6-7.4 3.2-8 8-.6-4.8-3.2-7.4-8-8 4.8-.6 7.4-3.2 8-8z';

interface Scene { name: string; top: string; bottom: string; star: { x: number; y: number; size: number }; clouds: { x: number; y: number; w: number; o: number }[]; glow: string }
const SCENES: Scene[] = [
  { name: 'verify-signup', top: '#8EC5FF', bottom: '#EAF4FF', star: { x: 930, y: 90, size: 130 }, glow: '#FFC2DA', clouds: [{ x: 120, y: 120, w: 360, o: 0.95 }, { x: 560, y: 210, w: 300, o: 0.8 }, { x: 860, y: 270, w: 380, o: 0.9 }, { x: 40, y: 290, w: 260, o: 0.7 }] },
  { name: 'verify-address', top: '#9CCBFF', bottom: '#F0F7FF', star: { x: 250, y: 100, size: 120 }, glow: '#B9DBFF', clouds: [{ x: 600, y: 90, w: 380, o: 0.95 }, { x: 80, y: 250, w: 340, o: 0.85 }, { x: 760, y: 270, w: 320, o: 0.8 }] },
  { name: 'login-link', top: '#6FB1FF', bottom: '#E4F0FF', star: { x: 1000, y: 70, size: 110 }, glow: '#FFD0E3', clouds: [{ x: 60, y: 90, w: 300, o: 0.9 }, { x: 420, y: 190, w: 400, o: 0.95 }, { x: 880, y: 250, w: 300, o: 0.85 }] },
  { name: 'welcome', top: '#7DBBFF', bottom: '#FFF1F7', star: { x: 590, y: 105, size: 160 }, glow: '#FFB3CF', clouds: [{ x: 60, y: 160, w: 380, o: 0.95 }, { x: 760, y: 150, w: 400, o: 0.95 }, { x: 380, y: 290, w: 420, o: 0.8 }] },
  { name: 'stella-reply', top: '#A8D2FF', bottom: '#F4F9FF', star: { x: 1020, y: 110, size: 100 }, glow: '#D6E9FF', clouds: [{ x: 140, y: 110, w: 340, o: 0.9 }, { x: 640, y: 230, w: 360, o: 0.85 }] },
  { name: 'unknown-sender', top: '#B2D6FF', bottom: '#F6FAFF', star: { x: 180, y: 120, size: 110 }, glow: '#FFD6E6', clouds: [{ x: 520, y: 100, w: 380, o: 0.9 }, { x: 900, y: 240, w: 300, o: 0.8 }, { x: 100, y: 280, w: 300, o: 0.7 }] },
  { name: 'subscription', top: '#86BFFF', bottom: '#EEF6FF', star: { x: 880, y: 100, size: 140 }, glow: '#FFC2DA', clouds: [{ x: 90, y: 130, w: 340, o: 0.95 }, { x: 560, y: 250, w: 340, o: 0.85 }, { x: 930, y: 260, w: 260, o: 0.8 }] },
];

const cloud = (c: Scene['clouds'][number]) => `<div style="position:absolute;left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.w * 0.3}px;opacity:${c.o};filter:blur(2px)">
  <i style="position:absolute;left:0;bottom:0;width:100%;height:55%;border-radius:999px;background:#fff"></i>
  <i style="position:absolute;left:14%;bottom:30%;width:42%;height:70%;border-radius:50%;background:#fff"></i>
  <i style="position:absolute;left:42%;bottom:30%;width:34%;height:55%;border-radius:50%;background:#fff"></i></div>`;

const scene = (s: Scene) => `<!doctype html><meta charset="utf-8"><body style="margin:0;width:1200px;height:400px;position:relative;overflow:hidden;background:linear-gradient(180deg,${s.top},${s.bottom})">
  <div style="position:absolute;left:${s.star.x - 170}px;top:${s.star.y - 150}px;width:420px;height:420px;border-radius:50%;background:${s.glow};opacity:.55;filter:blur(60px)"></div>
  ${s.clouds.map(cloud).join('')}
  <svg style="position:absolute;left:${s.star.x - s.star.size / 2}px;top:${s.star.y - s.star.size / 2}px" width="${s.star.size}" height="${s.star.size}" viewBox="0 0 24 24"><path d="${STAR}" fill="#FF7EB3"/></svg>
</body>`;

const star = (fill: string, bg: string) => `<!doctype html><meta charset="utf-8"><body style="margin:0;width:128px;height:128px;background:${bg}"><svg width="128" height="128" viewBox="0 0 24 24"><path d="${STAR}" fill="${fill}"/></svg></body>`;
const icon = (inner: string) => `<!doctype html><meta charset="utf-8"><body style="margin:0;width:128px;height:128px;background:transparent"><svg width="128" height="128" viewBox="0 0 24 24" fill="none" stroke="#1F6FEB" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="0" y="0" width="24" height="24" rx="6" fill="#E9F3FF" stroke="none"/><g transform="translate(4 4) scale(.67)">${inner}</g></svg></body>`;

const ICONS: Record<string, string> = {
  'icon-telegram': '<path d="M21 4 3 11l6 2 2 6 3-4 5 3z"/><path d="m9 13 7-5"/>',
  'icon-phone': '<rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M11 18h2"/>',
  'icon-briefing': '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  'icon-undo': '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-2"/>',
  'icon-check': '<path d="M5 12.5 9.5 17 19 7.5"/>',
};

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.STELLA_CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 1200, height: 400 }, deviceScaleFactor: 1 });
  for (const s of SCENES) {
    await page.setViewportSize({ width: 1200, height: 400 });
    await page.setContent(scene(s));
    await page.screenshot({ path: path.join(out, `${s.name}.png`), type: 'png' });
  }
  await page.setViewportSize({ width: 128, height: 128 });
  await page.setContent(star('#FFFFFF', 'transparent'));
  await page.screenshot({ path: path.join(out, 'star-white.png'), omitBackground: true });
  await page.setContent(star('#FF7EB3', 'transparent'));
  await page.screenshot({ path: path.join(out, 'star-pink.png'), omitBackground: true });
  for (const [name, inner] of Object.entries(ICONS)) {
    await page.setContent(icon(inner));
    await page.screenshot({ path: path.join(out, `${name}.png`), omitBackground: true });
  }
  await browser.close();
  console.log(`Mail-Bilder: ${SCENES.length} Szenen + ${Object.keys(ICONS).length + 2} Symbole → ${out}`);

}
void main();
