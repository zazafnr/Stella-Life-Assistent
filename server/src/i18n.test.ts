import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.STELLA_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'stella-i18n-'));
process.env.STELLA_SECRET = 'test-secret-1234567890';

const { register } = await import('./auth.ts');
const { getUser, updateUserSettings } = await import('./db.ts');
const { handleChat, systemPrompt } = await import('./assistant.ts');
const { buildBriefing } = await import('./briefing.ts');
const { userLocale } = await import('./locale.ts');

const { user: created } = register('Mia', 'mia@example.com', 'supergeheim', 'Europe/Vienna');
updateUserSettings(created.id, { locale: 'en', country: 'GB', tone: 'nett' });
const user = () => getUser(created.id)!;

test('Konto ohne Sprache startet mit Englisch (außer der Betreiber setzt STELLA_DEFAULT_LOCALE)', () => {
  assert.equal(userLocale({ settings: {} }), process.env.STELLA_DEFAULT_LOCALE ?? 'en');
  assert.equal(userLocale(user()), 'en');
});

test('Englisch im Chat: Kurznotiz, Erinnerung, Einkaufsliste, Rückgängig – alles in der Sprache der Nutzerin', async () => {
  const hw = await handleChat(user(), 'math homework p. 45 no. 3 friday', 'e1');
  assert.match(hw.messages[0]!.text, /Noted: \*\*Math Homework\*\* – p\. 45 no\. 3, due .*(Fri|tomorrow)/i);
  assert.equal(hw.items[0]!.kind, 'homework');

  const remind = await handleChat(user(), 'remind me tomorrow at 5pm to call grandma', 'e2');
  assert.match(remind.messages[0]!.text, /On it! I'll remind you tomorrow at 17:00 about "Call grandma"/);

  const list = await handleChat(user(), 'add milk and eggs to the shopping list', 'e3');
  assert.match(list.messages[0]!.text, /Added to the shopping list: Milk, Eggs/);
  const show = await handleChat(user(), "what's on the shopping list?", 'e4');
  assert.match(show.messages[0]!.text, /\*\*Shopping list\*\* \(2\)/);

  const undone = await handleChat(user(), 'undo', 'e5');
  assert.match(undone.messages[0]!.text, /Undone|can't find anything/);

  const agenda = await handleChat(user(), "what's up?", 'e6');
  assert.match(agenda.messages[0]!.text, /Math Homework/);
  assert.ok(!/[äöüß]/.test(`${hw.messages[0]!.text}${remind.messages[0]!.text}${list.messages[0]!.text}${agenda.messages[0]!.text}`), 'kein deutscher Text');
});

test('Briefing auf Englisch: Gruß mit englischem Wochentag, Abschnitte aus dem Katalog', () => {
  const b = buildBriefing(user());
  assert.match(b.greeting, /Good morning, Mia! Your (Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday):/);
  assert.ok(b.sections.every((s) => !/[äöüß]/.test(s.title)), 'Titel englisch');
});

test('Sprachregel im System-Prompt: Antwort in der Sprache der Nutzerin, englischer Prompt', () => {
  const p = systemPrompt(user(), '2026-11-04');
  assert.match(p.fixed, /Always reply in English/);
  assert.ok(!p.fixed.includes('Now:'), 'Datum/Uhrzeit nur im veränderlichen Teil');
  updateUserSettings(created.id, { locale: 'tr' });
  assert.match(systemPrompt(user(), '2026-11-04').fixed, /Always reply in Turkish/);
  updateUserSettings(created.id, { locale: 'en' });
});

test('Türkisch hat keinen Schnellweg: die Nachricht geht an die KI (hier: nicht erreichbar → freundlicher Hinweis)', async () => {
  updateUserSettings(created.id, { locale: 'tr' });
  const res = await handleChat(user(), 'matematik ödevi sayfa 45 cuma', 'tr1');
  assert.equal(res.items.length, 0, 'keine Kurznotiz erkannt');
  updateUserSettings(created.id, { locale: 'en' });
});
