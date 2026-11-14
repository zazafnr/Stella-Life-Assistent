// Erzeugt die Beispielbilder für den PC-Demo-Modus (News-Karten und Wetterkarte auf „Heute“).
// Gezeichnete SVGs, damit die Demo offline bleibt. Neu erzeugen: node ios/PC/demo-bilder/erzeugen.mjs

import { writeFileSync } from 'node:fs';
import path from 'node:path';

const dir = import.meta.dirname;
const save = (name, w, h, body) =>
  writeFileSync(path.join(dir, name), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice">${body}</svg>\n`);

const grad = (id, a, b, vertical = true) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="${vertical ? 0 : 1}" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
const cloud = (x, y, s, fill, op = 1) =>
  `<g transform="translate(${x} ${y}) scale(${s})" fill="${fill}" opacity="${op}"><ellipse cx="0" cy="0" rx="60" ry="34"/><circle cx="-28" cy="-18" r="30"/><circle cx="16" cy="-30" r="38"/><circle cx="48" cy="-6" r="26"/></g>`;
const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();

// ---------- News (440 × 540, Hochformat wie die Karten) ----------

// Politik: Parlamentsgebäude im Abendlicht
save('news-politik.svg', 440, 540, `<defs>${grad('s', '#F6B26B', '#7A4E8C')}${grad('b', '#E9DCC8', '#BFAF98')}</defs>
<rect width="440" height="540" fill="url(#s)"/>
<circle cx="330" cy="150" r="60" fill="#FFE2A8" opacity=".7"/>
<g fill="url(#b)">
  <rect x="60" y="300" width="320" height="170"/>
  <polygon points="50,300 220,200 390,300"/>
  <rect x="190" y="140" width="60" height="70"/>
  <ellipse cx="220" cy="140" rx="48" ry="40"/>
</g>
<rect x="215" y="70" width="10" height="40" fill="#BFAF98"/>
<polygon points="225,70 265,80 225,90" fill="#D9534F"/>
${[0, 1, 2, 3, 4, 5, 6].map((i) => `<rect x="${82 + i * 42}" y="315" width="16" height="150" fill="#A89880"/>`).join('')}
<rect x="40" y="465" width="360" height="20" fill="#9C8D78"/>
<rect x="0" y="485" width="440" height="55" fill="#3C3346"/>`);

// Tech: Platine mit Chip
save('news-tech.svg', 440, 540, `<defs>${grad('s', '#0E1B3D', '#1F5FAF')}<radialGradient id="g" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#7FE3FF" stop-opacity=".9"/><stop offset="1" stop-color="#7FE3FF" stop-opacity="0"/></radialGradient></defs>
<rect width="440" height="540" fill="url(#s)"/>
${Array.from({ length: 22 }, (_, i) => {
  const y = 30 + i * 23, x = 20 + rnd() * 120;
  return `<path d="M0 ${y} H${x} l20 20 H${220 + rnd() * 200}" stroke="#4FC3F7" stroke-opacity="${0.25 + rnd() * 0.4}" stroke-width="3" fill="none"/><circle cx="${x + 20}" cy="${y + 20}" r="4" fill="#7FE3FF"/>`;
}).join('')}
<circle cx="220" cy="250" r="150" fill="url(#g)"/>
<rect x="140" y="170" width="160" height="160" rx="18" fill="#101826" stroke="#7FE3FF" stroke-width="4"/>
<rect x="172" y="202" width="96" height="96" rx="10" fill="#1E2C44"/>
<text x="220" y="262" text-anchor="middle" font-family="Segoe UI, Arial" font-weight="800" font-size="30" fill="#7FE3FF">AI</text>
${[0, 1, 2, 3, 4].map((i) => `<rect x="${158 + i * 28}" y="150" width="8" height="20" fill="#C9D6E8"/><rect x="${158 + i * 28}" y="330" width="8" height="20" fill="#C9D6E8"/><rect x="120" y="${188 + i * 28}" width="20" height="8" fill="#C9D6E8"/><rect x="300" y="${188 + i * 28}" width="20" height="8" fill="#C9D6E8"/>`).join('')}`);

// Wissenschaft: Rakete / Weltall
save('news-wissenschaft.svg', 440, 540, `<defs>${grad('s', '#05081C', '#2B1E5C')}${grad('p', '#6FB7FF', '#2563C7')}</defs>
<rect width="440" height="540" fill="url(#s)"/>
${Array.from({ length: 70 }, () => `<circle cx="${rnd() * 440}" cy="${rnd() * 540}" r="${0.6 + rnd() * 1.8}" fill="#fff" opacity="${0.4 + rnd() * 0.6}"/>`).join('')}
<circle cx="340" cy="470" r="210" fill="url(#p)"/>
<path d="M170 470 Q270 400 400 430" stroke="#9FD3FF" stroke-width="10" fill="none" opacity=".5"/>
<ellipse cx="90" cy="110" rx="40" ry="40" fill="#E6D8B8"/><circle cx="78" cy="98" r="8" fill="#CDBE9E"/><circle cx="104" cy="122" r="6" fill="#CDBE9E"/>
<g transform="translate(210 250) rotate(35)">
  <path d="M0 -110 C30 -80 32 -20 28 40 H-28 C-32 -20 -30 -80 0 -110Z" fill="#F2F4F8"/>
  <circle cx="0" cy="-40" r="14" fill="#4B8FE0" stroke="#C9D2E0" stroke-width="5"/>
  <path d="M-28 10 L-55 60 L-28 45Z M28 10 L55 60 L28 45Z" fill="#E0524E"/>
  <path d="M-18 40 Q0 120 18 40Z" fill="#FFB547"/><path d="M-9 40 Q0 90 9 40Z" fill="#FFF0B3"/>
</g>`);

// Sport: Fußballstadion bei Flutlicht
save('news-sport.svg', 440, 540, `<defs>${grad('s', '#0B1736', '#24467A')}${grad('r', '#3FAF5A', '#1E7A3A')}<radialGradient id="l" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#FFFBE0"/><stop offset="1" stop-color="#FFFBE0" stop-opacity="0"/></radialGradient></defs>
<rect width="440" height="540" fill="url(#s)"/>
<circle cx="70" cy="90" r="70" fill="url(#l)"/><circle cx="370" cy="90" r="70" fill="url(#l)"/>
<rect x="66" y="90" width="8" height="160" fill="#556"/><rect x="366" y="90" width="8" height="160" fill="#556"/>
<path d="M0 250 Q220 190 440 250 V330 H0Z" fill="#2A3550"/>
${Array.from({ length: 160 }, () => `<circle cx="${rnd() * 440}" cy="${225 + rnd() * 95}" r="3" fill="${['#E0524E', '#FFFFFF', '#FFCC4D', '#4B8FE0'][Math.floor(rnd() * 4)]}" opacity=".7"/>`).join('')}
<path d="M0 330 H440 V540 H0Z" fill="url(#r)"/>
${[0, 1, 2, 3].map((i) => `<path d="M0 ${360 + i * 50} H440" stroke="#2F9A4E" stroke-width="25" opacity=".35"/>`).join('')}
<ellipse cx="220" cy="430" rx="110" ry="40" fill="none" stroke="#fff" stroke-width="4" opacity=".85"/>
<path d="M0 395 H440" stroke="#fff" stroke-width="4" opacity=".85"/>
<g transform="translate(300 470)"><circle r="26" fill="#fff"/><polygon points="0,-12 11,-4 7,10 -7,10 -11,-4" fill="#222"/></g>`);

// Klima: Windräder über grünen Hügeln
save('news-klima.svg', 440, 540, `<defs>${grad('s', '#8FD3FF', '#E8F7FF')}</defs>
<rect width="440" height="540" fill="url(#s)"/>
<circle cx="90" cy="100" r="44" fill="#FFE07A"/>
${cloud(320, 110, 0.8, '#fff', 0.9)}
<path d="M0 380 Q120 300 240 360 T440 330 V540 H0Z" fill="#7CCB7C"/>
<path d="M0 440 Q160 380 300 440 T440 420 V540 H0Z" fill="#4FA65A"/>
${[[150, 230, 1], [290, 260, 0.8], [380, 300, 0.6]].map(([x, y, s]) => `<g transform="translate(${x} ${y}) scale(${s})"><rect x="-4" y="0" width="8" height="160" fill="#F4F6F8"/>${[0, 120, 240].map((a) => `<path d="M0 0 L-6 -90 Q0 -100 6 -90Z" fill="#fff" stroke="#C9D2DC" transform="rotate(${a + 15})"/>`).join('')}<circle r="8" fill="#DDE3EA"/></g>`).join('')}`);

// ---------- Wetter (800 × 420, Querformat für die große Karte) ----------

const W = 800, H = 420;
const SKY = {
  day: { clear: ['#3E8FE8', '#9FD0FF'], partly: ['#4E97E0', '#B4D8F5'], cloudy: ['#7F93AA', '#C3CED9'], fog: ['#9AA8B6', '#D5DCE2'], rain: ['#4F647C', '#8499AF'], thunder: ['#232B3A', '#4C5A6E'], snow: ['#7C93B5', '#D6E2F0'] },
  night: { clear: ['#060B24', '#24356B'], partly: ['#0A1230', '#2A3A6B'], cloudy: ['#1A2233', '#3A4658'], fog: ['#2A3240', '#4A5462'], rain: ['#141B2A', '#2F3B50'], thunder: ['#0A0E18', '#252E40'], snow: ['#1C2846', '#4A5C80'] },
};
const hills = (night) => `<path d="M0 340 Q200 290 400 330 T800 310 V420 H0Z" fill="${night ? '#1B2A3A' : '#5DAA6A'}" opacity=".9"/><path d="M0 380 Q260 340 520 380 T800 370 V420 H0Z" fill="${night ? '#121E2B' : '#3F8A50'}"/>`;
const stars = () => Array.from({ length: 60 }, () => `<circle cx="${rnd() * W}" cy="${rnd() * 260}" r="${0.6 + rnd() * 1.6}" fill="#fff" opacity="${0.4 + rnd() * 0.6}"/>`).join('');
const sun = (x, y) => `<circle cx="${x}" cy="${y}" r="110" fill="#FFE9A0" opacity=".35"/><circle cx="${x}" cy="${y}" r="62" fill="#FFD54A"/>`;
const moon = (x, y) => `<circle cx="${x}" cy="${y}" r="90" fill="#FFF6D8" opacity=".12"/><circle cx="${x}" cy="${y}" r="46" fill="#F5EBC8"/><circle cx="${x + 20}" cy="${y - 12}" r="40" fill="#0D1636"/>`;
const drops = (n, heavy) => Array.from({ length: n }, () => { const x = rnd() * W, y = 120 + rnd() * 280; return `<path d="M${x} ${y} l-${heavy ? 10 : 6} ${heavy ? 30 : 18}" stroke="#CFE3FF" stroke-width="${heavy ? 3 : 2}" stroke-linecap="round" opacity=".7"/>`; }).join('');
const flakes = (n) => Array.from({ length: n }, () => `<circle cx="${rnd() * W}" cy="${100 + rnd() * 300}" r="${2 + rnd() * 4}" fill="#fff" opacity="${0.6 + rnd() * 0.4}"/>`).join('');

const scenes = {
  clear: (n) => (n ? stars() + moon(620, 120) : sun(620, 120)),
  partly: (n) => (n ? stars() + moon(600, 110) : sun(600, 110)) + cloud(500, 190, 1.6, n ? '#3A4A70' : '#FFFFFF', 0.95) + cloud(210, 130, 1, n ? '#2E3C5E' : '#F2F7FF', 0.8),
  cloudy: (n) => cloud(200, 140, 1.8, n ? '#3A4658' : '#E6ECF2') + cloud(560, 120, 2.1, n ? '#465468' : '#F4F7FA') + cloud(400, 220, 1.6, n ? '#2E3A4C' : '#D3DCE6'),
  fog: (n) => cloud(560, 140, 1.8, n ? '#465468' : '#EEF2F5', 0.7) + [0, 1, 2, 3, 4].map((i) => `<rect x="${-40 + (i % 2) * 80}" y="${170 + i * 42}" width="760" height="22" rx="11" fill="${n ? '#8A96A6' : '#FFFFFF'}" opacity=".45"/>`).join(''),
  rain: (n) => cloud(240, 120, 2, n ? '#3A4658' : '#C9D3DE') + cloud(560, 100, 2.2, n ? '#465468' : '#D7DEE6') + drops(90, false),
  thunder: (n) => cloud(240, 110, 2.2, '#3B4352') + cloud(560, 100, 2.4, '#4A5262') + drops(120, true) + `<path d="M470 170 L420 280 H460 L420 380 L540 240 H495 L530 170Z" fill="#FFE066"/>`,
  snow: (n) => cloud(250, 110, 2, n ? '#56688A' : '#F2F5FA') + cloud(570, 100, 2.1, n ? '#61759A' : '#FFFFFF') + flakes(110),
};
// Hügel: bei Schnee weiß
for (const night of [false, true]) {
  for (const [type, draw] of Object.entries(scenes)) {
    const [a, b] = SKY[night ? 'night' : 'day'][type];
    const ground = type === 'snow' ? `<path d="M0 340 Q200 300 400 330 T800 315 V420 H0Z" fill="${night ? '#8FA3C4' : '#F4F8FF'}"/>` : hills(night);
    save(`wetter-${type}-${night ? 'nacht' : 'tag'}.svg`, W, H, `<defs>${grad('s', a, b)}</defs><rect width="${W}" height="${H}" fill="url(#s)"/>${draw(night)}${ground}`);
  }
}
console.log('Beispielbilder erzeugt in', dir);
