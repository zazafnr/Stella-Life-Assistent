import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.STELLA_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'stella-webapps-'));
process.env.STELLA_SECRET = 'test-secret-1234567890';

const { registerWebApps, fileFor } = await import('./webapps.ts');
const Fastify = (await import('fastify')).default;

const base = mkdtempSync(path.join(tmpdir(), 'stella-dist-'));
const make = (name: string, marker: string) => {
  const dir = path.join(base, name);
  mkdirSync(path.join(dir, 'assets'), { recursive: true });
  writeFileSync(path.join(dir, 'index.html'), `<html>${marker}</html>`);
  writeFileSync(path.join(dir, 'manifest.webmanifest'), JSON.stringify({ name: marker }));
  writeFileSync(path.join(dir, 'assets', 'app-abc.js'), `// ${marker}`);
  return dir;
};
const life = make('life', 'LIFE');
const students = make('students', 'STUDENTS');
writeFileSync(path.join(base, 'geheim.txt'), 'nicht ausliefern');

const L = { host: 'stella.evolsior.com' };
const S = { host: 'students.stella.evolsior.com' };

async function appWith(roots: { life: string; students: string }) {
  const app = Fastify();
  app.get('/api/status', async () => ({ ok: true }));
  await registerWebApps(app, roots);
  await app.ready();
  return app;
}

test('zwei Adressen, zwei Web-Apps: Host students.* bekommt die Studenten-App, alles andere die normale', async () => {
  const app = await appWith({ life, students });
  assert.match((await app.inject({ url: '/', headers: L })).body, /LIFE/);
  assert.match((await app.inject({ url: '/', headers: S })).body, /STUDENTS/);
  assert.equal((await app.inject({ url: '/manifest.webmanifest', headers: S })).json().name, 'STUDENTS');
  assert.equal((await app.inject({ url: '/manifest.webmanifest', headers: L })).json().name, 'LIFE');
  // Weiterleitungs-Header von Caddy (der Host kommt als x-forwarded-host an)
  assert.match((await app.inject({ url: '/', headers: { host: 'stella:8787', 'x-forwarded-host': 'students.stella.evolsior.com' } })).body, /STUDENTS/);
  await app.close();
});

test('Seiten-Pfade der App landen in der Startseite des jeweiligen Hosts; Assets sind ewig cachebar, HTML nicht', async () => {
  const app = await appWith({ life, students });
  assert.match((await app.inject({ url: '/planner', headers: S })).body, /STUDENTS/);
  assert.match((await app.inject({ url: '/planner', headers: L })).body, /LIFE/);
  const asset = await app.inject({ url: '/assets/app-abc.js', headers: S });
  assert.match(asset.body, /STUDENTS/);
  assert.match(String(asset.headers['cache-control']), /immutable/);
  assert.equal((await app.inject({ url: '/', headers: S })).headers['cache-control'], 'no-cache');
  assert.equal((await app.inject({ url: '/manifest.webmanifest', headers: S })).headers['cache-control'], 'no-cache');
  await app.close();
});

test('/api bleibt API (404 als JSON), andere Methoden bekommen keine App, Pfade außerhalb der Wurzel werden nie ausgeliefert', async () => {
  const app = await appWith({ life, students });
  assert.equal((await app.inject({ url: '/api/gibt-es-nicht', headers: S })).statusCode, 404);
  assert.deepEqual((await app.inject({ url: '/api/status', headers: S })).json(), { ok: true });
  assert.equal((await app.inject({ method: 'POST', url: '/irgendwas', headers: S })).statusCode, 404);
  for (const url of ['/../geheim.txt', '/%2e%2e/geheim.txt', '/assets/../../geheim.txt', '/..%2fgeheim.txt']) {
    const res = await app.inject({ url, headers: S });
    assert.ok(!res.body.includes('nicht ausliefern'), url);
  }
  assert.equal(fileFor(students, '/../geheim.txt'), null);
  assert.equal(fileFor(students, '/assets/app-abc.js'), 'assets/app-abc.js');
  assert.equal(fileFor(students, '/%E0%A4%A'), null, 'kaputte Kodierung');
  await app.close();
});

test('fehlt die Studenten-App, antwortet der students-Host mit 503 – die normale App läuft weiter', async () => {
  const app = await appWith({ life, students: path.join(base, 'gibt-es-nicht') });
  assert.equal((await app.inject({ url: '/', headers: S })).statusCode, 503);
  assert.equal((await app.inject({ url: '/planner', headers: S })).statusCode, 503);
  assert.match((await app.inject({ url: '/', headers: L })).body, /LIFE/);
  await app.close();
});

test('fehlt die normale App, liefert der Server nur die Studenten-App aus', async () => {
  const app = await appWith({ life: path.join(base, 'gibt-es-nicht'), students });
  assert.match((await app.inject({ url: '/', headers: S })).body, /STUDENTS/);
  assert.equal((await app.inject({ url: '/', headers: L })).statusCode, 503, 'die normale Adresse hat hier keine App');
  await app.close();
});
