// Vorgezeichnete Bausteine (einmal pro Szene): weiche Wolken, Lichtstrahlen, Nebel-Schwaden. Pro Bild wird dann nur noch kopiert.

import { makeSimplex } from './noise.ts';

export type RGB = [number, number, number];
/** Höhe einer Wolke im Verhältnis zur Breite (Platz für die weichen Ränder, nichts wird abgeschnitten) */
export const CLOUD_ASPECT = 0.7;
export const rgba = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return [c, c.getContext('2d')!];
}

/**
 * Eine Wolke aus mehreren überlagerten, weichen Kreisen (kein Clipart): Oberseite hell, Unterseite etwas dunkler.
 * `light` / `shade` sind die Farben oben und unten.
 */
export function cloudSprite(rng: () => number, width: number, light: RGB, shade: RGB): HTMLCanvasElement {
  const h = width * CLOUD_ASPECT;
  const [c, ctx] = canvas(width, h);
  const base = h * 0.6;
  const blobs = 6 + Math.floor(rng() * 4);
  const puffs: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i < blobs; i++) {
    const u = (i + 0.5) / blobs;
    const hump = Math.sin(u * Math.PI);
    puffs.push({ x: width * (0.14 + u * 0.72), y: base - hump * h * (0.08 + rng() * 0.2), r: width * (0.085 + hump * 0.08 + rng() * 0.04) });
  }
  // Unterseite: etwas dunkler, flacher
  for (const p of puffs) {
    const g = ctx.createRadialGradient(p.x, p.y + p.r * 0.35, 0, p.x, p.y + p.r * 0.35, p.r);
    g.addColorStop(0, rgba(shade, 0.9));
    g.addColorStop(1, rgba(shade, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x, p.y + p.r * 0.35, p.r, 0, Math.PI * 2); ctx.fill();
  }
  // Oberseite: hell
  for (const p of puffs) {
    const g = ctx.createRadialGradient(p.x - p.r * 0.15, p.y - p.r * 0.25, 0, p.x, p.y, p.r);
    g.addColorStop(0, rgba(light, 0.96));
    g.addColorStop(0.6, rgba(light, 0.62));
    g.addColorStop(1, rgba(light, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
  }
  return c;
}

/** Lichtstrahlen der Sonne (God Rays): Keile mit weichem Auslauf, zum Drehen */
export function raysSprite(size: number, rng: () => number): HTMLCanvasElement {
  const [c, ctx] = canvas(size, size);
  const cx = size / 2, cy = size / 2;
  const n = 14;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng() * 0.2;
    const spread = 0.05 + rng() * 0.05;
    const g = ctx.createRadialGradient(cx, cy, size * 0.06, cx, cy, size * 0.5);
    g.addColorStop(0, 'rgba(255,248,225,0.30)');
    g.addColorStop(1, 'rgba(255,248,225,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a - spread) * size, cy + Math.sin(a - spread) * size);
    ctx.lineTo(cx + Math.cos(a + spread) * size, cy + Math.sin(a + spread) * size);
    ctx.closePath();
    ctx.fill();
  }
  return c;
}

/** Eine Nebel-Schwade aus Rauschen: weiche, ausgefranste Bänder, an den Rändern ausgeblendet */
export function fogSprite(rng: () => number, color: RGB, w = 192, h = 72): HTMLCanvasElement {
  const noise = makeSimplex(rng);
  const [c, ctx] = canvas(w, h);
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const vy = Math.sin((y / h) * Math.PI);
    for (let x = 0; x < w; x++) {
      const vx = Math.min(1, Math.sin((x / w) * Math.PI) * 2.2);
      let n = 0, amp = 1, freq = 1, norm = 0;
      for (let o = 0; o < 4; o++) { n += noise((x / 46) * freq, (y / 26) * freq) * amp; norm += amp; amp *= 0.5; freq *= 2; }
      const a = Math.max(0, Math.min(1, (n / norm) * 1.5 + 0.35)) * vy * vx;
      const i = (y * w + x) * 4;
      img.data[i] = color[0]; img.data[i + 1] = color[1]; img.data[i + 2] = color[2]; img.data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Weicher Punkt (Sonne, Mond, Glanzlicht) */
export function glowSprite(size: number, color: RGB): HTMLCanvasElement {
  const [c, ctx] = canvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, rgba(color, 1));
  g.addColorStop(0.25, rgba(color, 0.55));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}
