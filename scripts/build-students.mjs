// Baut die Studenten-Web-App aus editions/students/web (Repo Stella-for-Students, geholt mit scripts/fetch-edition.sh).
// Es nutzt die Abhängigkeiten dieses Repos (react, vite, @stella/shared): die App braucht keinen eigenen `npm install`.
// Fehlt das Plugin, ist das kein Fehler (die normale App läuft ohne); mit `--require` (z. B. Vercel) schon.
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const web = path.join(root, 'editions/students/web');
const required = process.argv.includes('--require');

if (!existsSync(path.join(web, 'vite.config.ts'))) {
  const msg = 'Stella for Students ist nicht geholt (editions/students/web fehlt) – scripts/fetch-edition.sh ausführen.';
  if (required) { console.error(msg); process.exit(1); }
  console.log(`${msg} Es wird nur die normale Web-App gebaut.`);
  process.exit(0);
}
const r = spawnSync('npx', ['vite', 'build', web], { cwd: root, stdio: 'inherit' });
process.exit(r.status ?? 1);
