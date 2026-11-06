// Edition-Plugins laden. Reihenfolge:
//   STELLA_EDITION_STUDENTS=off      → kein Plugin: das normale Stella läuft ohne Schulfunktionen
//   STELLA_EDITION_STUDENTS=builtin  → immer das eingebaute Schul-Plugin (Tests)
//   STELLA_EDITION_STUDENTS=<Pfad>   → dieses Plugin (Ordner mit index.ts, oder die Datei selbst)
//   nicht gesetzt                    → editions/students/server-plugin, wenn es da ist, sonst das eingebaute Schul-Plugin
//                                      (bis Paket 3: die Module liegen noch in diesem Repo)
// Ein externes Plugin exportiert als default `(api: PluginApi) => EditionPlugin | null`; `null` heißt „noch nichts beizutragen“
// (Platzhalter), dann gilt das eingebaute Schul-Plugin.

import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { pluginApi } from '../plugin-api.ts';
import { hasEdition, registerEdition, type EditionPlugin } from './registry.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
export const DEFAULT_PLUGIN_DIR = path.join(REPO_ROOT, 'editions/students/server-plugin');

function entryOf(p: string): string | null {
  const abs = path.resolve(REPO_ROOT, p);
  if (!existsSync(abs)) return null;
  if (statSync(abs).isFile()) return abs;
  const index = path.join(abs, 'index.ts');
  return existsSync(index) ? index : null;
}

export interface LoadResult { loaded: string[]; source: 'none' | 'external' }

export async function loadEditions(setting: string | undefined = process.env.STELLA_EDITION_STUDENTS): Promise<LoadResult> {
  if (setting === 'off') return { loaded: [], source: 'none' };
  const entry = entryOf(setting || DEFAULT_PLUGIN_DIR);
  if (setting && !entry) throw new Error(`STELLA_EDITION_STUDENTS zeigt auf „${setting}“, dort gibt es kein Plugin (index.ts fehlt).`);
  if (entry) {
    const mod = await import(pathToFileURL(entry).href) as { default?: (api: typeof pluginApi) => EditionPlugin | null };
    if (typeof mod.default !== 'function') throw new Error(`Das Plugin ${entry} muss als default eine Funktion (api) => EditionPlugin exportieren.`);
    const plugin = mod.default(pluginApi);
    if (plugin) {
      if (!hasEdition(plugin.id)) registerEdition(plugin);
      return { loaded: [plugin.id], source: 'external' };
    }
  }
  return { loaded: [], source: 'none' };
}
