// Kopiert die Sprachkataloge aus shared/src/i18n/catalog/*.json als Swift-Quelltext in die iOS-App.
// So haben Web, Server und iOS EINE Quelle – und Swift Playgrounds braucht keine Ressourcen-Ordner.
//
//   npx tsx scripts/gen-i18n.ts          schreibt ios/Stella.swiftpm/Core/I18nCatalogs.swift
//   npx tsx scripts/gen-i18n.ts --check  beendet sich mit Fehler, wenn die Datei nicht aktuell ist (CI)

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dir = path.join(root, 'shared/src/i18n/catalog');
const target = path.join(root, 'ios/Stella.swiftpm/Core/I18nCatalogs.swift');

const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
const entries = files.map((f) => {
  const locale = f.replace(/\.json$/, '');
  // Wörterbuch neu serialisieren (stabile Reihenfolge, keine Leerzeichen-Unterschiede)
  const json = JSON.stringify(JSON.parse(readFileSync(path.join(dir, f), 'utf8')), null, 1);
  if (json.includes('"""#')) throw new Error(`${f} enthält die Zeichenfolge "\"\"#"`);
  return `        "${locale}": #"""\n${json}\n"""#,`;
});

const out = `// AUTOMATISCH ERZEUGT von scripts/gen-i18n.ts – nicht von Hand ändern.
// Quelle: shared/src/i18n/catalog/*.json (dieselben Texte wie Web und Server).

enum I18nCatalogs {
    static let json: [String: String] = [
${entries.join('\n')}
    ]
}
`;

if (process.argv.includes('--check')) {
  const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
  if (current !== out) {
    console.error('ios/Stella.swiftpm/Core/I18nCatalogs.swift ist nicht aktuell. Bitte `npx tsx scripts/gen-i18n.ts` ausführen und committen.');
    process.exit(1);
  }
  console.log('iOS-Sprachkataloge sind aktuell.');
} else {
  writeFileSync(target, out);
  console.log(`geschrieben: ${path.relative(root, target)} (${files.length} Sprachen)`);
}
