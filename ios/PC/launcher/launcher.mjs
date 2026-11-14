// Stella-Launcher: wählt, ob Stella oder Stella for Students im PC-Simulator läuft, und holt auf Knopfdruck
// (oder automatisch beim Start) den neuesten Stand von GitHub (main), baut ihn und startet ihn.
//
//   node ios/PC/launcher/launcher.mjs          (macht „Stella starten.bat“)
//
// Woher der Code kommt:
//   · „Neueste Version (GitHub)“: eigene Kopien der Repos in <Stella-Ordner>/.simulator/ – werden auf origin/main
//     gesetzt. Deine Arbeitsordner (Branches, ungespeicherte Änderungen) bleiben dabei unberührt.
//   · „Meine Ordner“: genau so, wie es in Stella-Life-Assistent / Stella-for-Students gerade liegt.
// Verbesserungen aus dem Panel landen immer in <Stella-Ordner>/Verbesserungen/<App>.
// Nur 127.0.0.1, nur mit dem zufälligen Schlüssel aus der Adresse.

import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const HERE = import.meta.dirname;
const LOCAL_LIFE = path.resolve(HERE, '..', '..', '..');
const TOP = path.resolve(LOCAL_LIFE, '..');
const SIM = process.env.STELLA_SIM_DIR || path.join(TOP, '.simulator');
const TOKEN = randomBytes(16).toString('hex');
mkdirSync(SIM, { recursive: true });

const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 30_000 });
const remoteOf = (dir, fallback) => (existsSync(dir) && git(dir, 'remote', 'get-url', 'origin').stdout.trim()) || fallback;
const REPOS = {
  life: { name: 'Stella-Life-Assistent', url: remoteOf(LOCAL_LIFE, 'https://github.com/zazafnr/Stella-Life-Assistent.git') },
  students: { name: 'Stella-for-Students', url: remoteOf(path.join(TOP, 'Stella-for-Students'), 'https://github.com/zazafnr/Stella-for-Students.git') },
};
const APPS = {
  stella: { title: 'Stella', repos: ['life'], dataName: 'Stella' },
  students: { title: 'Stella for Students', repos: ['life', 'students'], dataName: 'StellaStudents' },
};
const dirOf = (repo, source) => (source === 'local' ? path.join(TOP, REPOS[repo].name) : path.join(SIM, REPOS[repo].name));

// ---------- Einstellungen ----------

const SETTINGS_FILE = path.join(SIM, 'launcher.json');
// built: welcher GitHub-Stand je App zuletzt erfolgreich gebaut wurde – ist er unverändert, wird nicht neu gebaut
let settings = { app: 'stella', source: 'github', demo: true, autoUpdate: true, built: {} };
try { settings = { ...settings, ...JSON.parse(readFileSync(SETTINGS_FILE, 'utf8')) }; } catch { /* erster Start */ }
const saveSettings = () => writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));

// ---------- Protokoll (an das Fenster gestreamt) ----------

const log = [];
const clients = new Set();
function emit(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}
function say(line, kind = 'out') {
  // Farbcodes aus dem Swift-Build weg
  for (const l of String(line).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '').split('\n')) {
    if (!l.trim()) continue;
    const entry = { t: Date.now(), kind, text: l };
    log.push(entry);
    if (log.length > 600) log.shift();
    emit('log', entry);
  }
}

// ---------- Zustand ----------

let phase = 'idle'; // idle | updating | building | running | stopping | error
let running = null; // { app, child }
let versions = {};
const setPhase = (p, extra = {}) => { phase = p; emit('state', snapshot(extra)); };
const snapshot = (extra = {}) => ({ settings, phase, running: running?.app ?? null, versions, sim: SIM, ...extra });

function run(cmd, args, cwd, label) {
  return new Promise((resolve, reject) => {
    say(`$ ${label ?? [cmd, ...args].join(' ')}`, 'cmd');
    const child = spawn(cmd, args, { cwd, windowsHide: true, shell: false, env: process.env });
    child.stdout.on('data', (d) => say(d));
    child.stderr.on('data', (d) => say(d));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${label ?? cmd} beendet mit Code ${code}`))));
  });
}
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const runNpm = (args, cwd) => (process.platform === 'win32' ? run('cmd.exe', ['/d', '/s', '/c', `${npm} ${args.join(' ')}`], cwd, `npm ${args.join(' ')}`) : run(npm, args, cwd));

// ---------- Versionen ----------

function versionOf(dir) {
  if (!existsSync(path.join(dir, '.git'))) return null;
  const head = git(dir, 'log', '-1', '--format=%h|%cI|%s').stdout.trim().split('|');
  const branch = git(dir, 'rev-parse', '--abbrev-ref', 'HEAD').stdout.trim();
  const behind = Number(git(dir, 'rev-list', '--count', 'HEAD..origin/main').stdout.trim() || 0);
  const dirty = git(dir, 'status', '--porcelain', '--untracked-files=no').stdout.trim().length > 0;
  return { sha: head[0], date: head[1], subject: head.slice(2).join('|'), branch, behind, dirty };
}
async function refreshVersions(fetch = false) {
  const out = {};
  for (const source of ['github', 'local']) {
    for (const repo of Object.keys(REPOS)) {
      const dir = dirOf(repo, source);
      if (fetch && existsSync(path.join(dir, '.git'))) git(dir, 'fetch', '-q', 'origin', 'main');
      out[`${source}:${repo}`] = versionOf(dir);
    }
  }
  versions = out;
  emit('state', snapshot());
}

// ---------- Aktualisieren ----------

const lockHash = (dir) => { try { return createHash('sha1').update(readFileSync(path.join(dir, 'package-lock.json'))).digest('hex'); } catch { return ''; } };

async function updateRepo(repo) {
  const dir = dirOf(repo, 'github');
  if (!existsSync(path.join(dir, '.git'))) {
    say(`${REPOS[repo].name}: erste Kopie von GitHub holen …`, 'info');
    await run('git', ['clone', '--branch', 'main', REPOS[repo].url, dir], SIM, `git clone ${REPOS[repo].name}`);
  } else {
    say(`${REPOS[repo].name}: neuesten Stand von GitHub (main) holen …`, 'info');
    await run('git', ['fetch', 'origin', 'main'], dir);
    // eigene Kopie, gehört nur dem Simulator – darf hart auf main gesetzt werden (Beispieldaten und Builds sind ignoriert und bleiben)
    await run('git', ['checkout', '-q', '-B', 'main', 'origin/main'], dir);
    await run('git', ['reset', '-q', '--hard', 'origin/main'], dir);
  }
  // Pakete nur neu installieren, wenn sich package-lock.json geändert hat
  const stamp = path.join(dir, 'node_modules', '.stella-lock');
  const want = lockHash(dir);
  let have = '';
  try { have = readFileSync(stamp, 'utf8'); } catch { /* noch nie */ }
  if (want && want !== have) {
    say(`${REPOS[repo].name}: Pakete installieren (dauert beim ersten Mal ein paar Minuten) …`, 'info');
    process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1';
    await runNpm(['ci', '--no-audit', '--no-fund'], dir);
    writeFileSync(stamp, want);
  }
}

// ---------- Starten / Stoppen ----------

function killTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
  else { try { process.kill(-pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch { /* weg */ } } }
}

async function stop() {
  if (!running) return;
  const r = running;
  running = null;
  setPhase('stopping');
  say(`${APPS[r.app].title} wird beendet …`, 'info');
  killTree(r.child.pid);
  await new Promise((res) => { if (r.child.exitCode != null) res(); else { r.child.once('close', res); setTimeout(res, 5000); } });
  setPhase('idle');
}

const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

let busy = false;
async function start({ update }) {
  if (busy) return;
  busy = true;
  const app = settings.app;
  let source = settings.source;
  let offline = false;
  try {
    await stop();
    if (source === 'github') {
      setPhase('updating');
      const have = (repo) => existsSync(path.join(dirOf(repo, 'github'), '.git'));
      for (const repo of APPS[app].repos) {
        // wenn die Kopie fehlt, muss sie geholt werden; sonst nur auf Wunsch
        if (!update && have(repo)) continue;
        try {
          await updateRepo(repo);
        } catch (err) {
          // offline (oder GitHub nicht erreichbar): mit dem arbeiten, was schon da ist
          if (have(repo)) {
            say(`GitHub nicht erreichbar (${err.message}) – starte die zuletzt geholte Version.`, 'info');
            offline = true;
          } else if (APPS[app].repos.every((r) => existsSync(dirOf(r, 'local')))) {
            say('GitHub nicht erreichbar und noch keine Kopie da – starte stattdessen deine Ordner.', 'info');
            source = 'local';
            break;
          } else {
            throw new Error('GitHub nicht erreichbar und noch keine Kopie da – einmal mit Internet starten.');
          }
        }
      }
    }
    if (source === 'local') {
      say('Meine Ordner: ohne Git, genau der Stand, der gerade auf der Platte liegt.', 'info');
    }
    await refreshVersions(false);
    setPhase('building');
    const life = dirOf('life', source);
    // Stand der Repos dieser App; gleich wie beim letzten erfolgreichen Build → ohne Build starten
    const stamp = source === 'github' ? APPS[app].repos.map((r) => git(dirOf(r, 'github'), 'rev-parse', 'HEAD').stdout.trim()).join('+') : '';
    const scriptText = (() => { try { return readFileSync(path.join(life, 'ios', 'PC', 'scripts', 'stella-pc.ps1'), 'utf8'); } catch { return ''; } })();
    const noBuild = process.platform === 'win32' && !!stamp && settings.built?.[app] === stamp && scriptText.includes('NoBuild');
    const script = path.join(life, 'ios', 'PC', 'scripts', process.platform === 'win32' ? 'stella-pc.ps1' : 'stella-pc.sh');
    if (!existsSync(script)) throw new Error(`Startskript fehlt: ${script}`);
    const args = process.platform === 'win32'
      // UTF-8-Ausgabe, sonst kommen Umlaute aus PowerShell kaputt im Protokoll an
      ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `[Console]::OutputEncoding = [Text.Encoding]::UTF8; & ${psQuote(script)}${app === 'students' ? ` students -Repo ${psQuote(dirOf('students', source))}` : ''}${settings.demo ? ' -Demo' : ''}${noBuild ? ' -NoBuild' : ''}; exit $LASTEXITCODE`]
      : [script, ...(app === 'students' ? ['students', '--repo', dirOf('students', source)] : []), ...(settings.demo ? ['--demo'] : [])];
    const env = { ...process.env, STELLA_PC_FEEDBACK: path.join(TOP, 'Verbesserungen', APPS[app].dataName) };
    say(`${APPS[app].title} ${noBuild ? 'starten – seit dem letzten Build nichts Neues, kein neuer Build nötig' : 'bauen und starten'} (${source === 'local' ? 'meine Ordner' : offline || !update ? 'zuletzt geholte Version' : 'neueste Version'}${settings.demo ? ', offline mit Beispieldaten' : ''}) …`, 'info');
    const child = spawn(process.platform === 'win32' ? 'powershell.exe' : 'bash', args, { cwd: life, env, windowsHide: true, detached: process.platform !== 'win32' });
    running = { app, child };
    child.stdout.on('data', (d) => {
      say(d);
      if (/Stella l.{1,2}uft|Stella startet/.test(String(d)) && phase !== 'running') {
        // Build hat geklappt: diesen Stand merken
        if (stamp && settings.built?.[app] !== stamp) { settings.built = { ...settings.built, [app]: stamp }; saveSettings(); }
        setPhase('running');
      }
    });
    // Swift schreibt auch Warnungen nach stderr – rot nur, was nach Fehler aussieht
    child.stderr.on('data', (d) => say(d, /error|fehler|failed|fehlgeschlagen|exception/i.test(String(d)) && !/warning:/i.test(String(d)) ? 'err' : 'out'));
    child.on('close', (code) => {
      if (running?.child === child) {
        running = null;
        say(code ? `${APPS[app].title} wurde mit Code ${code} beendet – siehe Protokoll.` : `${APPS[app].title} ist beendet.`, code ? 'err' : 'info');
        setPhase(code ? 'error' : 'idle');
      }
    });
  } catch (err) {
    say(err.message, 'err');
    setPhase('error');
  } finally {
    busy = false;
  }
}

// ---------- Fenster ----------

const PAGE = readFileSync(path.join(HERE, 'launcher.html'), 'utf8');
const WEB_DIR = path.join(HERE, '..', 'Sources', 'SwiftUI', 'Web');

function body(req) {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (d) => { s += d; if (s.length > 10_000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const ok = url.searchParams.get('t') === TOKEN || req.headers['x-token'] === TOKEN;
  // Schriften und App-Logos aus dem Web-Ordner des Simulators (ohne Schlüssel – nichts Privates)
  if (url.pathname.startsWith('/fonts/') || url.pathname.startsWith('/icons/')) {
    const name = path.basename(url.pathname);
    const f = path.join(url.pathname.startsWith('/fonts/') ? path.join(WEB_DIR, 'fonts') : WEB_DIR, name);
    const type = name.endsWith('.woff2') ? 'font/woff2' : name.endsWith('.svg') ? 'image/svg+xml' : null;
    if (!type || !/^[\w.-]+$/.test(name) || !existsSync(f)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'max-age=86400' }).end(readFileSync(f));
    return;
  }
  if (!ok) { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Kein Zugriff'); return; }
  const json = (data, code = 200) => res.writeHead(code, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(PAGE.replace('__TOKEN__', TOKEN));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`event: state\ndata: ${JSON.stringify(snapshot())}\n\n`);
    res.write(`event: history\ndata: ${JSON.stringify(log)}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/settings') {
    const b = await body(req);
    if (b.app in APPS) settings.app = b.app;
    if (b.source === 'github' || b.source === 'local') settings.source = b.source;
    if (typeof b.demo === 'boolean') settings.demo = b.demo;
    if (typeof b.autoUpdate === 'boolean') settings.autoUpdate = b.autoUpdate;
    saveSettings();
    emit('state', snapshot());
    json({ ok: true });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/start') { const b = await body(req); json({ ok: true }); void start({ update: !!b.update }); return; }
  if (req.method === 'POST' && url.pathname === '/api/stop') { json({ ok: true }); void stop(); return; }
  if (req.method === 'POST' && url.pathname === '/api/check') { json({ ok: true }); void refreshVersions(true); return; }
  if (req.method === 'POST' && url.pathname === '/api/quit') { json({ ok: true }); void quit(); return; }
  json({ error: 'Nicht gefunden' }, 404);
});

function openWindow(url) {
  if (process.env.STELLA_LAUNCHER_NO_WINDOW) return;
  const profile = path.join(SIM, 'launcher-window');
  const args = [`--app=${url}`, '--window-size=560,820', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check'];
  const env = process.env;
  const candidates = process.platform === 'win32' ? [
    `${env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${env.ProgramFiles ?? 'C:\\Program Files'}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${env.ProgramFiles ?? 'C:\\Program Files'}\\Google\\Chrome\\Application\\chrome.exe`,
    `${env.LOCALAPPDATA ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
  ] : ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'];
  const exe = candidates.find((c) => existsSync(c));
  if (exe) { spawn(exe, args, { detached: true, stdio: 'ignore' }).unref(); return; }
  if (process.platform === 'win32') spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
}

async function quit() {
  await stop();
  console.log('Launcher beendet.');
  process.exit(0);
}
// Konsolenfenster zu / Strg+C: den Simulator mitbeenden, damit kein Server im Hintergrund weiterläuft
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(sig, () => { if (running) killTree(running.child.pid); process.exit(0); });
process.on('exit', () => { if (running) killTree(running.child.pid); });

const PORT = Number(process.env.STELLA_LAUNCHER_PORT || 0);
server.listen(PORT, '127.0.0.1', async () => {
  const url = `http://127.0.0.1:${server.address().port}/?t=${TOKEN}`;
  console.log(`Stella-Launcher: ${url}`);
  console.log('Zum Beenden dieses Fenster schließen (beendet auch den Simulator).');
  openWindow(url);
  await refreshVersions(settings.autoUpdate);
  // beim Öffnen gleich die zuletzt gewählte App starten – mit „Automatisch aktualisieren“ vorher die neueste Version holen
  // offline ok: ohne Internet startet die zuletzt geholte Version
  if (!process.env.STELLA_LAUNCHER_NO_AUTOSTART) void start({ update: settings.autoUpdate && settings.source === 'github' });
  // alle 10 Minuten nachsehen, ob es Neues gibt (Anzeige im Fenster; ein laufender Simulator wird nicht unterbrochen)
  setInterval(() => { if (!busy && settings.autoUpdate) void refreshVersions(true); }, 10 * 60_000).unref();
});
