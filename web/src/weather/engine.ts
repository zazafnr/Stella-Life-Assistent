// Die Wetter-Engine: ein <canvas> hinter dem Chat bzw. dem Ladebildschirm. Eigene kleine Engine, keine Bibliothek.
//  · requestAnimationFrame, Pause bei verborgenem Tab
//  · weiche Überblendung (2 s) zwischen Wetterlagen, nie ein Sprung
//  · Qualität passt sich an: bei Bildverlust automatisch weniger Teilchen
//  · „Bewegung reduzieren“ / „ruhig“: Standbild bzw. halbe Teilchenzahl, keine Blitze und kein Funkeln

import type { AnimMode, WeatherState } from '@stella/shared';
import { Scene, type SceneOpts } from './scene.ts';

export interface EngineStats { fps: number; quality: number; particles: number }

export class WeatherEngine {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private scene: Scene | null = null;
  private prev: Scene | null = null;
  private fade = 1;
  private raf = 0;
  private last = 0;
  private running = false;
  private quality = 1;
  private frames: number[] = [];
  private seed: number;
  private opts: SceneOpts = { calm: false, reduced: false, lowPower: false };
  private state: WeatherState | null = null;
  /** Zeit, die die Szene "vorgespult" ist (für Screenshots und Standbilder) */
  private clockOffset = 0;
  stats: EngineStats = { fps: 0, quality: 1, particles: 0 };

  constructor(private canvas: HTMLCanvasElement, opts: { seed?: number } = {}) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.seed = opts.seed ?? (Math.random() * 1e9) | 0;
    this.onVisibility = this.onVisibility.bind(this);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  /** Größe aus dem Element übernehmen (nach Layout-Änderungen aufrufen) */
  resize() {
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.w = w; this.h = h;
    this.scene?.resize(w, h, this.quality);
    this.prev?.resize(w, h, this.quality);
    if (!this.running) this.paint();
  }

  /** Neues Wetter: bei anderem Typ oder anderer Tageszeit weich überblenden, sonst nur Wind und Dämmerung nachziehen */
  set(state: WeatherState, mode: AnimMode, reduced: boolean) {
    const calm = mode === 'calm';
    const lowPower = (navigator as Navigator & { deviceMemory?: number }).deviceMemory !== undefined && ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 2;
    const opts: SceneOpts = { calm, reduced, lowPower };
    const optsChanged = opts.calm !== this.opts.calm || opts.reduced !== this.opts.reduced || opts.lowPower !== this.opts.lowPower;
    this.opts = opts;
    this.state = state;
    if (!this.scene || this.scene.type !== state.type || this.scene.day !== state.day || optsChanged) {
      const first = !this.scene;
      const next = new Scene(state, opts, this.seed + (this.prev ? 17 : 0));
      next.sun = { sunrise: state.sunrise, sunset: state.sunset };
      if (this.w) next.resize(this.w, this.h, this.quality);
      if (reduced) this.warm(next);
      this.prev = first || reduced ? null : this.scene;
      this.scene = next;
      this.fade = first || reduced ? 1 : 0;
    } else {
      this.scene.wind = state.wind;
      this.scene.sun = { sunrise: state.sunrise, sunset: state.sunset };
    }
    this.apply();
  }

  /** Standbild: die Szene ein paar Sekunden "einlaufen" lassen, damit Teilchen verteilt sind */
  private warm(s: Scene, seconds = 6) {
    for (let t = 0; t < seconds; t += 1 / 20) s.update(1 / 20, t * 1000);
  }

  /** Für die Abnahme: sofort einen Blitz (nur Gewitter) */
  strike() { this.scene?.strike(performance.now() + this.clockOffset); }

  /** Für Screenshots: Zeit vorspulen (Sekunden) und einmal zeichnen */
  advance(seconds: number) {
    const s = this.scene;
    if (!s) return;
    const base = performance.now();
    for (let t = 0; t < seconds; t += 1 / 30) { s.update(1 / 30, base + t * 1000); this.prev?.update(1 / 30, base + t * 1000); }
    this.clockOffset += seconds * 1000;
    this.paint();
  }

  private apply() {
    const animate = !this.opts.reduced;
    if (animate && !document.hidden) this.start(); else { this.stop(); this.paint(); }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  destroy() {
    this.stop();
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  private onVisibility() {
    if (document.hidden) this.stop(); else if (this.scene) this.apply();
  }

  private frame(ts: number) {
    if (!this.running) return;
    const dt = Math.min(0.1, (ts - this.last) / 1000);
    this.last = ts;
    this.measure(dt);
    const now = performance.now() + this.clockOffset;
    this.scene?.update(dt, now);
    this.prev?.update(dt, now);
    if (this.fade < 1) {
      this.fade = Math.min(1, this.fade + dt / 2);
      if (this.fade >= 1) this.prev = null;
    }
    this.paint();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  /** Bilder pro Sekunde mitzählen; ist es zu langsam, werden Teilchen weniger */
  private measure(dt: number) {
    this.frames.push(dt);
    if (this.frames.length < 60) return;
    const avg = this.frames.reduce((a, b) => a + b, 0) / this.frames.length;
    this.frames = [];
    this.stats = { fps: Math.round(1 / avg), quality: this.quality, particles: 0 };
    if (avg > 1 / 40 && this.quality > 0.35) {
      this.quality = Math.max(0.35, this.quality * 0.75);
      this.scene?.resize(this.w, this.h, this.quality);
    }
  }

  private paint() {
    if (!this.scene || !this.w) return;
    const { ctx, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const now = performance.now() + this.clockOffset;
    if (this.prev && this.fade < 1) {
      this.prev.draw(ctx, now);
      ctx.globalAlpha = this.fade;
      this.scene.draw(ctx, now);
      ctx.globalAlpha = 1;
    } else this.scene.draw(ctx, now);
  }
}
