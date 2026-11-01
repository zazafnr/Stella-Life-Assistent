import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

// Heuristik: Im Web-Code (.tsx) steht kein fester deutscher Text mehr – er kommt aus den Sprachkatalogen.
// Dateien, die noch nicht umgestellt sind, stehen in OPEN. Die Liste darf nur kürzer werden: Ein umgestellter
// Bereich, der wieder deutschen Text bekommt, lässt den Test scheitern; ein Eintrag, der keinen deutschen Text
// mehr enthält, muss aus der Liste raus.

const WEB = path.resolve(import.meta.dirname, '../../../web/src');
const OPEN = new Set([
  'components/Onboarding.tsx', 'components/Inbox.tsx', 'components/Goals.tsx', 'components/Planner.tsx', 'components/Finance.tsx',
  'components/StellaPlan.tsx', 'components/PlacesCard.tsx', 'components/WeekPlanSheet.tsx', 'components/Lists.tsx', 'components/Rich.tsx',
  'components/ActionCard.tsx', 'components/BriefingCard.tsx', 'components/Health.tsx', 'components/Settings.tsx',
  'components/settings/Server.tsx', 'components/settings/Books.tsx', 'components/settings/Mail.tsx', 'components/settings/Assistant.tsx',
  'components/settings/Addresses.tsx', 'components/settings/Finance.tsx', 'components/settings/Untis.tsx', 'components/settings/Handwriting.tsx',
  
  
]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.tsx') ? [p] : [];
  });
}

/** Strings und JSX-Text ohne Kommentare, die deutsch aussehen (Umlaute oder häufige deutsche Wörter) */
function germanTexts(source: string): string[] {
  const noComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const literals = [...noComments.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`|>([^<>{}\n]+)</g)].map((m) => m[1] ?? m[2] ?? m[3] ?? m[4] ?? '');
  return literals.filter((s) => !/Lösung/.test(s) && (/[äöüÄÖÜß]/.test(s) || /\b(und|nicht|oder|dein|deine|deinen|Einstellungen|Speichern|Abbrechen|Schreib)\b/.test(s)));
}

test('kein fester deutscher Text im Web-Code – außer in den noch offenen Dateien', () => {
  for (const file of files(WEB)) {
    const rel = path.relative(WEB, file).replaceAll('\\', '/');
    const found = germanTexts(readFileSync(file, 'utf8'));
    if (OPEN.has(rel)) continue;
    assert.deepEqual(found, [], `${rel} enthält festen deutschen Text – bitte in den Katalog (t('…'))`);
  }
});

test('die offene Liste ist ehrlich: jede Datei darin hat wirklich noch deutschen Text', () => {
  for (const rel of OPEN) {
    let source = '';
    try { source = readFileSync(path.join(WEB, rel), 'utf8'); } catch { assert.fail(`${rel} gibt es nicht mehr – aus der Liste nehmen`); }
    assert.ok(germanTexts(source).length > 0, `${rel} ist umgestellt – bitte aus OPEN streichen`);
  }
});
