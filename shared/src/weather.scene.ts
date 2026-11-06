// Regeln für die Wetter-Szenen (Web und iOS gleich): Himmelsfarben, Lesbarkeit, Blitze, Mondphase, Dämmerung, Teilchenzahlen.
// Gezeichnet wird in web-core/src/weather/ (Canvas) und ios/…/Design/Weather/ (SwiftUI Canvas); hier steht, was getestet werden kann.

import type { WeatherState, WeatherType } from './weather.ts';

// ---------- Himmel ----------

export interface SkyColors { top: string; horizon: string }

/** Himmelsverlauf je Wettertyp (oben → Horizont) für Tag und Nacht */
export const SKY: Record<WeatherType, { day: SkyColors; night: SkyColors }> = {
  clear: { day: { top: '#6DB3EE', horizon: '#EAF5FF' }, night: { top: '#060C24', horizon: '#1B2B55' } },
  partly: { day: { top: '#7DB6E8', horizon: '#E6F0F8' }, night: { top: '#0A1230', horizon: '#222F55' } },
  cloudy: { day: { top: '#A5B6C8', horizon: '#DDE3EA' }, night: { top: '#121A2E', horizon: '#2A3550' } },
  fog: { day: { top: '#C2CBD3', horizon: '#E8EBEE' }, night: { top: '#1B2233', horizon: '#3A4458' } },
  drizzle: { day: { top: '#94A6B9', horizon: '#C9D3DC' }, night: { top: '#101828', horizon: '#26324A' } },
  rain: { day: { top: '#8A9DB1', horizon: '#B7C4D0' }, night: { top: '#0E1626', horizon: '#243146' } },
  heavy_rain: { day: { top: '#3E4D60', horizon: '#55657A' }, night: { top: '#0A101C', horizon: '#1D283A' } },
  thunder: { day: { top: '#2F3A4C', horizon: '#4C5A6E' }, night: { top: '#080D18', horizon: '#1A2232' } },
  snow: { day: { top: '#B6C7DA', horizon: '#E4EBF3' }, night: { top: '#1A2540', horizon: '#3A4A6B' } },
  sleet: { day: { top: '#A6B4C2', horizon: '#D3DAE0' }, night: { top: '#141C30', horizon: '#2E3A54' } },
};

/** Dunkle Szenen bekommen helle Schrift und dunkle Blasen (Chat), helle das Gewohnte */
export type SceneMode = 'light' | 'dark';
export const sceneMode = (type: WeatherType, day: boolean): SceneMode => (!day || type === 'thunder' || type === 'heavy_rain' ? 'dark' : 'light');

export function skyFor(w: Pick<WeatherState, 'type' | 'day'>): SkyColors {
  return SKY[w.type][w.day ? 'day' : 'night'];
}

// ---------- Lesbarkeit ----------

export const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
export const luminance = (rgb: [number, number, number]) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
/** WCAG-Kontrastverhältnis (1–21) */
export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
/** Farbe `fg` mit Deckkraft `alpha` über `bg` */
export const mix = (fg: [number, number, number], bg: [number, number, number], alpha: number): [number, number, number] =>
  [0, 1, 2].map((i) => Math.round(fg[i]! * alpha + bg[i]! * (1 - alpha))) as [number, number, number];

/**
 * Farben im Chat je Szenen-Art. Die Werte stehen auch in web-core/src/core.css (`[data-scene='dark']`);
 * ein Test vergleicht beides und prüft den Kontrast (≥ 4,5:1) gegen jede Szene, auch beim stärksten Blitz.
 */
export const READABLE = {
  light: { headText: '#0F2A4A', assistantBg: '#FFFFFF', assistantText: '#0F2A4A', userBg: '#1F6FEB', userText: '#FFFFFF' },
  dark: { headText: '#F2F6FF', assistantBg: '#1B2740', assistantText: '#F2F6FF', userBg: '#1F6FEB', userText: '#FFFFFF' },
} as const;

// ---------- Blitze ----------

/** Aufhellen des Himmels beim Blitz: höchstens so viel Weiß darüber (Blasen bleiben lesbar) */
export const MAX_FLASH = 0.2;
/** Mindestabstand zwischen zwei Blitzen (WCAG 2.3.1: höchstens drei Lichtblitze pro Sekunde, wir bleiben weit darunter) */
export const MIN_LIGHTNING_GAP_MS = 5000;

/**
 * Verlauf eines Blitzes nach `t` Millisekunden: `bolt` (0–1) ist die Sichtbarkeit des gezeichneten Blitzes, `sky` (0–MAX_FLASH) das Aufhellen.
 * Hauptblitz 0–120 ms (sichtbar 80–150 ms plus Nachglühen), kleiner Nachblitz bei 190–260 ms.
 */
export function lightningEnvelope(t: number): { bolt: number; sky: number } {
  if (t < 0 || t > 600) return { bolt: 0, sky: 0 };
  const ramp = (x: number, a: number, b: number) => Math.min(1, Math.max(0, (x - a) / (b - a)));
  const main = ramp(t, 0, 25) * (1 - ramp(t, 90, 160));
  const after = 0.4 * ramp(t, 185, 205) * (1 - ramp(t, 230, 270));
  const sky = Math.max(main, after);
  const glow = 0.35 * (1 - ramp(t, 160, 600)) * ramp(t, 20, 60); // Nachglühen des Blitzes selbst
  return { bolt: Math.min(1, Math.max(main, after * 1.5, glow)), sky: sky * MAX_FLASH };
}

/** Wann kommt der nächste Blitz? Abstand 6–20 s, nie weniger als 5 s nach dem letzten. */
export class LightningGovernor {
  private lastAt = -Infinity;
  private nextAt: number;
  constructor(private rng: () => number, start = 0) { this.nextAt = start + this.gap(); }
  private gap() { return 6000 + this.rng() * 14000; }
  /** true, wenn jetzt ein Blitz beginnen soll */
  poll(nowMs: number): boolean {
    if (nowMs < this.nextAt || nowMs - this.lastAt < MIN_LIGHTNING_GAP_MS) return false;
    this.lastAt = nowMs;
    this.nextAt = nowMs + this.gap();
    return true;
  }
}

// ---------- Mond, Dämmerung ----------

/** Mondphase 0…1 (0 = Neumond, 0,5 = Vollmond) nach dem synodischen Monat, grob nach Datum */
export function moonPhase(ms: number): number {
  const SYNODIC = 29.530588853 * 86400_000;
  const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);
  return (((ms - NEW_MOON) % SYNODIC) + SYNODIC) % SYNODIC / SYNODIC;
}

/** Dämmerung 0…1: 1 genau bei Sonnenauf- bzw. -untergang, 0 ab 45 Minuten davor/danach. `dawn` = morgens. */
export function twilight(w: Pick<WeatherState, 'sunrise' | 'sunset'>, nowMs: number): { amount: number; dawn: boolean } {
  const WINDOW = 45 * 60_000;
  const near = (at?: number) => (at === undefined ? 0 : Math.max(0, 1 - Math.abs(nowMs - at) / WINDOW));
  const up = near(w.sunrise), down = near(w.sunset);
  return up >= down ? { amount: up, dawn: true } : { amount: down, dawn: false };
}

// ---------- Teilchen ----------

/** Zahl der Teilchen auf einem Handy (≈ 390×844) – größere Bildschirme bekommen mehr, höchstens das Doppelte */
export const BASE_PARTICLES: Partial<Record<WeatherType, number>> = { drizzle: 60, rain: 180, heavy_rain: 350, thunder: 350, snow: 130, sleet: 110 };

export function particleCount(type: WeatherType, width: number, height: number, quality = 1): number {
  const base = BASE_PARTICLES[type] ?? 0;
  const area = Math.min(2, Math.max(1, (width * height) / (390 * 844)));
  return Math.round(base * area * Math.min(1, Math.max(0.2, quality)));
}

export type AnimMode = 'on' | 'calm' | 'off';
export const ANIM_MODES: AnimMode[] = ['on', 'calm', 'off'];
export const isAnimMode = (v: unknown): v is AnimMode => v === 'on' || v === 'calm' || v === 'off';
