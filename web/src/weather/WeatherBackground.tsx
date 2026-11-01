import { useEffect, useRef } from 'react';
import { sceneMode, type SceneMode } from '@stella/shared';
import { useAnimMode, useWeather } from '../weather.ts';
import { WeatherEngine } from './engine.ts';

declare global { interface Window { __weather?: WeatherEngine } }

/** Der bewegte Himmel hinter dem Chat. Ohne Wetter oder bei „Aus“ zeichnet der Aufrufer den ruhigen Standardhimmel. */
export function WeatherBackground() {
  const ref = useRef<HTMLCanvasElement>(null);
  const engine = useRef<WeatherEngine | null>(null);
  const weather = useWeather();
  const mode = useAnimMode();

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const seedParam = new URLSearchParams(location.search).get('wxseed');
    const e = new WeatherEngine(canvas, seedParam ? { seed: Number(seedParam) } : {});
    engine.current = e;
    window.__weather = e; // für Abnahme-Screenshots (Playwright)
    e.resize();
    const ro = new ResizeObserver(() => e.resize());
    ro.observe(canvas);
    return () => { ro.disconnect(); e.destroy(); engine.current = null; if (window.__weather === e) delete window.__weather; };
  }, []);

  useEffect(() => {
    if (!weather || mode === 'off') return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    engine.current?.set(weather, mode, reduced);
  }, [weather, mode]);

  return <canvas ref={ref} className="weather-canvas" aria-hidden="true" />;
}

/** „light“ oder „dark“ für den Chat (Schrift- und Blasenfarben); ohne Wetter oder bei „Aus“ immer „light“ */
export function useSceneMode(): SceneMode {
  const w = useWeather();
  const mode = useAnimMode();
  return w && mode !== 'off' ? sceneMode(w.type, w.day) : 'light';
}
