// Kleines 2D-Simplex-Rauschen (für die Nebel-Schwaden) und ein Zufallsgenerator mit Startwert (für gleiche Bilder in Screenshots).

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GRAD = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]] as const;

export function makeSimplex(rng: () => number) {
  const perm = new Uint8Array(512);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [p[i], p[j]] = [p[j]!, p[i]!]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]!;
  const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
  return (x: number, y: number): number => {
    const s = (x + y) * F2;
    const i = Math.floor(x + s), j = Math.floor(y + s);
    const t = (i + j) * G2;
    const x0 = x - (i - t), y0 = y - (j - t);
    const [i1, j1] = x0 > y0 ? [1, 0] : [0, 1];
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    const corner = (cx: number, cy: number, gi: number) => {
      const t0 = 0.5 - cx * cx - cy * cy;
      if (t0 < 0) return 0;
      const g = GRAD[gi % 8]!;
      return t0 * t0 * t0 * t0 * (g[0] * cx + g[1] * cy);
    };
    return 70 * (corner(x0, y0, perm[ii + perm[jj]!]!) + corner(x1, y1, perm[ii + i1 + perm[jj + j1]!]!) + corner(x2, y2, perm[ii + 1 + perm[jj + 1]!]!));
  };
}
