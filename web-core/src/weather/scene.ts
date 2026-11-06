// Eine Wetter-Szene: Schichten von hinten nach vorn
// 1 Himmelsverlauf · 2 Sonne bzw. Mond und Sterne · 3 ferne Wolken · 4 nahe Wolken · 5 Niederschlag · 6 Glas (Tropfen) bzw. Schneerand · 7 Blitz-Licht
// Koordinaten in CSS-Pixeln; der Aufrufer (engine.ts) skaliert für devicePixelRatio.

import {
  LightningGovernor, MAX_FLASH, lightningEnvelope, moonPhase, particleCount, skyFor, twilight,
  type WeatherState, type WeatherType, type WindLevel,
} from '@stella/shared';
import { mulberry32 } from './noise.ts';
import { CLOUD_ASPECT, cloudSprite, fogSprite, glowSprite, raysSprite, type RGB } from './sprites.ts';

export interface SceneOpts {
  /** 'calm': ruhiger (halbe Teilchen, keine Blitze/Glas/Sternschnuppen); reduced = Standbild */
  calm: boolean;
  reduced: boolean;
  lowPower: boolean;
}

interface Cloud { sprite: HTMLCanvasElement; x: number; y: number; w: number; speed: number; alpha: number }
interface Splash { x: number; age: number; dots: [number, number][] }
interface GlassDrop { x: number; y: number; r: number; state: 'rest' | 'slide'; wait: number; vy: number; phase: number; trail: { x: number; y: number; age: number; jump?: boolean }[] }
interface Bolt { paths: { pts: [number, number][]; width: number }[]; at: number }

const WIND_TAN = [0, 0.12, 0.27, 0.45] as const;

/** Wolken-Farben (oben/unten) je Wetter */
function cloudColors(type: WeatherType, day: boolean): [RGB, RGB] {
  if (!day) return type === 'thunder' || type === 'heavy_rain' ? [[50, 58, 76], [26, 32, 46]] : [[78, 92, 120], [38, 48, 72]];
  switch (type) {
    case 'clear': case 'partly': return [[255, 255, 255], [205, 220, 238]];
    case 'cloudy': return [[228, 233, 239], [172, 184, 198]];
    case 'fog': return [[236, 240, 244], [200, 208, 216]];
    case 'drizzle': case 'rain': case 'sleet': return [[158, 170, 184], [108, 120, 136]];
    case 'heavy_rain': case 'thunder': return [[104, 116, 132], [60, 70, 86]];
    case 'snow': return [[242, 246, 250], [204, 214, 226]];
  }
}

/** Wolken je Ebene (fern/mittel/nah) */
const CLOUD_COUNT: Record<WeatherType, [number, number, number]> = {
  clear: [0, 0, 2], partly: [1, 2, 2], cloudy: [3, 4, 4], fog: [1, 1, 0], drizzle: [2, 3, 3], rain: [3, 4, 4],
  heavy_rain: [3, 5, 5], thunder: [4, 5, 5], snow: [3, 4, 3], sleet: [3, 4, 3],
};

const STAR_ALPHA: Partial<Record<WeatherType, number>> = { clear: 1, partly: 0.6, snow: 0.25 };
const MOON_ALPHA: Partial<Record<WeatherType, number>> = { clear: 1, partly: 0.9, cloudy: 0.45, fog: 0.3, snow: 0.5, drizzle: 0.25, sleet: 0.25 };

export class Scene {
  readonly type: WeatherType;
  readonly day: boolean;
  wind: WindLevel;
  private rng: () => number;
  private t = 0;
  private w = 0;
  private h = 0;
  private quality = 1;

  private sunGlow?: HTMLCanvasElement;
  private rays?: HTMLCanvasElement;
  private moonGlow?: HTMLCanvasElement;
  private clouds: Cloud[][] = [[], [], []];
  private fog: { sprite: HTMLCanvasElement; x: number; y: number; w: number; h: number; speed: number; alpha: number }[] = [];
  private stars: { x: number; y: number; r: number; base: number; f: number; p: number }[] = [];
  private shoot: { x: number; y: number; vx: number; vy: number; age: number } | null = null;
  private nextShoot: number;

  // Niederschlag
  private dropsX: Float32Array = new Float32Array(0);
  private dropsY: Float32Array = new Float32Array(0);
  private dropsZ: Uint8Array = new Uint8Array(0);
  private dropsV: Float32Array = new Float32Array(0);
  private splashes: Splash[] = [];
  private flakes: { x: number; y: number; z: number; phase: number; freq: number; amp: number; size: number; rot: number; vrot: number }[] = [];
  private veils: { x: number; speed: number; w: number; alpha: number }[] = [];
  private glass: GlassDrop[] = [];
  private snowRim = 0;

  // Blitz
  private governor: LightningGovernor;
  private bolt: Bolt | null = null;

  constructor(state: Pick<WeatherState, 'type' | 'day' | 'wind'>, private opts: SceneOpts, seed: number) {
    this.type = state.type;
    this.day = state.day;
    this.wind = state.wind;
    this.rng = mulberry32(seed);
    this.governor = new LightningGovernor(this.rng, performance.now());
    this.nextShoot = 45 + this.rng() * 120;
  }

  /** Größe oder Qualität hat sich geändert: Teilchen und Sprites neu aufbauen */
  resize(w: number, h: number, quality: number) {
    const sizeChanged = Math.abs(w - this.w) > 1 || Math.abs(h - this.h) > 1;
    this.w = w; this.h = h; this.quality = quality;
    if (sizeChanged || !this.sunGlow) this.build();
    else this.fillParticles();
  }

  private build() {
    const { w, h, rng } = this;
    const { type, day } = this;
    this.sunGlow = glowSprite(256, [255, 236, 190]);
    this.moonGlow = glowSprite(256, [200, 215, 255]);
    this.rays = type === 'clear' || type === 'partly' ? raysSprite(512, rng) : undefined;

    // Wolken
    const [light, shade] = cloudColors(type, day);
    const LAYERS = [
      { scale: 0.55, alpha: 0.5, speed: 3, y: [0.04, 0.2] }, { scale: 0.8, alpha: 0.72, speed: 7, y: [0.1, 0.34] }, { scale: 1.15, alpha: 0.92, speed: 13, y: [0.02, 0.3] },
    ];
    this.clouds = LAYERS.map((L, li) => Array.from({ length: CLOUD_COUNT[type][li]! }, (_, i) => {
      const width = Math.min(w * 0.9, 300) * L.scale * (type === 'clear' ? 0.7 : 1) * (0.85 + rng() * 0.4);
      return { sprite: cloudSprite(rng, width, light, shade), x: (i / Math.max(1, CLOUD_COUNT[type][li]!)) * (w + width) - width * 0.5 + rng() * 40, y: h * (L.y[0]! + rng() * (L.y[1]! - L.y[0]!)), w: width, speed: L.speed * (0.8 + rng() * 0.5), alpha: L.alpha };
    }));

    // Nebel
    this.fog = [];
    if (type === 'fog') {
      const col: RGB = day ? [238, 242, 246] : [120, 132, 156];
      [{ y: 0.18, sp: 8, a: 0.4 }, { y: 0.42, sp: 14, a: 0.34 }, { y: 0.66, sp: 22, a: 0.3 }].forEach((f, i) => {
        const width = w * 1.7;
        this.fog.push({ sprite: fogSprite(rng, col), x: -rng() * width, y: h * f.y - h * 0.18, w: width, h: h * 0.42, speed: f.sp * (i % 2 ? -1 : 1), alpha: f.a });
      });
    }

    // Sterne
    this.stars = Array.from({ length: Math.round(Math.min(220, (w * h) / 2600)) }, () => ({
      x: rng() * w, y: rng() * h * 0.72, r: 0.4 + rng() * 1.1, base: 0.35 + rng() * 0.65, f: 0.6 + rng() * 2.2, p: rng() * 6.28,
    }));

    // Schleier bei Starkregen
    this.veils = type === 'heavy_rain' || type === 'thunder' ? Array.from({ length: 3 }, () => ({ x: rng() * w, speed: 40 + rng() * 60, w: w * (0.5 + rng() * 0.5), alpha: 0.05 + rng() * 0.04 })) : [];

    this.fillParticles();
    this.fillGlass();
  }

  private fillParticles() {
    const { w, h, type, rng } = this;
    const q = this.quality * (this.opts.calm || this.opts.lowPower ? 0.5 : 1);
    const n = particleCount(type, w, h, q);
    if (type === 'snow' || type === 'sleet') {
      const flakeN = type === 'snow' ? n : Math.round(n * 0.3);
      this.flakes = Array.from({ length: flakeN }, () => {
        const z = rng() < 0.5 ? 0 : rng() < 0.65 ? 1 : 2;
        return { x: rng() * w, y: rng() * h, z, phase: rng() * 6.28, freq: 0.4 + rng() * 0.9, amp: 8 + rng() * 22, size: [1.6, 3, 6.5][z]! * (0.8 + rng() * 0.4), rot: rng() * 6.28, vrot: (rng() - 0.5) * 0.8 };
      });
    } else this.flakes = [];
    const dropN = type === 'snow' ? 0 : type === 'sleet' ? n - Math.round(n * 0.3) : n;
    this.dropsX = new Float32Array(dropN); this.dropsY = new Float32Array(dropN); this.dropsZ = new Uint8Array(dropN); this.dropsV = new Float32Array(dropN);
    for (let i = 0; i < dropN; i++) {
      this.dropsZ[i] = i % 3 === 0 ? 0 : i % 3 === 1 ? 1 : 2;
      this.dropsX[i] = rng() * (w * 1.3) - w * 0.15;
      this.dropsY[i] = rng() * h;
      this.dropsV[i] = 0.85 + rng() * 0.3;
    }
  }

  private fillGlass() {
    const { w, h, rng, type } = this;
    this.glass = [];
    if (this.opts.calm || this.opts.lowPower || this.opts.reduced) return;
    if (!['drizzle', 'rain', 'heavy_rain', 'thunder'].includes(type)) return;
    const count = type === 'drizzle' ? 5 : type === 'rain' ? 8 : 11;
    for (let i = 0; i < count; i++) this.glass.push(this.newGlass(rng() * h * 0.2, w));
  }

  private newGlass(y: number, w: number): GlassDrop {
    const r = 3 + this.rng() * 5.5;
    return { x: this.rng() * w, y, r, state: 'rest', wait: 2 + this.rng() * 9, vy: 0, phase: this.rng() * 6.28, trail: [] };
  }

  // ---------- Bewegung ----------

  update(dt: number, nowMs: number) {
    const { w, h, type } = this;
    if (!w) return;
    this.t += dt;
    const speed = this.opts.calm ? 0.65 : 1;

    for (const layer of this.clouds) for (const c of layer) {
      c.x += c.speed * dt * speed * (1 + this.wind * 0.18);
      if (c.x > w + 10) c.x = -c.w;
    }
    for (const f of this.fog) {
      f.x += f.speed * dt * speed;
      if (f.x > 0) f.x -= f.w; else if (f.x < -f.w) f.x += f.w;
    }

    // Regen
    const tan = WIND_TAN[this.wind];
    const hs = Math.max(0.6, h / 800);
    const SPEED = [620, 900, 1250];
    for (let i = 0; i < this.dropsX.length; i++) {
      const z = this.dropsZ[i]!;
      const vy = SPEED[z]! * hs * this.dropsV[i]! * (this.type === 'drizzle' ? 0.6 : this.type === 'sleet' ? 0.7 : 1) * speed;
      this.dropsY[i] = this.dropsY[i]! + vy * dt;
      this.dropsX[i] = this.dropsX[i]! + vy * tan * dt;
      if (this.dropsY[i]! > h) {
        if (z === 2 && this.splashes.length < 40 && this.rng() < 0.5) {
          this.splashes.push({ x: this.dropsX[i]!, age: 0, dots: [[-4, -3], [3.5, -4.5], [0.5, -6]] });
        }
        this.dropsY[i] = -20 - this.rng() * 40;
        this.dropsX[i] = this.rng() * (w * 1.3) - w * (0.15 + tan * 0.4);
      }
    }
    for (const s of this.splashes) s.age += dt;
    this.splashes = this.splashes.filter((s) => s.age < 0.28);
    for (const v of this.veils) { v.x += v.speed * dt * (1 + tan * 3); if (v.x > w * 1.4) v.x = -v.w; }

    // Schnee
    for (const f of this.flakes) {
      const fall = [26, 46, 74][f.z]! * hs * (this.type === 'sleet' ? 1.8 : 1) * speed;
      f.y += fall * dt;
      f.x += (this.wind * 11 + Math.sin(this.t * f.freq + f.phase) * f.amp * 0.5) * dt * speed;
      f.rot += f.vrot * dt;
      if (f.y > h + 8) { f.y = -8; f.x = this.rng() * w; }
      if (f.x > w + 20) f.x = -10; else if (f.x < -20) f.x = w + 10;
    }
    if (type === 'snow') this.snowRim = Math.min(1, this.snowRim + dt / 240); // über etwa vier Minuten

    // Glas
    for (const g of this.glass) {
      if (g.state === 'rest') {
        g.wait -= dt;
        if (this.rng() < dt * 0.15) g.r = Math.min(10, g.r + 0.35);
        if (g.wait <= 0) { g.state = 'slide'; g.vy = 8; }
      } else {
        g.vy = Math.min(120, g.vy + 70 * dt);
        g.y += g.vy * dt;
        g.x += Math.sin(this.t * 3 + g.phase) * 6 * dt;
        g.r = Math.max(2.4, g.r - 0.25 * dt);
        g.trail.push({ x: g.x, y: g.y, age: 0 });
        if (g.trail.length > 90) g.trail.shift();
        if (g.y > h * 0.34) { const fresh = this.newGlass(this.rng() * h * 0.18, w); Object.assign(g, fresh, { trail: g.trail }); g.trail.push({ x: g.x, y: g.y, age: 0, jump: true }); }
      }
      for (const p of g.trail) p.age += dt;
      g.trail = g.trail.filter((p) => p.age < 6);
    }

    // Sternschnuppe
    if (!this.opts.calm && !this.opts.reduced && !this.day && STAR_ALPHA[type] !== undefined) {
      if (this.shoot) {
        this.shoot.age += dt;
        this.shoot.x += this.shoot.vx * dt; this.shoot.y += this.shoot.vy * dt;
        if (this.shoot.age > 0.9) this.shoot = null;
      } else if (this.t > this.nextShoot) {
        const dir = this.rng() < 0.5 ? 1 : -1;
        this.shoot = { x: dir > 0 ? w * (0.05 + this.rng() * 0.3) : w * (0.95 - this.rng() * 0.3), y: h * (0.04 + this.rng() * 0.25), vx: dir * w * 0.7, vy: h * 0.18, age: 0 };
        this.nextShoot = this.t + 60 + this.rng() * 120;
      }
    }

    // Blitz
    if (type === 'thunder' && !this.opts.calm && !this.opts.reduced && !this.bolt && this.governor.poll(nowMs)) this.bolt = this.makeBolt(nowMs);
    if (this.bolt && nowMs - this.bolt.at > 700) this.bolt = null;
  }

  /** Für die Abnahme: sofort ein Blitz */
  strike(nowMs: number) { this.bolt = this.makeBolt(nowMs); }

  private makeBolt(at: number): Bolt {
    const { w, h, rng } = this;
    const paths: Bolt['paths'] = [];
    const jag = (x1: number, y1: number, x2: number, y2: number, disp: number, depth: number, out: [number, number][]) => {
      if (depth === 0) { out.push([x2, y2]); return; }
      const mx = (x1 + x2) / 2 + (rng() - 0.5) * disp, my = (y1 + y2) / 2 + (rng() - 0.5) * disp * 0.3;
      jag(x1, y1, mx, my, disp / 2, depth - 1, out);
      jag(mx, my, x2, y2, disp / 2, depth - 1, out);
    };
    const x0 = w * (0.2 + rng() * 0.6), y1 = h * (0.45 + rng() * 0.2), x1 = x0 + (rng() - 0.5) * w * 0.3;
    const main: [number, number][] = [[x0, 0]];
    jag(x0, 0, x1, y1, w * 0.22, 6, main);
    paths.push({ pts: main, width: 2.4 });
    for (let i = 0; i < 3; i++) {
      const from = main[Math.floor(main.length * (0.25 + rng() * 0.45))]!;
      const br: [number, number][] = [from];
      const dx = (rng() - 0.5) * w * 0.35, dy = h * (0.08 + rng() * 0.14);
      jag(from[0], from[1], from[0] + dx, from[1] + dy, w * 0.1, 4, br);
      paths.push({ pts: br, width: 1.3 });
    }
    return { paths, at };
  }

  // ---------- Zeichnen ----------

  draw(ctx: CanvasRenderingContext2D, nowMs: number) {
    const { w, h, type, day, t } = this;
    if (!w) return;
    const sky = skyFor({ type, day });
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, sky.top); g.addColorStop(1, sky.horizon);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

    // Dämmerung: warme Töne am Horizont
    const tw = this.currentTwilight(nowMs);
    if (tw > 0.02) {
      const tg = ctx.createLinearGradient(0, h * 0.35, 0, h);
      tg.addColorStop(0, 'rgba(255,150,120,0)');
      tg.addColorStop(0.55, `rgba(255,168,110,${0.34 * tw})`);
      tg.addColorStop(1, `rgba(245,130,170,${0.42 * tw})`);
      ctx.fillStyle = tg; ctx.fillRect(0, h * 0.35, w, h * 0.65);
    }

    this.drawCelestial(ctx, nowMs);
    this.drawClouds(ctx, 0);
    this.drawFog(ctx);
    this.drawClouds(ctx, 1);
    this.drawClouds(ctx, 2);
    this.drawPrecip(ctx);
    this.drawGlass(ctx);
    this.drawSnowRim(ctx);
    this.drawLightning(ctx, nowMs);
    void t;
  }

  private twCache = { at: -1, v: 0 };
  /** Wird von außen gesetzt: Sonnenauf-/untergang */
  sun: { sunrise?: number; sunset?: number } = {};
  private currentTwilight(nowMs: number) {
    if (Math.abs(nowMs - this.twCache.at) > 20_000) this.twCache = { at: nowMs, v: twilight(this.sun, Date.now()).amount };
    return this.twCache.v;
  }

  private drawCelestial(ctx: CanvasRenderingContext2D, nowMs: number) {
    const { w, h, type, day, t } = this;
    if (day) {
      if (type !== 'clear' && type !== 'partly') return;
      const x = w * 0.8, y = h * 0.13;
      const pulse = 1 + (this.opts.reduced ? 0 : Math.sin(t * 0.5) * 0.05);
      const size = Math.min(w, 520) * 0.85 * pulse;
      ctx.globalAlpha = type === 'partly' ? 0.8 : 1;
      ctx.drawImage(this.sunGlow!, x - size / 2, y - size / 2, size, size);
      if (this.rays) {
        const rs = Math.min(w, 700) * 1.5;
        ctx.save(); ctx.translate(x, y); ctx.rotate(this.opts.reduced ? 0.3 : t * 0.012); ctx.globalAlpha = 0.5;
        ctx.drawImage(this.rays, -rs / 2, -rs / 2, rs, rs);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(255,252,238,.95)';
      ctx.beginPath(); ctx.arc(x, y, 22, 0, Math.PI * 2); ctx.fill();
      return;
    }
    // Nacht: Sterne
    const sa = STAR_ALPHA[type];
    if (sa) {
      for (const s of this.stars) {
        const tw = this.opts.reduced || this.opts.calm ? 0.85 : 0.6 + 0.4 * Math.sin(t * s.f + s.p);
        ctx.fillStyle = `rgba(255,255,255,${s.base * tw * sa})`;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
      }
      if (this.shoot) {
        const k = this.shoot, a = Math.sin((k.age / 0.9) * Math.PI);
        const grad = ctx.createLinearGradient(k.x, k.y, k.x - k.vx * 0.12, k.y - k.vy * 0.12);
        grad.addColorStop(0, `rgba(255,255,255,${0.9 * a})`); grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = grad; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(k.x, k.y); ctx.lineTo(k.x - k.vx * 0.12, k.y - k.vy * 0.12); ctx.stroke();
      }
    }
    // Mond mit Phase
    const ma = MOON_ALPHA[type];
    if (ma) {
      const x = w * 0.78, y = h * 0.12, r = Math.min(30, w * 0.07);
      ctx.globalAlpha = ma;
      const gs = r * 7;
      ctx.drawImage(this.moonGlow!, x - gs / 2, y - gs / 2, gs, gs);
      const phase = moonPhase(Date.now());
      const waxing = phase < 0.5;
      const c = Math.cos(phase * 2 * Math.PI);
      ctx.fillStyle = 'rgba(25,34,60,.85)';
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgb(246,244,232)';
      ctx.beginPath();
      const dir = waxing ? 1 : -1;
      ctx.arc(x, y, r, -Math.PI / 2, Math.PI / 2, !waxing);        // äußerer Rand der hellen Seite
      for (let a = Math.PI / 2; a >= -Math.PI / 2 - 1e-6; a -= Math.PI / 24) ctx.lineTo(x + dir * r * c * Math.cos(a), y + r * Math.sin(a)); // Terminator
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
    }
    void nowMs;
  }

  private drawClouds(ctx: CanvasRenderingContext2D, layer: 0 | 1 | 2) {
    for (const c of this.clouds[layer]!) {
      ctx.globalAlpha = c.alpha;
      ctx.drawImage(c.sprite, c.x, c.y, c.w, c.w * CLOUD_ASPECT);
    }
    ctx.globalAlpha = 1;
  }

  private drawFog(ctx: CanvasRenderingContext2D) {
    for (const f of this.fog) {
      ctx.globalAlpha = f.alpha;
      for (let k = 0; k < 2; k++) ctx.drawImage(f.sprite, f.x + k * f.w, f.y, f.w, f.h);
      if (f.x + 2 * f.w < this.w) ctx.drawImage(f.sprite, f.x + 2 * f.w, f.y, f.w, f.h);
    }
    ctx.globalAlpha = 1;
  }

  private drawPrecip(ctx: CanvasRenderingContext2D) {
    const { w, h, type, day } = this;
    const tan = WIND_TAN[this.wind];
    const hs = Math.max(0.6, h / 800);
    const tint = type === 'sleet' ? '200,220,245' : day ? '235,243,252' : '190,205,235';
    // Schleier-Böen
    for (const v of this.veils) {
      const g = ctx.createLinearGradient(v.x, 0, v.x + v.w, 0);
      g.addColorStop(0, 'rgba(210,222,238,0)'); g.addColorStop(0.5, `rgba(210,222,238,${v.alpha})`); g.addColorStop(1, 'rgba(210,222,238,0)');
      ctx.fillStyle = g; ctx.fillRect(v.x, 0, v.w, h);
    }
    // Tropfen: eine Linienfolge je Tiefenebene
    if (this.dropsX.length) {
      const LEN = [10, 17, 28], ALPHA = [0.22, 0.38, 0.58], WIDTH = [0.8, 1.1, 1.6];
      ctx.lineCap = 'round';
      for (let z = 0; z < 3; z++) {
        ctx.strokeStyle = `rgba(${tint},${ALPHA[z]})`; ctx.lineWidth = WIDTH[z]!;
        ctx.beginPath();
        const len = LEN[z]! * hs * (type === 'drizzle' ? 0.7 : 1);
        for (let i = 0; i < this.dropsX.length; i++) {
          if (this.dropsZ[i] !== z) continue;
          const x = this.dropsX[i]!, y = this.dropsY[i]!;
          ctx.moveTo(x, y); ctx.lineTo(x - len * tan, y - len);
        }
        ctx.stroke();
      }
    }
    // Aufprall-Spritzer am unteren Rand
    for (const s of this.splashes) {
      const k = s.age / 0.28;
      ctx.fillStyle = `rgba(${tint},${0.55 * (1 - k)})`;
      for (const [dx, dy] of s.dots) { ctx.beginPath(); ctx.arc(s.x + dx * k * 2, h - 2 + dy * k * 1.6 + k * 4, 1.2 * (1 - k * 0.4), 0, Math.PI * 2); ctx.fill(); }
    }
    // Flocken
    if (this.flakes.length) {
      const soft = [0.5, 0.75, 0.95];
      for (let z = 0; z < 2; z++) {
        if (day) { // auf hellem Himmel: ganz zarter bläulicher Hof, damit die Flocken nicht verschwinden
          ctx.fillStyle = 'rgba(120,145,180,.16)'; ctx.beginPath();
          for (const f of this.flakes) if (f.z === z) { ctx.moveTo(f.x + f.size + 1.2, f.y); ctx.arc(f.x, f.y, f.size + 1.2, 0, Math.PI * 2); }
          ctx.fill();
        }
        ctx.fillStyle = `rgba(255,255,255,${soft[z]})`; ctx.beginPath();
        for (const f of this.flakes) if (f.z === z) { ctx.moveTo(f.x + f.size, f.y); ctx.arc(f.x, f.y, f.size, 0, Math.PI * 2); }
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = 1.1; ctx.lineCap = 'round'; ctx.beginPath();
      for (const f of this.flakes) {
        if (f.z !== 2) continue;
        for (let a = 0; a < 3; a++) {
          const ang = f.rot + (a * Math.PI) / 3;
          ctx.moveTo(f.x - Math.cos(ang) * f.size, f.y - Math.sin(ang) * f.size); ctx.lineTo(f.x + Math.cos(ang) * f.size, f.y + Math.sin(ang) * f.size);
        }
      }
      ctx.stroke();
    }
    void w;
  }

  private drawGlass(ctx: CanvasRenderingContext2D) {
    for (const g of this.glass) {
      // Spur: in fünf Stücken, jedes ein durchgehender Strich (älter = blasser), kein Verbinden über Sprünge
      if (g.trail.length > 1) {
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        const n = g.trail.length, chunk = Math.ceil(n / 5);
        for (let s0 = 0; s0 < n - 1; s0 += chunk) {
          const seg = g.trail.slice(s0, Math.min(n, s0 + chunk + 1));
          const age = seg.reduce((m, p) => Math.max(m, p.age), 0);
          ctx.strokeStyle = `rgba(255,255,255,${0.2 * Math.max(0, 1 - age / 6)})`;
          ctx.lineWidth = Math.max(1, g.r * 0.5);
          ctx.beginPath();
          seg.forEach((p, k) => (k === 0 || p.jump ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
          ctx.stroke();
        }
      }
      const rx = g.r * 0.82, ry = g.r * (g.state === 'slide' ? 1.15 : 1);
      // dunkler Rand (Lichtbrechung)
      ctx.fillStyle = 'rgba(20,34,56,.20)';
      ctx.beginPath(); ctx.ellipse(g.x, g.y + 0.6, rx + 0.7, ry + 0.7, 0, 0, Math.PI * 2); ctx.fill();
      // Körper mit leichtem Verlauf
      const grad = ctx.createRadialGradient(g.x - rx * 0.3, g.y - ry * 0.35, 0.5, g.x, g.y, ry);
      grad.addColorStop(0, 'rgba(255,255,255,.55)'); grad.addColorStop(0.6, 'rgba(210,225,245,.20)'); grad.addColorStop(1, 'rgba(90,120,160,.28)');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.ellipse(g.x, g.y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
      // Glanzpunkt
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      ctx.beginPath(); ctx.ellipse(g.x - rx * 0.32, g.y - ry * 0.4, rx * 0.22, ry * 0.16, -0.5, 0, Math.PI * 2); ctx.fill();
    }
  }

  private drawSnowRim(ctx: CanvasRenderingContext2D) {
    if (this.type !== 'snow') return;
    const { w, h } = this;
    const cap = 12 * this.snowRim + 2;
    const g = ctx.createLinearGradient(0, h - cap - 6, 0, h);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.35, 'rgba(255,255,255,.85)'); g.addColorStop(1, 'rgba(240,246,252,.95)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 12) ctx.lineTo(x, h - cap - Math.sin(x * 0.045 + 1.3) * 2 - Math.sin(x * 0.11) * 1.2);
    ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
  }

  private drawLightning(ctx: CanvasRenderingContext2D, nowMs: number) {
    if (!this.bolt) return;
    const { bolt, sky } = lightningEnvelope(nowMs - this.bolt.at);
    if (sky > 0) { ctx.fillStyle = `rgba(215,225,255,${Math.min(MAX_FLASH, sky)})`; ctx.fillRect(0, 0, this.w, this.h); }
    if (bolt <= 0.01) return;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const p of this.bolt.paths) {
      const trace = () => { ctx.beginPath(); p.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); };
      ctx.strokeStyle = `rgba(170,190,255,${0.16 * bolt})`; ctx.lineWidth = p.width * 7; trace();
      ctx.strokeStyle = `rgba(205,220,255,${0.4 * bolt})`; ctx.lineWidth = p.width * 2.6; trace();
      ctx.strokeStyle = `rgba(255,255,255,${0.95 * bolt})`; ctx.lineWidth = p.width * 0.9; trace();
    }
  }
}

