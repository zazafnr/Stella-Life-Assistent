import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.STELLA_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'stella-editions-'));
process.env.STELLA_SECRET = 'test-secret-1234567890';
process.env.OPENROUTER_API_KEY = '';
process.env.STELLA_REGISTRATION = 'open';
delete process.env.STELLA_EDITION_STUDENTS;

const { login, requireUser, HttpError } = await import('./auth.ts');
const { db, getUser, updateUserSettings } = await import('./db.ts');
const { setKey } = await import('./keys.ts');
const { setMailTransportFactory } = await import('./mailer.ts');
const { registerSignupRoutes } = await import('./signup.ts');
const { registerLoginApi } = await import('./loginlink.ts');
const { loadEditions } = await import('./editions/load.ts');
const { editions, pluginRoutes, pluginTools, registerEdition, requestEdition, resetEditions } = await import('./editions/registry.ts');
const { buildLagebild } = await import('./context.ts');
const { systemPrompt } = await import('./assistant.ts');
const { quickActions } = await import('./quick.ts');
const { findHints } = await import('./hints.ts');
const { buildBriefing } = await import('./briefing.ts');
const { todayIn } = await import('@stella/shared');
const Fastify = (await import('fastify')).default;
import type { FastifyInstance } from 'fastify';

const sent: { from: string; to: string; subject: string; text: string; html?: string }[] = [];
setMailTransportFactory(() => ({ sendMail: async (m: never) => { sent.push(m); return {} as never; } }));
setKey('smtp', { host: 'smtp.example.com', port: 465, user: 'noreply@example.com', pass: 'geheim' });

const publicUser = (u: { id: string; name: string; settings: unknown; role: string; edition: string }) => ({ id: u.id, name: u.name, settings: u.settings, role: u.role, edition: u.edition });
const newApp = async (register: (app: ReturnType<typeof Fastify>) => void) => {
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ ...err.extra, error: err.message });
    return reply.code(500).send({ error: (err as Error).message });
  });
  register(app);
  await app.ready();
  return app;
};

const signupApp = await newApp((app) => { registerSignupRoutes(app, publicUser); registerLoginApi(app); });
const STUDENTS_HOST = { host: 'students.stella.evolsior.com' };
const LIFE_HOST = { host: 'stella.evolsior.com' };
const signup = (email: string, headers: Record<string, string>) =>
  signupApp.inject({ method: 'POST', url: '/api/auth/register', headers, payload: { name: 'Mia', email, password: 'supergeheim', timeZone: 'Europe/Vienna' } });

// ---------- Konten je Edition ----------

test('die Oberfläche kommt aus dem Host, dem Feld edition oder dem Header – sonst life', () => {
  assert.equal(requestEdition({ headers: { host: 'students.stella.evolsior.com' } }), 'students');
  assert.equal(requestEdition({ headers: { host: 'stella.evolsior.com' } }), 'life');
  assert.equal(requestEdition({ headers: { host: 'localhost:8787' }, body: { edition: 'students' } }), 'students');
  assert.equal(requestEdition({ headers: { host: 'localhost:8787', 'x-stella-edition': 'students' } }), 'students');
  assert.equal(requestEdition({ headers: { host: 'students.stella.evolsior.com' }, body: { edition: 'life' } }), 'students', 'der Host gewinnt');
  assert.equal(requestEdition({ headers: { host: 'localhost' }, body: { edition: 'quatsch' } }), 'life');
});

test('Registrierung über den Students-Host erzeugt ein Students-Konto, über die normale Adresse ein Life-Konto', async () => {
  const first = await signup('owner@example.com', STUDENTS_HOST);
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json().user.edition, 'students');
  assert.equal(getUser(first.json().user.id)!.edition, 'students');

  const life = await signup('mia@example.com', LIFE_HOST);
  assert.equal(life.statusCode, 200, life.body);
  assert.equal(life.json().needsVerification, true);
  assert.equal((db.prepare("SELECT edition FROM users WHERE email = 'mia@example.com'").get() as { edition: string }).edition, 'life');

  const stud = await signup('sam@example.com', STUDENTS_HOST);
  assert.equal(stud.statusCode, 200, stud.body);
  assert.equal((db.prepare("SELECT edition FROM users WHERE email = 'sam@example.com'").get() as { edition: string }).edition, 'students');
});

test('Bestätigungs-Mail einer Students-Anmeldung nennt „Stella for Students“ (Absender, Betreff, Kopf)', () => {
  const mail = [...sent].reverse().find((m) => m.to === 'sam@example.com')!;
  assert.match(mail.from, /^Stella for Students </);
  assert.match(mail.subject, /Stella for Students/);
  assert.match(mail.html ?? '', /Stella for Students/);
  const normal = [...sent].reverse().find((m) => m.to === 'mia@example.com')!;
  assert.match(normal.from, /^(?!Stella for Students)/, 'das normale Stella bleibt „Stella“');
  assert.equal(normal.subject, 'Confirm your Stella sign-up');
});

test('Anmeldung auf der falschen Oberfläche → 409 mit Link, nie ein Zugang', () => {
  db.prepare("UPDATE users SET verified = 1 WHERE email IN ('mia@example.com', 'sam@example.com')").run();
  const before = (db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n;

  assert.throws(() => login('sam@example.com', 'supergeheim', undefined, '', 'life'),
    (err: unknown) => err instanceof HttpError && err.status === 409 && err.extra.code === 'wrong_edition' && err.extra.edition === 'students' && /Stella for Students/.test(err.message) && typeof err.extra.url === 'string');
  assert.throws(() => login('mia@example.com', 'supergeheim', undefined, '', 'students'),
    (err: unknown) => err instanceof HttpError && err.status === 409 && err.extra.edition === 'life');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n, before, 'es entsteht keine Sitzung');

  assert.ok(login('sam@example.com', 'supergeheim', undefined, '', 'students').token);
  assert.ok(login('mia@example.com', 'supergeheim', undefined, '', 'life').token);
  assert.throws(() => login('mia@example.com', 'falsch', undefined, '', 'students'), (err: unknown) => err instanceof HttpError && err.status === 401, 'ohne Passwort verrät die Meldung nichts über das Konto');
});

test('dieselbe Adresse auf der anderen Oberfläche registrieren → Hinweis auf die richtige App statt „schon registriert“', async () => {
  const res = await signup('sam@example.com', LIFE_HOST);
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().code, 'wrong_edition');
  assert.equal(res.json().edition, 'students');
});

test('Anmelde-Link für ein Konto der anderen App: keine Mail, gleiche Antwort wie immer', async () => {
  const count = sent.length;
  const res = await signupApp.inject({ method: 'POST', url: '/api/auth/link/request', headers: LIFE_HOST, payload: { email: 'sam@example.com' } });
  assert.equal(res.statusCode, 200);
  assert.equal(sent.length, count, 'es wurde nichts verschickt');
  const ok = await signupApp.inject({ method: 'POST', url: '/api/auth/link/request', headers: STUDENTS_HOST, payload: { email: 'sam@example.com' } });
  assert.equal(ok.statusCode, 200);
  assert.equal(sent.length, count + 1);
  assert.match(sent.at(-1)!.from, /^Stella for Students </);
});

test('bestehende Konten bleiben life (Migration mit Standardwert)', () => {
  const col = (db.prepare("SELECT dflt_value AS d, \"notnull\" AS nn FROM pragma_table_info('users') WHERE name = 'edition'").get() as { d: string; nn: number });
  assert.equal(col.d, "'life'");
  assert.equal(col.nn, 1);
});

// ---------- Plugin an / aus ----------

const owner = () => getUser((db.prepare("SELECT id FROM users WHERE email = 'owner@example.com'").get() as { id: string }).id)!;

test('ohne Plugin: keine Schul-Routen, keine Schul-Werkzeuge, keine Schul-Sätze – und alles andere läuft', async () => {
  resetEditions();
  assert.deepEqual(await loadEditions('off'), { loaded: [], source: 'none' });
  assert.equal(editions().length, 0);

  const app = await newApp((a) => { a.register(async (api: FastifyInstance) => { api.addHook('preHandler', requireUser); pluginRoutes(api); }); });
  const token = login('owner@example.com', 'supergeheim', undefined, '', 'students').token;
  for (const url of ['/api/timetable', '/api/notes/inbox', '/api/integrations/webuntis', '/api/integrations/books/login-pages']) {
    const res = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
    assert.equal(res.statusCode, 404, url);
  }

  const user = owner();
  assert.deepEqual(pluginTools(user), []);
  const prompt = systemPrompt(user, todayIn(user.timeZone)).fixed;
  assert.doesNotMatch(prompt, /solve_homework/);
  assert.doesNotMatch(prompt, /School words/);
  assert.equal(quickActions(user, 9).actions.some((a) => a.id === 'homework' || a.id === 'photo'), false);
  const lb = buildLagebild(user, 3);
  assert.ok(lb.days.every((d) => d.lessons.length === 0 && !d.busy.some((b) => b.label.startsWith('Schule'))), 'auch keine geschätzte Schule');
  assert.ok(Array.isArray(findHints(user, lb)));
  assert.ok(buildBriefing(user, lb).sections.every((s) => s.id !== 'school'));
  await app.close();
});

test('mit Plugin: Routen, Werkzeuge, Prompt und Schnellwege wie bisher', async () => {
  resetEditions();
  const res0 = await loadEditions('builtin');
  assert.deepEqual(res0, { loaded: ['students'], source: 'builtin' });

  const app = await newApp((a) => { a.register(async (api: FastifyInstance) => { api.addHook('preHandler', requireUser); pluginRoutes(api); }); });
  const token = login('owner@example.com', 'supergeheim', undefined, '', 'students').token;
  const timetable = await app.inject({ method: 'GET', url: '/api/timetable', headers: { authorization: `Bearer ${token}` } });
  assert.equal(timetable.statusCode, 200);
  assert.deepEqual(timetable.json(), []);
  assert.equal((await app.inject({ method: 'GET', url: '/api/notes/inbox', headers: { authorization: `Bearer ${token}` } })).statusCode, 200);

  const user = owner();
  assert.deepEqual(pluginTools(user).map((x) => x.def.function.name), ['solve_homework', 'timetable']);
  const prompt = systemPrompt(user, todayIn(user.timeZone)).fixed;
  assert.match(prompt, /solve_homework/);
  assert.match(prompt, /School words/);
  const ids = quickActions(user, 9).actions.map((a) => a.id);
  assert.deepEqual(ids.slice(0, 3), ['briefing', 'photo', 'homework'], 'Reihenfolge wie vor dem Umbau');
  updateUserSettings(user.id, { profile: { situation: 'work', features: ['planner'] } });
  assert.doesNotMatch(systemPrompt(owner(), todayIn(user.timeZone)).fixed, /School words/, 'Berufstätige bekommen auch mit Plugin kein Schulvokabular');
  await app.close();
});

test('ein Plugin wird nicht doppelt geladen; Migrationen laufen in eigenem Zähler und nur einmal', () => {
  resetEditions();
  const userVersion = () => db.pragma('user_version', { simple: true });
  const before = userVersion();
  const plugin = { id: 'demo', edition: 'students' as const, migrations: [{ id: '001', sql: 'CREATE TABLE edition_demo (id TEXT PRIMARY KEY)' }] };
  registerEdition(plugin);
  assert.throws(() => registerEdition(plugin), /schon geladen/);
  assert.equal(userVersion(), before, 'PRAGMA user_version bleibt dem Kern');
  assert.deepEqual(db.prepare("SELECT plugin, id FROM edition_migrations").all(), [{ plugin: 'demo', id: '001' }]);
  resetEditions();
  registerEdition({ ...plugin, migrations: [...plugin.migrations, { id: '002', sql: 'ALTER TABLE edition_demo ADD COLUMN note TEXT' }] });
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM edition_migrations").get() as { n: number }).n, 2, 'nur die neue Migration lief');
  assert.ok(db.prepare("SELECT note FROM edition_demo").all());
  resetEditions();
});

test('externes Plugin aus einem Ordner: bekommt die Plugin-API hereingereicht und hängt Route und Werkzeug ein', async () => {
  resetEditions();
  const dir = mkdtempSync(path.join(tmpdir(), 'stella-plugin-'));
  writeFileSync(path.join(dir, 'index.ts'), `
    import type { EditionPlugin, PluginApi } from ${JSON.stringify(path.resolve(import.meta.dirname, 'plugin-api.ts'))};
    export default (api: PluginApi): EditionPlugin => ({
      id: 'extern', edition: 'students',
      routes: (app) => { app.get('/api/extern/ping', async (req) => ({ pong: api.tr(req.user, 'auth.login') })); },
      tools: [{ def: { type: 'function', function: { name: 'extern_tool', description: 'x', parameters: { type: 'object', properties: {} } } }, run: () => ({ ok: true }) }],
    });
  `);
  const res = await loadEditions(dir);
  assert.deepEqual(res, { loaded: ['extern'], source: 'external' });
  const app = await newApp((a) => { a.register(async (api: FastifyInstance) => { api.addHook('preHandler', requireUser); pluginRoutes(api); }); });
  const token = login('owner@example.com', 'supergeheim', undefined, '', 'students').token;
  const ping = await app.inject({ method: 'GET', url: '/api/extern/ping', headers: { authorization: `Bearer ${token}` } });
  assert.equal(ping.statusCode, 200, ping.body);
  assert.ok(ping.json().pong);
  assert.deepEqual(pluginTools(owner()).map((x) => x.def.function.name), ['extern_tool']);
  await app.close();

  resetEditions();
  await assert.rejects(() => loadEditions(path.join(dir, 'gibt-es-nicht')), /kein Plugin/);
});
