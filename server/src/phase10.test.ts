import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

// Mock: nur der Agent (OpenRouter), alles andere läuft ohne KI
const mock = createServer((req, res) => {
  req.on('data', () => {});
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/models') { res.end(JSON.stringify({ data: [{ id: 'good/model:free', supported_parameters: ['tools'] }] })); return; }
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Das weiß ich nicht.' } }] }));
  });
});
await new Promise<void>((r) => mock.listen(0, r));
after(() => mock.close());
const base = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;

process.env.STELLA_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'stella-p10-'));
process.env.STELLA_SECRET = 'test-secret-1234567890';
process.env.STELLA_ALLOW_REGISTRATION = 'true';
process.env.OPENROUTER_API_KEY = 'test';
process.env.OPENROUTER_BASE_URL = base;

const { register, requireUser, HttpError } = await import('./auth.ts');
const { db, getItem, getUser, listItems, recentMessages } = await import('./db.ts');
const { handleChat } = await import('./assistant.ts');
const { levelFor, perform, undo } = await import('./actions.ts');
const { addItem, changeItem } = await import('./planner.ts');
const { sendDueReminders } = await import('./scheduler.ts');
const { maybeSendBriefing } = await import('./briefing.ts');
const { cleanGoal, createGoal, getGoal, sendGoalCheckIns } = await import('./goals.ts');
const { buildStellaPlan, registerStellaPlanRoutes } = await import('./stellaplan.ts');
const { addDays, nextOccurrence, timeIn, todayIn } = await import('@stella/shared');
const Fastify = (await import('fastify')).default;

const lukas = register('Lukas', 'lukas@example.com', 'supergeheim', 'Europe/Vienna');
const mia = register('Mia', 'mia@example.com', 'supergeheim', 'Europe/Vienna');
const user = () => getUser(lukas.user.id)!;
const today = () => todayIn(user().timeZone);
const say = (text: string) => handleChat(user(), text, null);
const unsent = (itemId: string) => db.prepare('SELECT fire_at FROM reminders WHERE item_id = ? AND sent_at IS NULL ORDER BY fire_at').all(itemId) as { fire_at: string }[];
const pastReminder = (itemId: string) => db.prepare('UPDATE reminders SET fire_at = ? WHERE item_id = ? AND sent_at IS NULL').run(new Date(Date.now() - 60_000).toISOString(), itemId);
const recurringItems = () => listItems(lukas.user.id, { kind: 'reminder' }).filter((i) => i.recurrence);

const app = Fastify();
app.setErrorHandler((err, _req, reply) => reply.code(err instanceof HttpError ? err.status : 500).send({ error: (err as Error).message }));
await app.register(async (api) => { api.addHook('preHandler', requireUser); registerStellaPlanRoutes(api); });
await app.ready();
const as = (t: string) => ({ authorization: `Bearer ${t}` });
const change = (id: string, payload: Record<string, unknown>, token = lukas.token) =>
  app.inject({ method: 'POST', url: `/api/stella/plan/${encodeURIComponent(id)}`, headers: as(token), payload });
const plan = async (token = lukas.token) => (await app.inject({ method: 'GET', url: '/api/stella/plan', headers: as(token) })).json() as { entries: { id: string; kind: string; group: string; title: string; when: string; at: string | null; enabled: boolean; controls: { type: string; on?: boolean; value?: string }[] }[]; soon: { id: string; at: string }[] };

test('Dauerauftrag im Chat: „erinnere mich jeden Montag an den Müll“ → Eintrag mit Rhythmus, erste Erinnerung am nächsten Montag', async () => {
  const r = await say('erinnere mich jeden Montag an den Müll');
  assert.match(r.messages[0]!.text, /jeden Montag um 08:00/);
  assert.ok(r.messages[0]!.actionId, 'Karte mit Rückgängig');
  const item = recurringItems().find((i) => i.title === 'Müll')!;
  assert.equal(item.recurrence, 'weekly:1');
  assert.equal(item.time, '08:00');
  assert.equal(item.recurrencePaused, false);
  assert.equal(item.due, nextOccurrence('weekly:1', item.due!), 'ein Montag');
  assert.ok(item.due! >= today());
  assert.equal(unsent(item.id).length, 1, 'eine Erinnerung ist eingeplant');

  const daily = await say('jeden Tag um 8 Tabletten');
  assert.match(daily.messages[0]!.text, /täglich um 08:00/);
  const pills = recurringItems().find((i) => i.title === 'Tabletten')!;
  assert.equal(pills.recurrence, 'daily');
  // 8 Uhr schon vorbei → erst morgen
  assert.equal(pills.due, '08:00' > timeIn(user().timeZone) ? today() : addDays(today(), 1));

  undo(lukas.user.id, daily.messages[0]!.actionId!);
  assert.ok(!recurringItems().some((i) => i.title === 'Tabletten'), 'Rückgängig nimmt den Dauerauftrag zurück');
});

test('Scheduler: nach dem Erinnern rückt der Dauerauftrag zum nächsten Termin vor und plant die nächste Erinnerung', async () => {
  const item = recurringItems().find((i) => i.title === 'Müll')!;
  const firstDue = item.due!;
  const before = recentMessages(lukas.user.id, 500).length;
  pastReminder(item.id);
  await sendDueReminders();
  const sent = recentMessages(lukas.user.id, 500).slice(before).filter((m) => m.role === 'assistant' && m.text.includes('Müll'));
  assert.equal(sent.length, 1, 'die Erinnerung kam');

  const next = getItem(lukas.user.id, item.id)!;
  assert.equal(next.status, 'open', 'bleibt offen');
  assert.ok(next.due! > firstDue || firstDue >= addDays(today(), 1) === false || next.due! >= addDays(today(), 1));
  assert.ok(next.due! >= addDays(today(), 1), 'frühestens ab morgen');
  assert.equal(next.due, nextOccurrence('weekly:1', next.due!), 'wieder ein Montag');
  const future = unsent(item.id);
  assert.equal(future.length, 1, 'genau eine neue Erinnerung');
  assert.ok(Date.parse(future[0]!.fire_at) > Date.now());

  // zweiter Durchlauf: wieder ein Montag weiter, nie doppelt
  const dueAfterFirst = next.due!;
  pastReminder(item.id);
  await sendDueReminders();
  const again = getItem(lukas.user.id, item.id)!;
  assert.equal(again.due, nextOccurrence('weekly:1', addDays(dueAfterFirst, 1)), 'genau eine Woche später');
  assert.equal(unsent(item.id).length, 1);
});

test('Täglich und monatlich rücken richtig vor; „erledigt“ heißt: dieses Mal erledigt', async () => {
  const daily = addItem(user(), { kind: 'reminder', title: 'Wasser trinken', due: today(), time: '00:01', recurrence: 'daily', source: 'chat' });
  assert.equal(unsent(daily.id).length, 0, '00:01 heute ist schon vorbei');
  pastReminder(daily.id);
  changeItem(user(), daily.id, { status: 'done' });
  const doneOnce = getItem(lukas.user.id, daily.id)!;
  assert.equal(doneOnce.status, 'open');
  assert.equal(doneOnce.due, addDays(today(), 1), 'abgehakt → morgen wieder');
  assert.equal(unsent(daily.id).length, 1);

  const monthly = addItem(user(), { kind: 'reminder', title: 'Miete', due: nextOccurrence('monthly:31', today()), time: '09:00', recurrence: 'monthly:31', source: 'chat' });
  changeItem(user(), monthly.id, { status: 'done' });
  const moved = getItem(lukas.user.id, monthly.id)!;
  assert.ok(moved.due! > today());
  assert.match(moved.due!, /-(28|29|30|31)$/, 'am Monatsende, auch in kürzeren Monaten');

  // ein normaler Eintrag wird davon nicht berührt
  const plain = addItem(user(), { kind: 'todo', title: 'Einmalig', due: addDays(today(), 3), time: '10:00', source: 'chat' });
  changeItem(user(), plain.id, { status: 'done' });
  assert.equal(getItem(lukas.user.id, plain.id)!.status, 'done');
});

test('Die Plan-Liste enthält alle Quellen, in Gruppen und mit Steuerung', async () => {
  // Quellen anlegen: Erinnerung in den nächsten Tagen, Lerneinheit, Ziel mit Check-in, Vorschlag
  const tomorrow = addDays(today(), 1);
  const remind = addItem(user(), { kind: 'reminder', title: 'Zahnarzt anrufen', due: tomorrow, time: '15:30', source: 'chat' });
  const study = addItem(user(), { kind: 'study', title: 'Lernen: Bio Test', detail: 'Mitose', due: addDays(today(), 2), time: '16:30', source: 'plan' });
  const goal = createGoal(lukas.user.id, cleanGoal({ title: 'Laufen gehen', cadence: 'weekly:3', target: 3, checkIn: 'So 18:00' }));
  const victim = addItem(user(), { kind: 'todo', title: 'Alter Kram', due: tomorrow, source: 'chat' });
  const proposed = perform(user(), 'item.delete', { id: victim.id }, { source: 'auto' });
  assert.equal(proposed.status, 'proposed');
  const müll = recurringItems().find((i) => i.title === 'Müll')!;

  const p = await plan();
  const byId = new Map(p.entries.map((e) => [e.id, e]));
  const must: [string, string, string][] = [
    ['briefing', 'briefing', 'regular'], ['weekplan', 'weekplan', 'regular'],
    ['perm:mail_sort', 'automation', 'regular'], ['perm:homework', 'automation', 'regular'], ['perm:memory', 'automation', 'regular'],
    [`recurring:${müll.id}`, 'recurring', 'regular'],
    [`item:${remind.id}`, 'reminder', 'week'], [`study:${study.id}`, 'study', 'week'],
    [`proposal:${(proposed as { actionId: string }).actionId}`, 'proposal', 'week'],
    [`goal:${goal.id}`, 'goal', 'longterm'],
  ];
  for (const [id, kind, group] of must) {
    const e = byId.get(id);
    assert.ok(e, `${id} fehlt in der Liste`);
    assert.equal(e!.kind, kind, id);
    assert.equal(e!.group, group, id);
    assert.ok(e!.controls.length > 0, `${id} hat Steuerung`);
    assert.ok(e!.when.length > 0);
  }
  assert.match(byId.get(`recurring:${müll.id}`)!.when, /jeden Montag um 08:00/);
  assert.equal(byId.get(`item:${remind.id}`)!.at, `${tomorrow} 15:30`);
  assert.match(byId.get(`item:${remind.id}`)!.when, /15:30/);
  assert.ok(byId.get(`goal:${goal.id}`)!.controls.some((c) => c.type === 'time' && c.value === '18:00'));
  assert.deepEqual(byId.get(`proposal:${(proposed as { actionId: string }).actionId}`)!.controls, [{ type: 'decision' }]);
  // Reihenfolge: zuerst „Diese Woche“, dann „Regelmäßig“, dann „Langfristig“
  const groups = p.entries.map((e) => e.group);
  assert.deepEqual([...groups].sort((a, b) => ['week', 'regular', 'longterm'].indexOf(a) - ['week', 'regular', 'longterm'].indexOf(b)), groups);
  // die nächsten drei Dinge, zeitlich sortiert
  assert.ok(p.soon.length > 0 && p.soon.length <= 3);
  assert.deepEqual(p.soon.map((e) => e.at), [...p.soon.map((e) => e.at)].sort());
  assert.ok(p.soon.every((e) => !e.id.startsWith('proposal:')));

  // Mia sieht nichts davon
  const mias = await plan(mia.token);
  assert.ok(!mias.entries.some((e) => e.id.includes(müll.id) || e.id.includes(remind.id) || e.id.includes(goal.id)));
  assert.deepEqual(mias.entries.filter((e) => e.group !== 'regular'), []);
});

test('Abschalten wirkt: Briefing, Automatiken, Wochenplan – und Rückgängig stellt es wieder her', async () => {
  assert.equal((await plan()).entries.find((e) => e.id === 'briefing')!.enabled, true);
  const off = await change('briefing', { on: false });
  assert.equal(off.statusCode, 200);
  assert.equal(user().settings.briefing, 'off');
  assert.equal((await maybeSendBriefing(lukas.user.id)), false, 'ohne Briefing wird keines verschickt');
  const entry = off.json().entries.find((e: { id: string }) => e.id === 'briefing');
  assert.equal(entry.enabled, false);
  assert.equal(entry.when, 'ausgeschaltet');
  undo(lukas.user.id, off.json().actionId);
  assert.equal(user().settings.briefing ?? 'auto', 'auto');
  assert.equal((await plan()).entries.find((e) => e.id === 'briefing')!.enabled, true);

  const time = await change('briefing', { time: '06:45' });
  assert.equal(user().settings.briefing, '06:45');
  assert.match(time.json().entries.find((e: { id: string }) => e.id === 'briefing').when, /täglich um 06:45/);
  undo(lukas.user.id, time.json().actionId);

  const mail = await change('perm:mail_sort', { on: false });
  assert.equal(levelFor(user(), 'mail_sort'), 'never');
  assert.equal(user().settings.mailAutoTrash, false, 'alter Schalter zieht mit');
  assert.equal(mail.json().entries.find((e: { id: string }) => e.id === 'perm:mail_sort').enabled, false);
  const back = await change('perm:mail_sort', { on: true });
  assert.equal(levelFor(user(), 'mail_sort'), 'auto');
  assert.equal(user().settings.mailAutoTrash, true);
  undo(lukas.user.id, back.json().actionId);
  assert.equal(levelFor(user(), 'mail_sort'), 'never', 'Rückgängig der Wiedereinschaltung');
  undo(lukas.user.id, mail.json().actionId);
  assert.equal(levelFor(user(), 'mail_sort'), 'auto');

  const memory = await change('perm:memory', { on: false });
  assert.equal(levelFor(user(), 'memory'), 'never');
  assert.equal(perform(user(), 'memory.add', { category: 'other', text: 'Test', source: 'learned' }, { source: 'auto' }).status, 'refused', 'nächtliches Lernen ist wirklich aus');
  undo(lukas.user.id, memory.json().actionId);

  const week = await change('weekplan', { on: false });
  assert.equal(user().settings.weekPlan, 'off');
  assert.equal(week.json().entries.find((e: { id: string }) => e.id === 'weekplan').enabled, false);
  await change('weekplan', { on: true });
  assert.equal(user().settings.weekPlan, 'sunday');
});

test('Dauerauftrag steuern: pausieren, Zeit ändern, löschen – jeweils mit Rückgängig', async () => {
  const item = recurringItems().find((i) => i.title === 'Müll')!;
  const id = `recurring:${item.id}`;

  const paused = await change(id, { on: false });
  assert.equal(paused.statusCode, 200);
  assert.equal(getItem(lukas.user.id, item.id)!.recurrencePaused, true);
  assert.equal(unsent(item.id).length, 0, 'pausiert → keine Erinnerung');
  const e = paused.json().entries.find((x: { id: string }) => x.id === id);
  assert.equal(e.enabled, false);
  assert.match(e.when, /pausiert/);
  assert.equal(e.at, null);
  // selbst eine „alte“ Erinnerung würde nichts mehr auslösen
  const before = recentMessages(lukas.user.id, 500).length;
  await sendDueReminders();
  assert.ok(!recentMessages(lukas.user.id, 500).slice(before).some((m) => m.text.includes('Müll')));

  const resumed = await change(id, { on: true });
  assert.equal(getItem(lukas.user.id, item.id)!.recurrencePaused, false);
  assert.equal(unsent(item.id).length, 1, 'wieder eingeplant');
  undo(lukas.user.id, resumed.json().actionId);
  assert.equal(getItem(lukas.user.id, item.id)!.recurrencePaused, true, 'Rückgängig stellt „pausiert“ wieder her');
  undo(lukas.user.id, paused.json().actionId);
  assert.equal(getItem(lukas.user.id, item.id)!.recurrencePaused, false);
  assert.equal(unsent(item.id).length, 1);

  const moved = await change(id, { time: '09:15' });
  assert.equal(getItem(lukas.user.id, item.id)!.time, '09:15');
  assert.match(moved.json().entries.find((x: { id: string }) => x.id === id).when, /um 09:15/);
  const fire = new Date(unsent(item.id)[0]!.fire_at);
  assert.equal(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(fire), '09:15', 'neue Erinnerung zur neuen Uhrzeit');
  undo(lukas.user.id, moved.json().actionId);
  assert.equal(getItem(lukas.user.id, item.id)!.time, '08:00');

  const removed = await change(id, { remove: true });
  assert.equal(getItem(lukas.user.id, item.id)!.deleted, true);
  assert.equal(unsent(item.id).length, 0);
  assert.ok(!removed.json().entries.some((x: { id: string }) => x.id === id));
  undo(lukas.user.id, removed.json().actionId);
  assert.equal(getItem(lukas.user.id, item.id)!.deleted, false);
  assert.ok((await plan()).entries.some((x) => x.id === id), 'wieder da');
});

test('Einmalige Erinnerungen und Lerneinheiten: Zeit ändern und löschen; Ziele: pausieren und Check-in-Zeit', async () => {
  const p = await plan();
  const remind = p.entries.find((e) => e.kind === 'reminder' && e.title === 'Zahnarzt anrufen')!;
  const t = await change(remind.id, { time: '16:00' });
  assert.equal(t.json().entries.find((e: { id: string }) => e.id === remind.id).at?.endsWith('16:00'), true);
  const gone = await change(remind.id, { remove: true });
  assert.ok(!gone.json().entries.some((e: { id: string }) => e.id === remind.id));

  const study = p.entries.find((e) => e.kind === 'study')!;
  assert.equal((await change(study.id, { remove: true })).statusCode, 200);

  const goal = p.entries.find((e) => e.kind === 'goal')!;
  const gid = goal.id.slice(5);
  const slow = await change(goal.id, { time: '19:30' });
  assert.equal(getGoal(lukas.user.id, gid)!.checkIn, 'So 19:30', 'der Wochentag bleibt');
  undo(lukas.user.id, slow.json().actionId);
  assert.equal(getGoal(lukas.user.id, gid)!.checkIn, 'So 18:00');
  const off = await change(goal.id, { on: false });
  assert.equal(getGoal(lukas.user.id, gid)!.status, 'paused');
  assert.equal(off.json().entries.find((e: { id: string }) => e.id === goal.id).enabled, false);
  // ein pausiertes Ziel erinnert nicht
  db.prepare('UPDATE goals SET check_in = ? WHERE id = ?').run('00:00', gid);
  const msgs = recentMessages(lukas.user.id, 500).length;
  await sendGoalCheckIns(lukas.user.id);
  assert.equal(recentMessages(lukas.user.id, 500).length, msgs);
  undo(lukas.user.id, off.json().actionId);
  assert.equal(getGoal(lukas.user.id, gid)!.status, 'active');
});

test('Fehler: ungültige Uhrzeit, nichts zu ändern, Unbekanntes, fremde Einträge', async () => {
  const item = recurringItems().find((i) => i.title === 'Müll')!;
  assert.equal((await change(`recurring:${item.id}`, { time: '25:61' })).statusCode, 400);
  assert.equal((await change(`recurring:${item.id}`, {})).statusCode, 400);
  assert.equal((await change('recurring:gibt-es-nicht', { on: false })).statusCode, 404);
  assert.equal((await change('quatsch', { on: false })).statusCode, 404);
  assert.equal((await change('perm:delete', { on: false })).statusCode, 404, 'nur die drei Automatiken');
  assert.equal((await change(`recurring:${item.id}`, { on: false }, mia.token)).statusCode, 404, 'Mia kommt nicht an Lukas’ Dauerauftrag');
  assert.equal(getItem(lukas.user.id, item.id)!.recurrencePaused, false);
  // ein normaler Eintrag ist kein Dauerauftrag
  const plain = addItem(user(), { kind: 'reminder', title: 'Einmal', due: addDays(today(), 2), time: '10:00', source: 'chat' });
  assert.equal((await change(`recurring:${plain.id}`, { on: false })).statusCode, 404);
});
