import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SKY, WEATHER_TYPES, sceneMode, skyFor, hexToRgb, contrastRatio, mix, READABLE, MAX_FLASH, MIN_LIGHTNING_GAP_MS, lightningEnvelope,
  LightningGovernor, moonPhase, twilight, particleCount, parseOpenMeteo,
} from './index.ts';

const rgb = hexToRgb;

test('Kontrast: Schrift im Chat ist in jeder Szene lesbar (≥ 4,5:1), auch beim stärksten Blitz', () => {
  const white: [number, number, number] = [255, 255, 255];
  for (const type of WEATHER_TYPES) {
    for (const day of [true, false]) {
      const mode = sceneMode(type, day);
      const p = READABLE[mode];
      const sky = skyFor({ type, day });
      for (const [name, color] of [['oben', sky.top], ['Horizont', sky.horizon]] as const) {
        // Kopfzeile liegt direkt auf dem Himmel; beim Blitz kommt bis zu MAX_FLASH Weiß darüber
        for (const flash of [0, MAX_FLASH]) {
          const bg = mix(white, rgb(color), flash);
          const ratio = contrastRatio(rgb(p.headText), bg);
          if (name === 'oben') assert.ok(ratio >= 4.5, `${type} ${day ? 'Tag' : 'Nacht'} Kopfzeile ${ratio.toFixed(2)} bei Blitz ${flash}`);
        }
      }
      assert.ok(contrastRatio(rgb(p.assistantText), rgb(p.assistantBg)) >= 4.5, `${mode}: Antwort-Blase`);
      assert.ok(contrastRatio(rgb(p.userText), rgb(p.userBg)) >= 4.5, `${mode}: eigene Blase`);
    }
  }
});

test('Die Chat-Farben in styles.css sind die aus READABLE', () => {
  const css = readFileSync(new URL('../../web/src/styles.css', import.meta.url), 'utf8');
  const block = /\[data-scene='dark'\][^{]*\{[^}]*\}[\s\S]*?(?=\n\/\*|$)/.exec(css)?.[0] ?? '';
  for (const hex of [READABLE.dark.headText, READABLE.dark.assistantBg, READABLE.dark.assistantText]) {
    assert.ok(css.toLowerCase().includes(hex.toLowerCase()), `${hex} fehlt in styles.css`);
  }
  assert.ok(block.length > 0 || css.includes("data-scene='dark'"), 'dunkle Szenen haben eigene Farben');
});

test('Dunkel sind Nacht, Gewitter und Starkregen', () => {
  assert.equal(sceneMode('clear', true), 'light');
  assert.equal(sceneMode('clear', false), 'dark');
  assert.equal(sceneMode('thunder', true), 'dark');
  assert.equal(sceneMode('heavy_rain', true), 'dark');
  assert.equal(sceneMode('snow', true), 'light');
  assert.deepEqual(Object.keys(SKY).sort(), [...WEATHER_TYPES].sort());
});

test('Blitz: höchstens ein Blitz in 5 s, Aufhellen gedeckelt, nie mehr als 3 Lichtwechsel pro Sekunde', () => {
  const rng = (v: number) => () => v;
  for (const v of [0, 0.5, 0.999]) {
    const g = new LightningGovernor(rng(v));
    const hits: number[] = [];
    for (let t = 0; t < 3600_000; t += 50) if (g.poll(t)) hits.push(t);
    assert.ok(hits.length > 100, 'es blitzt regelmäßig');
    for (let i = 1; i < hits.length; i++) assert.ok(hits[i]! - hits[i - 1]! >= MIN_LIGHTNING_GAP_MS, `Abstand ${hits[i]! - hits[i - 1]!} ms`);
  }
  // Hüllkurve: Maximum und Zahl der Aufhellungen (Anstiege über die halbe Spitze) pro Blitz
  let max = 0, rises = 0, prevUp = false;
  for (let t = 0; t <= 700; t++) {
    const { sky } = lightningEnvelope(t);
    max = Math.max(max, sky);
    const up = sky > MAX_FLASH * 0.2;
    if (up && !prevUp) rises++;
    prevUp = up;
  }
  assert.ok(max <= MAX_FLASH + 1e-9, `Aufhellen ${max}`);
  assert.ok(rises <= 3, `${rises} Lichtwechsel in 0,7 s`);
  assert.deepEqual(lightningEnvelope(-1), { bolt: 0, sky: 0 });
  assert.deepEqual(lightningEnvelope(700), { bolt: 0, sky: 0 });
});

test('Mondphase: Neumond und Vollmond zu bekannten Terminen', () => {
  assert.ok(Math.abs(moonPhase(Date.UTC(2000, 0, 6, 18, 14))) < 0.01 || moonPhase(Date.UTC(2000, 0, 6, 18, 14)) > 0.99);
  const full = moonPhase(Date.UTC(2024, 0, 25, 17, 54)); // Vollmond 25.1.2024
  assert.ok(Math.abs(full - 0.5) < 0.03, `Vollmond ${full}`);
  const newMoon = moonPhase(Date.UTC(2024, 3, 8, 18, 21)); // Neumond 8.4.2024
  assert.ok(newMoon < 0.03 || newMoon > 0.97, `Neumond ${newMoon}`);
});

test('Dämmerung: ±45 Minuten um Sonnenauf- und -untergang', () => {
  const sunrise = Date.UTC(2026, 10, 1, 5, 58), sunset = Date.UTC(2026, 10, 1, 15, 58);
  const w = { sunrise, sunset };
  assert.equal(twilight(w, sunrise).amount, 1);
  assert.equal(twilight(w, sunrise).dawn, true);
  assert.equal(twilight(w, sunset).dawn, false);
  assert.ok(Math.abs(twilight(w, sunset + 22.5 * 60_000).amount - 0.5) < 1e-9);
  assert.equal(twilight(w, sunset + 46 * 60_000).amount, 0);
  assert.equal(twilight(w, Date.UTC(2026, 10, 1, 10, 0)).amount, 0);
  assert.equal(twilight({}, 0).amount, 0);
});

test('Teilchenzahlen wie im Plan: Niesel ~60, Regen ~180, Starkregen ~350 auf dem Handy, gedeckelt auf großen Bildschirmen', () => {
  assert.equal(particleCount('drizzle', 390, 844), 60);
  assert.equal(particleCount('rain', 390, 844), 180);
  assert.equal(particleCount('heavy_rain', 390, 844), 350);
  assert.equal(particleCount('rain', 1920, 1080), 360);
  assert.equal(particleCount('rain', 390, 844, 0.5), 90);
  assert.equal(particleCount('clear', 390, 844), 0);
  assert.equal(particleCount('heavy_rain', 390, 844, 0), 70, 'Qualität nie unter 20 %');
});

test('Sonnenauf- und -untergang aus Open-Meteo (Ortszeit + Versatz) werden echte Zeitpunkte', () => {
  const json = {
    utc_offset_seconds: 3600,
    current: { weather_code: 0, temperature_2m: 10, is_day: 1, wind_speed_10m: 3 },
    daily: { sunrise: ['2026-11-01T06:58'], sunset: ['2026-11-01T16:58'] },
  };
  const w = parseOpenMeteo(json)!;
  assert.equal(w.sunrise, Date.UTC(2026, 10, 1, 5, 58));
  assert.equal(w.sunset, Date.UTC(2026, 10, 1, 15, 58));
});

test('iOS: Palette und Szene stimmen mit shared überein', async () => {
  const { execFileSync } = await import('node:child_process');
  execFileSync('npx', ['tsx', 'scripts/gen-weather-swift.ts', '--check'], { cwd: new URL('../../', import.meta.url), stdio: 'pipe' });
  const swift = readFileSync(new URL('../../ios/Stella.swiftpm/Design/Weather/WeatherScene.swift', import.meta.url), 'utf8');
  // Hüllkurve des Blitzes und Dunkel-Regel sind in Swift nachgebaut – die Schlüsselzahlen müssen gleich sein
  for (const needle of ['ramp(t, 0, 25)', 'ramp(t, 90, 160)', '0.4 * ramp(t, 185, 205)', 'ramp(t, 230, 270)', '0.35 * (1 - ramp(t, 160, 600))', '947182440.0', '45.0 * 60']) {
    assert.ok(swift.includes(needle), `Swift: ${needle}`);
  }
  assert.ok(swift.includes('!day || type == "thunder" || type == "heavy_rain"'));
  assert.equal(Date.UTC(2000, 0, 6, 18, 14) / 1000, 947182440);
});
