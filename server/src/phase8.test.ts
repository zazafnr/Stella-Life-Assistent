import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

// Mock: Groq (Ziel herauslesen, Fortschritt zuordnen) und OpenRouter (Agent)
let groqCalls = 0;
const mock = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/groq/chat/completions') {
      groqCalls++;
      const prompt = String(JSON.parse(body).messages[1].content);
      if (prompt.startsWith('Satz:')) {
        // nur „laufen“ und „Mathe“ kennt der Mock; alles andere schlägt fehl → Rückfall auf das Muster im Satz
        if (!/laufen|Mathe/.test(prompt)) { res.statusCode = 500; res.end('{"error":"kaputt"}'); return; }
        const content = /Mathe/.test(prompt)
          ? { title: '' }
          : { title: 'Laufen gehen', why: 'fitter werden', metric: 'Einheiten', unit: 'x', target: 3, cadence: 'weekly:3', minutes: 45, checkIn: 'So 18:00' };
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(content) } }] }));
        return;
      }
      if (prompt.includes('Meldung:')) {
        const id = /- ([0-9a-f-]{36}): Meditieren/.exec(prompt)?.[1] ?? null;
        const content = /Achtsamkeit/.test(prompt) ? { goalId: id, value: 1, date: '2000-01-01', note: 'Achtsamkeit' } : { goalId: null };
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(content) } }] }));
        return;
      }
    }
    if (req.url === '/models') { res.end(JSON.stringify({ data: [{ id: 'good/model:free', supported_parameters: ['tools'] }] })); return; }
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Das weiß ich nicht.' } }] }));
  });
});
await new Promise<void>((r) => mock.listen(0, r));
after(() => mock.close());
const base = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;

process.env.STELLA_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'stella-p8-'));
process.env.STELLA_SECRET = 'test-secret-1234567890';
process.env.STELLA_ALLOW_REGISTRATION = 'true';
process.env.OPENROUTER_API_KEY = 'test';
process.env.OPENROUTER_BASE_URL = base;
process.env.GROQ_API_KEY = 'gsk_test-key-1234567890';
process.env.GROQ_BASE_URL = `${base}/groq`;

const { register, requireUser, HttpError } = await import('./auth.ts');
const { db, getUser, listItems, recentMessages } = await import('./db.ts');
const { handleChat } = await import('./assistant.ts');
const { perform, undo } = await import('./actions.ts');
const goals = await import('./goals.ts');
const { addMemory } = await import('./memory.ts');
const { buildWeekPlan, cleanBlocks } = await import('./weekplan.ts');
const { findHints } = await import('./hints.ts');
const { buildBriefing } = await import('./briefing.ts');
const { todayIn, timeIn, addDays } = await import('@stella/shared');
const Fastify = (await import('fastify')).default;

const lukas = register('Lukas', 'lukas@example.com', 'supergeheim', 'Europe/Vienna');
const mia = register('Mia', 'mia@example.com', 'supergeheim', 'Europe/Vienna');
const user = () => getUser(lukas.user.id)!;
const say = (text: string) => handleChat(user(), text, null);
const today = () => todayIn(user().timeZone);
const mine = () => goals.listGoals(user());

test('Ziel per Chat: Groq liest die Struktur, Stella legt es an – mit Karte und Rückgängig', async () => {
  const before = groqCalls;
  const r = await say('ich will 3x pro Woche laufen gehen');
  assert.ok(groqCalls > before, 'Groq wurde gefragt');
  assert.match(r.messages[0]!.text, /Laufen gehen/);
  assert.match(r.messages[0]!.text, /3× pro Woche/);
  assert.ok(r.messages[0]!.actionId, 'Karte mit Rückgängig');

  const [g] = mine();
  assert.equal(g!.title, 'Laufen gehen');
  assert.equal(g!.cadence, 'weekly:3');
  assert.equal(g!.target, 3);
  assert.equal(g!.minutes, 45);
  assert.equal(g!.checkIn, 'So 18:00');
  assert.equal(g!.why, 'fitter werden');
  assert.equal(g!.status, 'active');

  undo(lukas.user.id, r.messages[0]!.actionId!);
  assert.equal(mine().length, 0, 'Rückgängig löscht das Ziel');
  await say('ich will 3x pro Woche laufen gehen');
  assert.equal(mine().length, 1);
});

test('Ziel ohne Groq: Muster im Satz reicht („20 km pro Woche radeln“, „jeden Tag lesen“)', async () => {
  const km = await say('ich will 20 km pro Woche radeln');
  assert.match(km.messages[0]!.text, /Radeln/);
  const rad = mine().find((g) => g.title === 'Radeln')!;
  assert.equal(rad.unit, 'km');
  assert.equal(rad.target, 20);
  assert.equal(rad.cadence, 'custom');
  assert.equal(goals.weekTarget(rad), 20);

  const daily = await say('ich will jeden Tag lesen'); // Groq-Mock antwortet mit 500 → Rückfall auf das Muster
  assert.match(daily.messages[0]!.text, /täglich/);
  const lesen = mine().find((g) => g.title === 'Lesen')!;
  assert.equal(lesen.cadence, 'daily');
  assert.equal(goals.weekTarget(lesen), 7);
});

test('Dasselbe Ziel zweimal anlegen: Stella sagt, dass es das schon gibt', async () => {
  const n = mine().length;
  const again = await say('ich will 3x pro Woche laufen gehen');
  assert.match(again.messages[0]!.text, /gibt es schon/);
  assert.equal(mine().length, n);
});

test('Sätze ohne Rhythmus sind kein Ziel („ich will Pizza“, „ich will besser in Mathe werden“)', async () => {
  const n = mine().length;
  await say('ich will heute Pizza essen');
  await say('ich will besser in Mathe werden');
  assert.equal(mine().length, n);
  // ausdrücklich „mein Ziel“, aber Groq findet nichts → auch kein Ziel
  await say('mein Ziel: Mathe');
  assert.equal(mine().length, n);
});

test('Fortschritt: dem Ziel zuordnen (Name, Einheit, Groq) und Stand diese Woche', async () => {
  const laufen = mine().find((g) => g.title === 'Laufen gehen')!;
  const rad = mine().find((g) => g.title === 'Radeln')!;

  const one = await say('war heute laufen');
  assert.match(one.messages[0]!.text, /Laufen gehen/);
  assert.match(one.messages[0]!.text, /1× von 3×/);
  assert.equal(goals.progress(user(), laufen).weekValue, 1);

  // Menge in km, Ziel zählt Einheiten → eine Einheit, die Menge steht in der Notiz
  const km = await say('war heute 5 km laufen');
  assert.match(km.messages[0]!.text, /2× von 3×/);
  assert.ok(goals.progress(user(), laufen).recent.some((r) => /5 km/.test(r.note ?? '')), 'die Menge steht in der Notiz');

  // nur die Einheit verrät das Ziel
  const byUnit = await say('war heute 12 km unterwegs');
  assert.match(byUnit.messages[0]!.text, /Radeln/);
  assert.match(byUnit.messages[0]!.text, /12 km von 20 km/);

  // Rückgängig nimmt den Eintrag zurück
  undo(lukas.user.id, byUnit.messages[0]!.actionId!);
  assert.equal(goals.progress(user(), rad).weekValue, 0);

  // „gestern“ trägt das gestrige Datum ein
  const yesterday = await say('war gestern 3 km unterwegs');
  assert.match(yesterday.messages[0]!.text, /Radeln/);
  assert.equal((db.prepare('SELECT date FROM goal_logs WHERE goal_id = ?').get(rad.id) as { date: string }).date, addDays(today(), -1));
  undo(lukas.user.id, yesterday.messages[0]!.actionId!);

  // Sätze, die zu keinem Ziel gehören, bleiben normale Einträge
  const other = await say('war heute beim Zahnarzt');
  assert.doesNotMatch(other.messages[0]!.text, /Diese Woche/);
  assert.equal(goals.progress(user(), laufen).weekValue, 2);

  const medi = goals.createGoal(lukas.user.id, goals.cleanGoal({ title: 'Meditieren', cadence: 'weekly:5', target: 5 }));
  const viaGroq = await say('heute 10 Minuten Achtsamkeit geübt');
  assert.match(viaGroq.messages[0]!.text, /Meditieren/);
  const p = goals.progress(user(), medi);
  assert.equal(p.weekValue, 1);
  assert.equal(p.recent[0]!.date, today(), 'ein erfundenes Datum aus der Antwort zählt nicht');
});

test('Zwei Ziele mit derselben Einheit: Stella fragt nach, statt zu raten', async () => {
  goals.createGoal(lukas.user.id, goals.cleanGoal({ title: 'Schwimmen', cadence: 'custom', target: 3, unit: 'km', metric: 'km' }));
  const r = await say('war heute 2 km');
  assert.match(r.messages[0]!.text, /Zu welchem Ziel/);
  assert.equal(mine().find((g) => g.title === 'Schwimmen')!.weekValue, 0);
});

test('Wochenfortschritt und Verlauf: Montag bis Sonntag, 8 Wochen', () => {
  const g = goals.createGoal(lukas.user.id, goals.cleanGoal({ title: 'Dehnen', cadence: 'weekly:2', target: 2 }));
  const monday = goals.weekStart(today());
  goals.logGoal(lukas.user.id, g.id, 1, monday);
  goals.logGoal(lukas.user.id, g.id, 1, addDays(monday, -1)); // Sonntag davor
  goals.logGoal(lukas.user.id, g.id, 1, addDays(monday, -22));
  goals.logGoal(lukas.user.id, g.id, 1, addDays(monday, -80)); // zu alt für den Verlauf
  const p = goals.progress(user(), g, addDays(monday, 2));
  assert.equal(p.weekValue, 1);
  assert.equal(p.weekTarget, 2);
  assert.equal(p.history.length, 8);
  assert.deepEqual(p.history, [0, 0, 0, 1, 0, 0, 1, 1], 'älteste Woche links, aktuelle rechts; 80 Tage alt fällt heraus');
  assert.equal(goals.weekStart('2026-11-01'), '2026-10-26', 'Sonntag gehört zur Woche davor');
  assert.equal(goals.weekStart('2026-11-02'), '2026-11-02');
});

test('Check-in: zur gewählten Zeit, am gewählten Tag, einmal am Tag', async () => {
  const g = { ...goals.createGoal(lukas.user.id, goals.cleanGoal({ title: 'Joggen', cadence: 'weekly:3', target: 3, checkIn: 'So 18:00' })) };
  assert.equal(g.checkIn, 'So 18:00');
  assert.equal(goals.checkInDue(g, '2026-11-01', '17:59'), false);
  assert.equal(goals.checkInDue(g, '2026-11-01', '18:00'), true);
  assert.equal(goals.checkInDue(g, '2026-11-02', '18:30'), false, 'Montag ist nicht Sonntag');
  assert.equal(goals.checkInDue({ ...g, checkIn: '08:15' }, '2026-11-04', '08:15'), true, 'ohne Tag: täglich');
  assert.equal(goals.checkInDue({ ...g, checkIn: null }, '2026-11-01', '18:00'), false);
  assert.equal(goals.cleanGoal({ title: 'Test', checkIn: '25:99' }).checkIn, null, 'ungültige Zeit wird verworfen');

  // jetzt wirklich zustellen: täglich um 00:00 → fällig, aber nur einmal pro Tag
  goals.updateGoal(lukas.user.id, g.id, { checkIn: '00:00' });
  const count = () => recentMessages(lukas.user.id, 200).filter((m) => m.role === 'assistant' && m.text.includes('Joggen')).length;
  const before = count();
  await goals.sendGoalCheckIns(lukas.user.id);
  await goals.sendGoalCheckIns(lukas.user.id);
  assert.equal(count(), before + 1);
  const text = goals.checkInText(user(), goals.progress(user(), goals.getGoal(lukas.user.id, g.id)!));
  assert.match(text, /Joggen/);
  assert.match(text, /0× von 3×|Noch 3×/);
  assert.ok(timeIn(user().timeZone) >= '00:00');
});

test('Pausierte und erledigte Ziele bekommen keine Erinnerung und keinen Fortschritt per Chat', async () => {
  const g = goals.createGoal(lukas.user.id, goals.cleanGoal({ title: 'Tanzen', cadence: 'weekly:1', target: 1, checkIn: '00:00' }));
  goals.updateGoal(lukas.user.id, g.id, { status: 'paused' });
  assert.ok(!goals.activeGoals(lukas.user.id).some((x) => x.id === g.id));
  await goals.sendGoalCheckIns(lukas.user.id);
  assert.ok(!recentMessages(lukas.user.id, 300).some((m) => m.text.includes('Tanzen')), 'keine Erinnerung für pausierte Ziele');
  const r = await say('war heute tanzen');
  assert.doesNotMatch(r.messages[0]!.text, /eingetragen|Tanzen/);
  goals.updateGoal(lukas.user.id, g.id, { status: 'active' });
  assert.ok(goals.activeGoals(lukas.user.id).some((x) => x.id === g.id));
});

test('Wochenplan: Zeitblöcke für Ziele mit Zeitbedarf, schon Geschafftes zählt, Übernehmen mit Rückgängig', () => {
  const g = goals.createGoal(lukas.user.id, goals.cleanGoal({ title: 'Klavier üben', cadence: 'weekly:3', target: 3, minutes: 40 }));
  const plan = buildWeekPlan(user());
  const blocks = plan.blocks.filter((b) => b.parentId === g.id);
  assert.equal(blocks.length, 3, 'drei Einheiten verteilt');
  assert.ok(blocks.every((b) => b.why === 'goal' && b.title === 'Ziel: Klavier üben' && b.end > b.start));
  assert.equal(new Set(blocks.map((b) => b.date)).size, 3, 'an drei verschiedenen Tagen');
  assert.equal(new Set(blocks.map((b) => b.key)).size, 3, 'eindeutige Schlüssel');
  assert.ok(blocks.every((b) => Number(b.end.slice(0, 2)) * 60 + Number(b.end.slice(3)) - (Number(b.start.slice(0, 2)) * 60 + Number(b.start.slice(3))) === 40));

  // ohne Zeitbedarf kein Block
  assert.ok(!plan.blocks.some((b) => b.parentId === mine().find((x) => x.title === 'Radeln')!.id));

  // schon heute gemacht → eine Einheit weniger (außer sonntagabends: dann beginnt der Plan mit der neuen Woche)
  goals.logGoal(lukas.user.id, g.id, 1, today());
  const newWeek = plan.from > today() && goals.weekStart(plan.from) === plan.from;
  const n = newWeek ? 3 : 2;
  assert.equal(buildWeekPlan(user()).blocks.filter((b) => b.parentId === g.id).length, n);

  // Übernehmen legt To-dos mit Zeit an, Rückgängig nimmt sie zurück
  const clean = cleanBlocks(lukas.user.id, buildWeekPlan(user()).blocks.filter((b) => b.parentId === g.id));
  assert.equal(clean.length, n);
  assert.ok(clean.every((b) => b.why === 'goal' && b.subject === null));
  const done = perform(user(), 'week_plan.apply', { blocks: clean }, { source: 'chat', confirm: false });
  assert.equal(done.status, 'done');
  const items = listItems(lukas.user.id, {}).filter((i) => i.parentId === g.id);
  assert.equal(items.length, n);
  assert.ok(items.every((i) => i.kind === 'todo' && i.time && i.due));
  // bereits eingeplante Blöcke werden nicht ein zweites Mal vorgeschlagen
  assert.equal(buildWeekPlan(user()).blocks.filter((b) => b.parentId === g.id).length, 0);
  if (done.status === 'done') undo(lukas.user.id, done.actionId);
  assert.equal(listItems(lukas.user.id, {}).filter((i) => i.parentId === g.id).length, 0);

  // fremde Ziele und Fantasie-IDs lässt cleanBlocks nicht durch
  assert.equal(cleanBlocks(mia.user.id, clean).length, 0);
  assert.equal(cleanBlocks(lukas.user.id, [{ ...clean[0], parentId: 'gibt-es-nicht' }]).length, 0);
});

test('Hinweise: Ziel ohne Eintrag seit zwei Wochen; Gedächtnis „Ziel“ wird einmal als Ziel angeboten', () => {
  const old = goals.createGoal(lukas.user.id, goals.cleanGoal({ title: 'Spanisch lernen', cadence: 'weekly:2', target: 2 }));
  db.prepare('UPDATE goals SET created_at = ? WHERE id = ?').run(new Date(Date.now() - 30 * 86_400_000).toISOString(), old.id);
  const fresh = goals.createGoal(lukas.user.id, goals.cleanGoal({ title: 'Brandneu', cadence: 'weekly:2', target: 2 }));
  const stale = findHints(user()).filter((h) => h.key.startsWith('goal_stale:'));
  assert.ok(stale.some((h) => h.key.includes(old.id) && /Spanisch lernen/.test(h.text) && h.open?.tab === 'goals'));
  assert.ok(!stale.some((h) => h.key.includes(fresh.id)), 'neue Ziele werden nicht angemahnt');
  goals.logGoal(lukas.user.id, old.id, 1, addDays(today(), -3));
  assert.ok(!findHints(user()).some((h) => h.key.includes(old.id)), 'mit einem Eintrag in den letzten 14 Tagen ist Ruhe');

  addMemory(lukas.user.id, { category: 'goal', text: 'Will dreimal pro Woche schwimmen gehen', source: 'user' });
  const offer = findHints(user()).find((h) => h.key.startsWith('goal_memory:'))!;
  assert.ok(offer, 'Vorschlag aus dem Gedächtnis');
  assert.equal(offer.action!.type, 'goal.create');
  assert.match((offer.action!.params as { title: string }).title, /schwimmen/i);

  // schon als Ziel vorhanden → kein Vorschlag mehr
  goals.createGoal(lukas.user.id, goals.cleanGoal({ title: (offer.action!.params as { title: string }).title }));
  assert.ok(!findHints(user()).some((h) => h.key.startsWith('goal_memory:')));
});

test('Briefing: sonntags der Wochenrückblick, sonst nichts', () => {
  const sunday = '2026-11-01';
  const lines = goals.goalBriefingLines(user(), sunday);
  assert.ok(lines.some((l) => /^Laufen gehen: \d× von 3×/.test(l)));
  assert.ok(lines.some((l) => /^Radeln: .* km von 20 km/.test(l)));
  assert.deepEqual(goals.goalBriefingLines(user(), '2026-10-30'), [], 'Freitag: kein Rückblick');
  assert.ok(buildBriefing(user()).sections.every((s) => s.id !== 'goals') || todayIn(user().timeZone) === goals.weekStart(today()) , 'im normalen Briefing nur sonntags');
});

test('Ziele-Routen: anlegen, Fortschritt, bearbeiten, pausieren, löschen – fremde nicht', async () => {
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) => reply.code(err instanceof HttpError ? err.status : 500).send({ error: (err as Error).message }));
  await app.register(async (api) => { api.addHook('preHandler', requireUser); goals.registerGoalRoutes(api); });
  await app.ready();
  const as = (t: string) => ({ authorization: `Bearer ${t}` });

  const created = await app.inject({ method: 'POST', url: '/api/goals', headers: as(lukas.token), payload: { title: 'wasser trinken', cadence: 'daily', target: 2, unit: 'Liter', metric: 'Liter' } });
  assert.equal(created.statusCode, 200);
  const g = created.json().goal;
  assert.equal(g.title, 'Wasser trinken');
  assert.equal(g.weekTarget, 14);
  assert.equal((await app.inject({ method: 'POST', url: '/api/goals', headers: as(lukas.token), payload: { title: ' ' } })).statusCode, 400);

  const log = await app.inject({ method: 'POST', url: `/api/goals/${g.id}/log`, headers: as(lukas.token), payload: { value: '1,5', note: 'viel Tee' } });
  assert.equal(log.json().goal.weekValue, 1.5);
  assert.equal(log.json().goal.recent[0].note, 'viel Tee');
  assert.equal((await app.inject({ method: 'POST', url: `/api/goals/${g.id}/log`, headers: as(lukas.token), payload: { value: -3 } })).statusCode, 400);
  const future = await app.inject({ method: 'POST', url: `/api/goals/${g.id}/log`, headers: as(lukas.token), payload: { value: 1, date: '2999-01-01' } });
  assert.equal(future.json().goal.recent[0].date, today(), 'Zukunft zählt nicht');

  const edit = await app.inject({ method: 'PATCH', url: `/api/goals/${g.id}`, headers: as(lukas.token), payload: { title: 'Mehr Wasser trinken', status: 'paused', checkIn: '20:00' } });
  assert.equal(edit.json().goal.title, 'Mehr Wasser trinken');
  assert.equal(edit.json().goal.status, 'paused');
  assert.equal(edit.json().goal.checkIn, '20:00');
  assert.equal(edit.json().goal.weekValue, 2.5, 'Fortschritt bleibt beim Bearbeiten');

  assert.equal((await app.inject({ method: 'GET', url: '/api/goals', headers: as(mia.token) })).json().goals.length, 0, 'Mia sieht Lukas’ Ziele nicht');
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/goals/${g.id}`, headers: as(mia.token), payload: { title: 'Meins' } })).statusCode, 404);
  assert.equal((await app.inject({ method: 'POST', url: `/api/goals/${g.id}/log`, headers: as(mia.token), payload: { value: 1 } })).statusCode, 404);
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/goals/${g.id}`, headers: as(mia.token) })).statusCode, 404);

  const entry = log.json().goal.recent[0].id;
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/goal-logs/${entry}`, headers: as(mia.token) })).statusCode, 404);
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/goal-logs/${entry}`, headers: as(lukas.token) })).statusCode, 200);

  assert.equal((await app.inject({ method: 'DELETE', url: `/api/goals/${g.id}`, headers: as(lukas.token) })).statusCode, 200);
  assert.ok(!(await app.inject({ method: 'GET', url: '/api/goals', headers: as(lukas.token) })).json().goals.some((x: { id: string }) => x.id === g.id));
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM goal_logs WHERE goal_id = ?').get(g.id) as { n: number }).n, 0, 'Einträge verschwinden mit dem Ziel');
  await app.close();
});
