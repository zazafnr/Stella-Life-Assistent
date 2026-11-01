// Schreibt die Himmelsverläufe des Ladebildschirms (web/index.html, zwischen "wx:start" und "wx:end") aus shared/src/weather.scene.ts.
//   npx tsx scripts/gen-boot-weather.ts          schreiben
//   npx tsx scripts/gen-boot-weather.ts --check  nur prüfen (CI)

import { readFileSync, writeFileSync } from 'node:fs';
import { SKY, WEATHER_TYPES, READABLE, sceneMode } from '../shared/src/index.ts';

const file = new URL('../web/index.html', import.meta.url);
const html = readFileSync(file, 'utf8');
const lines: string[] = [];
for (const type of WEATHER_TYPES) {
  for (const day of [true, false]) {
    const c = SKY[type][day ? 'day' : 'night'];
    const dark = sceneMode(type, day) === 'dark';
    lines.push(`      #boot[data-wx=${type}][data-day='${day ? 1 : 0}'] { background: linear-gradient(180deg, ${c.top} 0%, ${c.horizon} 100%);${dark ? ` color: ${READABLE.dark.headText};` : ''} }`);
  }
}
const block = `      /* wx:start – erzeugt von scripts/gen-boot-weather.ts, nicht von Hand ändern */\n${lines.join('\n')}\n      /* wx:end */`;
const next = html.replace(/ {6}\/\* wx:start[\s\S]*?\/\* wx:end \*\//, block);
if (process.argv.includes('--check')) {
  if (next !== html) { console.error('web/index.html ist nicht aktuell. Bitte `npx tsx scripts/gen-boot-weather.ts` ausführen und committen.'); process.exit(1); }
  console.log('Ladebildschirm-Himmel sind aktuell.');
} else {
  writeFileSync(file, next);
  console.log('geschrieben: web/index.html (20 Himmel)');
}
