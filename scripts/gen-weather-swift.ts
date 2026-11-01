// Schreibt die Wetter-Werte der iOS-App (Himmelsfarben, Teilchenzahlen, Blitz-Grenzen) aus shared/src/weather.scene.ts,
// damit Web und iOS dieselben Zahlen nutzen.
//   npx tsx scripts/gen-weather-swift.ts          schreiben
//   npx tsx scripts/gen-weather-swift.ts --check  nur prüfen (CI)

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { SKY, WEATHER_TYPES, BASE_PARTICLES, MAX_FLASH, MIN_LIGHTNING_GAP_MS, READABLE } from '../shared/src/index.ts';

const file = new URL('../ios/Stella.swiftpm/Design/Weather/WeatherPalette.swift', import.meta.url);
const hex = (s: string) => `"${s.replace('#', '')}"`;
const sky = WEATHER_TYPES.map((t) => `        "${t}": (day: (${hex(SKY[t].day.top)}, ${hex(SKY[t].day.horizon)}), night: (${hex(SKY[t].night.top)}, ${hex(SKY[t].night.horizon)})),`).join('\n');
const particles = WEATHER_TYPES.map((t) => `        "${t}": ${BASE_PARTICLES[t] ?? 0},`).join('\n');
const out = `// ERZEUGT von scripts/gen-weather-swift.ts aus shared/src/weather.scene.ts – nicht von Hand ändern.

enum WeatherPalette {
    /// Himmelsverlauf (oben, Horizont) als Hex ohne "#", je Wettertyp für Tag und Nacht
    static let sky: [String: (day: (String, String), night: (String, String))] = [
${sky}
    ]

    /// Teilchen auf einem Handy (≈ 390×844)
    static let baseParticles: [String: Int] = [
${particles}
    ]

    /// Aufhellen beim Blitz: höchstens so viel Weiß darüber
    static let maxFlash: Double = ${MAX_FLASH}
    /// Mindestabstand zweier Blitze in Millisekunden
    static let minLightningGapMs: Double = ${MIN_LIGHTNING_GAP_MS}
    /// Helle Schrift auf dunklen Szenen (Nacht, Gewitter, Starkregen)
    static let darkHeadText = ${hex(READABLE.dark.headText)}
}
`;
if (process.argv.includes('--check')) {
  const cur = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (cur !== out) { console.error('WeatherPalette.swift ist nicht aktuell. Bitte `npx tsx scripts/gen-weather-swift.ts` ausführen und committen.'); process.exit(1); }
  console.log('Wetter-Palette der App ist aktuell.');
} else { writeFileSync(file, out); console.log('geschrieben: Design/Weather/WeatherPalette.swift'); }
