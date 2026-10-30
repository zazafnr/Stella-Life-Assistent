import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.STELLA_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'stella-signup-'));
process.env.STELLA_SECRET = 'test-secret-1234567890';
process.env.OPENROUTER_API_KEY = '';
process.env.STELLA_REGISTRATION = 'invite';

const { login, requireUser, HttpError } = await import('./auth.ts');
const { db, getUser, listItems, addMessage } = await import('./db.ts');
const { setKey } = await import('./keys.ts');
const { setMailTransportFactory } = await import('./mailer.ts');
const { createInvite, registerProfileRoutes, registerSignupRoutes } = await import('./signup.ts');
const { cleanProfile, hasFeature, afterWorkTime } = await import('./profile.ts');
const { addItem } = await import('./planner.ts');
const { buildWeekPlan } = await import('./weekplan.ts');
const { findHints } = await import('./hints.ts');
const { saveFile, filePath } = await import('./files.ts');
const { toMin } = await import('./context.ts');
const { addDays, todayIn } = await import('@stella/shared');
const Fastify = (await import('fastify')).default;

const sent: { to: string; subject: string; text: string }[] = [];
setMailTransportFactory(() => ({ sendMail: async (m: { to: string; subject: string; text: string }) => { sent.push(m); return {} as never; } }));

const publicUser = (u: { id: string; name: string; settings: unknown; role: string }) => ({ id: u.id, name: u.name, settings: u.settings, role: u.role });
const app = Fastify();
app.setErrorHandler((err, _req, reply) => {
  if (err instanceof HttpError) return reply.code(err.status).send({ ...err.extra, error: err.message });
  return reply.code(500).send({ error: (err as Error).message });
});
registerSignupRoutes(app, publicUser);
await app.register(async (api) => { api.addHook('preHandler', requireUser); registerProfileRoutes(api, publicUser); });
await app.ready();

const post = (url: string, payload: unknown, token?: string) => app.inject({ method: 'POST', url, payload: payload as object, headers: token ? { authorization: `Bearer ${token}` } : {} });
const lastCode = () => /\n\s{4}(\d{6})\n/.exec(sent.at(-1)!.text)![1]!;
const signup = (email: string, invite?: string, extra: object = {}) =>
  post('/api/auth/register', { name: 'Mia', email, password: 'supergeheim', timeZone: 'Europe/Vienna', invite, ...extra });

let ownerToken = '';
let ownerId = '';

test('das erste Konto wird Owner: ohne Einladung, ohne Code', async () => {
  const res = await signup('lukas@example.com');
  assert.equal(res.statusCode, 200, res.body);
  ownerToken = res.json().token;
  ownerId = res.json().user.id;
  assert.equal(res.json().user.role, 'owner');
  assert.equal(getUser(ownerId)!.settings.onboarding, 'pending');
});

test('Registrierung nur mit gültiger Einladung', async () => {
  setKey('smtp', { host: 'smtp.example.com', port: 465, user: 'stella@example.com', pass: 'geheim' });
  assert.equal((await signup('a@example.com')).statusCode, 403, 'ohne Einladung');
  assert.equal((await signup('a@example.com', 'FALSCH-CODE')).statusCode, 403, 'erfundene Einladung');
  assert.equal(sent.length, 0);
});

test('ohne Mail-Absender kann niemand bestätigt werden → klare Meldung, kein halbes Konto', async () => {
  const { code } = createInvite(ownerId);
  setKey('smtp', null);
  const res = await signup('b@example.com', code);
  assert.equal(res.statusCode, 503);
  assert.match(res.json().error, /Bestätigungs-Mails/);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM users WHERE email = 'b@example.com'").get() as { n: number }).n, 0);
  setKey('smtp', { host: 'smtp.example.com', port: 465, user: 'stella@example.com', pass: 'geheim' });
});

test('Einladung → Code per Mail → bestätigen → Sitzung; Einladung ist danach verbraucht', async () => {
  const { code } = createInvite(ownerId);
  const reg = await signup('mia@example.com', code);
  assert.equal(reg.statusCode, 200, reg.body);
  assert.deepEqual(reg.json(), { needsVerification: true, email: 'mia@example.com' });
  assert.equal(sent.at(-1)!.to, 'mia@example.com');
  assert.match(sent.at(-1)!.subject, /^Dein Stella-Code: \d{6}$/);

  // vor der Bestätigung kein Login
  assert.throws(() => login('mia@example.com', 'supergeheim'), (err: unknown) =>
    err instanceof HttpError && err.status === 403 && err.extra.needsVerification === true);

  const ok = await post('/api/auth/verify', { email: 'mia@example.com', code: lastCode() });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.ok(ok.json().token);
  assert.equal(ok.json().user.role, 'user');
  assert.equal(getUser(ok.json().user.id)!.verified, true);
  assert.ok(login('mia@example.com', 'supergeheim').token, 'danach geht der Login');

  const again = await signup('mia2@example.com', code);
  assert.equal(again.statusCode, 403, 'dieselbe Einladung ein zweites Mal');
});

test('Code-Ablauf: falsch, 5 Fehlversuche sperren, abgelaufen, erneut senden erst nach 60 Sekunden', async () => {
  const { code } = createInvite(ownerId);
  await signup('tim@example.com', code);
  const real = lastCode();
  const wrong = real === '000000' ? '111111' : '000000';

  const first = await post('/api/auth/verify', { email: 'tim@example.com', code: wrong });
  assert.equal(first.statusCode, 400);
  assert.match(first.json().error, /Noch 4 Versuche/);
  for (let i = 0; i < 3; i++) await post('/api/auth/verify', { email: 'tim@example.com', code: wrong });
  const locked = await post('/api/auth/verify', { email: 'tim@example.com', code: wrong });
  assert.equal(locked.statusCode, 429);
  assert.equal(locked.json().needsNewCode, true);
  const afterLock = await post('/api/auth/verify', { email: 'tim@example.com', code: real });
  assert.equal(afterLock.statusCode, 400, 'auch der richtige Code gilt nach der Sperre nicht mehr');

  // neuer Code: zu früh → 429, nach 60 s geht es
  const resendNow = await post('/api/auth/resend', { email: 'tim@example.com' });
  assert.equal(resendNow.statusCode, 200, 'noch kein Code offen → sofort möglich');
  const tooSoon = await post('/api/auth/resend', { email: 'tim@example.com' });
  assert.equal(tooSoon.statusCode, 429);
  assert.ok(tooSoon.json().retryIn > 0);
  db.prepare("UPDATE email_codes SET sent_at = ? WHERE user_id = (SELECT id FROM users WHERE email = 'tim@example.com')").run(new Date(Date.now() - 61_000).toISOString());
  assert.equal((await post('/api/auth/resend', { email: 'tim@example.com' })).statusCode, 200);

  // abgelaufen
  db.prepare("UPDATE email_codes SET expires_at = ? WHERE user_id = (SELECT id FROM users WHERE email = 'tim@example.com')").run(new Date(Date.now() - 1000).toISOString());
  const expired = await post('/api/auth/verify', { email: 'tim@example.com', code: lastCode() });
  assert.equal(expired.statusCode, 400);
  assert.match(expired.json().error, /abgelaufen/);

  // frischer Code klappt
  db.prepare("UPDATE email_codes SET sent_at = ? WHERE user_id = (SELECT id FROM users WHERE email = 'tim@example.com')").run(new Date(Date.now() - 61_000).toISOString());
  await post('/api/auth/resend', { email: 'tim@example.com' });
  assert.equal((await post('/api/auth/verify', { email: 'tim@example.com', code: lastCode() })).statusCode, 200);
});

test('Modus geschlossen und offen', async () => {
  process.env.STELLA_REGISTRATION = 'closed';
  assert.equal((await signup('c@example.com', createInvite(ownerId).code)).statusCode, 403);
  process.env.STELLA_REGISTRATION = 'open';
  assert.equal((await signup('d@example.com')).statusCode, 200, 'offen: ohne Einladung, aber mit Code');
  process.env.STELLA_REGISTRATION = 'invite';
});

// ----- Profil -----

const makeUser = async (email: string) => {
  const { code } = createInvite(ownerId);
  await signup(email, code);
  const v = await post('/api/auth/verify', { email, code: lastCode() });
  return { token: v.json().token as string, id: v.json().user.id as string };
};
const today = todayIn('Europe/Vienna');
const from = addDays(today, 1);
const overlaps = (a: { start: string; end: string }, b: { start: string; end: string }) => toMin(a.start) < toMin(b.end) && toMin(b.start) < toMin(a.end);

test('Profil Job: Arbeitszeit wird Routine im Gedächtnis, der Wochenplaner plant nicht hinein', async () => {
  const u = await makeUser('job@example.com');
  const res = await app.inject({ method: 'PUT', url: '/api/profile', headers: { authorization: `Bearer ${u.token}` }, payload: {
    situation: 'work', ageGroup: '25-34', features: ['mails', 'planner', 'shopping', 'homework', 'bogus'],
    workHours: { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:30', commute: true },
  } });
  assert.equal(res.statusCode, 200, res.body);
  const user = getUser(u.id)!;
  assert.equal(user.settings.onboarding, 'done');
  assert.deepEqual(user.settings.profile!.features, ['mails', 'planner', 'shopping', 'homework'], 'unbekannte Funktionen fliegen raus');
  const routine = db.prepare("SELECT schedule FROM memories WHERE user_id = ? AND text = 'Arbeit'").get(u.id) as { schedule: string };
  assert.deepEqual(JSON.parse(routine.schedule), { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:30' });
  assert.equal(afterWorkTime(user), '17:30');
  assert.equal(user.settings.permissions?.homework, 'never', 'kein HÜ-Autopilot im Job');

  for (let i = 0; i < 3; i++) addItem(user, { kind: 'assignment', title: `Aufgabe ${i}`, due: addDays(from, 5) });
  const plan = buildWeekPlan(user, { from });
  assert.ok(plan.blocks.length > 0);
  for (const b of plan.blocks) {
    const weekday = (new Date(`${b.date}T12:00:00Z`).getUTCDay() + 6) % 7 + 1;
    if (weekday <= 5) assert.ok(!overlaps(b, { start: '09:00', end: '17:30' }), `${b.date} ${b.start}–${b.end} liegt in der Arbeitszeit`);
  }
});

test('hasFeature: ohne Profil wie bisher (Finanzen braucht Einrichtung), im Job keine Schule', async () => {
  const u = await makeUser('legacy@example.com');
  const legacy = getUser(u.id)!;
  assert.equal(hasFeature(legacy, 'homework'), true);
  assert.equal(hasFeature(legacy, 'finance'), false);
  const job = { ...legacy, settings: { ...legacy.settings, profile: cleanProfile({ situation: 'work', features: ['homework', 'finance', 'mails'] }) } };
  assert.equal(hasFeature(job, 'homework'), false, 'HÜ gibt es nur bei Schule, auch wenn angehakt');
  assert.equal(hasFeature(job, 'finance'), true);
  assert.equal(hasFeature(job, 'goals'), false);
  assert.equal(afterWorkTime(job), '17:30', 'ohne Arbeitszeit: 17:30');
});

test('Hinweise: Schul-Hinweise (Test ohne Stoff) gibt es nur bei Schule und Studium', async () => {
  const mk = async (email: string, profile: object | null) => {
    const u = await makeUser(email);
    if (profile) await app.inject({ method: 'PUT', url: '/api/profile', headers: { authorization: `Bearer ${u.token}` }, payload: profile });
    const user = getUser(u.id)!;
    addItem(user, { kind: 'exam', title: 'Bio Test', subject: 'Biologie', due: addDays(today, 4) });
    return findHints(getUser(u.id)!).some((h) => h.key.startsWith('exam_no_material:'));
  };
  assert.equal(await mk('schule@example.com', { situation: 'school', features: ['planner', 'homework'] }), true);
  assert.equal(await mk('uni@example.com', { situation: 'university', features: ['planner'] }), true);
  assert.equal(await mk('arbeit@example.com', { situation: 'work', features: ['planner'] }), false);
  assert.equal(await mk('alt@example.com', null), true, 'ohne Profil wie bisher');
});

test('Profil prüfen: unbekannte Lebenslage wird abgelehnt, Überspringen gibt ein schlankes Profil', async () => {
  const u = await makeUser('skip@example.com');
  const bad = await app.inject({ method: 'PUT', url: '/api/profile', headers: { authorization: `Bearer ${u.token}` }, payload: { situation: 'pirat', features: [] } });
  assert.equal(bad.statusCode, 400);
  const skip = await post('/api/profile/skip', {}, u.token);
  assert.equal(skip.statusCode, 200);
  const p = getUser(u.id)!.settings.profile!;
  assert.equal(p.situation, 'other');
  assert.ok(!p.features.includes('homework'));
});

test('Konto löschen: Passwort nötig, alle Daten und Dateien sind weg, Owner erst als Letzter', async () => {
  const u = await makeUser('weg@example.com');
  const user = getUser(u.id)!;
  addItem(user, { kind: 'todo', title: 'Etwas', due: addDays(today, 1) });
  const fileId = saveFile(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'), 'png');
  addMessage(u.id, 'user', 'mit Bild', { attachments: [{ id: fileId, kind: 'image' }] });
  assert.ok(filePath(fileId));

  const wrong = await app.inject({ method: 'DELETE', url: '/api/me', headers: { authorization: `Bearer ${u.token}` }, payload: { password: 'falsch' } });
  assert.equal(wrong.statusCode, 403);
  assert.ok(getUser(u.id));

  const del = await app.inject({ method: 'DELETE', url: '/api/me', headers: { authorization: `Bearer ${u.token}` }, payload: { password: 'supergeheim' } });
  assert.equal(del.statusCode, 200, del.body);
  assert.equal(getUser(u.id), null);
  for (const t of ['items', 'messages', 'memories', 'sessions', 'conversations', 'actions']) {
    assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ?`).get(u.id) as { n: number }).n, 0, `${t} ist leer`);
  }
  assert.equal(filePath(fileId), null);
  assert.ok(!existsSync(path.join(process.env.STELLA_DATA_DIR!, 'files', `${fileId}.png`)));
  assert.equal(listItems(u.id, {}).length, 0);

  const owner = await app.inject({ method: 'DELETE', url: '/api/me', headers: { authorization: `Bearer ${ownerToken}` }, payload: { password: 'supergeheim' } });
  assert.equal(owner.statusCode, 400, 'der Owner bleibt, solange es andere Konten gibt');
});
