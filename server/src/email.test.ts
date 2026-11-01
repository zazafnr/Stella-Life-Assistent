import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';

process.env.STELLA_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'stella-email-'));
process.env.STELLA_SECRET = 'test-secret-1234567890';

const { LOCALES, missingKeys } = await import('@stella/shared');
const { renderTemplate, SAMPLE, TEMPLATE_NAMES } = await import('./email/templates.ts');
const { renderEmail } = await import('./email/layout.ts');
const { markdownToEmail } = await import('./email/markdown.ts');
const { checkUndoToken, undoToken, registerUndoRoutes } = await import('./email/undo.ts');
const { register } = await import('./auth.ts');
const { db, getUser, updateUserSettings } = await import('./db.ts');
const { perform, getAction } = await import('./actions.ts');

test('jede Vorlage rendert in allen acht Sprachen: ohne fehlende Schlüssel, ohne Platzhalter-Reste, mit Textversion', () => {
  missingKeys.clear();
  for (const locale of LOCALES) {
    for (const name of TEMPLATE_NAMES) {
      for (const data of name === 'subscription'
        ? (['started', 'changed', 'cancelled'] as const).map((event) => ({ ...SAMPLE, event }))
        : name === 'login-link' ? [{ ...SAMPLE, purpose: 'login' as const }, { ...SAMPLE, purpose: 'reset' as const }] : [SAMPLE]) {
        const mail = renderTemplate(name, locale, data);
        const where = `${locale}/${name}`;
        assert.ok(name === 'stella-reply' || mail.subject.length > 3, `${where}: Betreff fehlt`);
        assert.ok(mail.html.startsWith('<!doctype html>') && mail.html.includes(`<html lang="${locale}"`), `${where}: HTML-Grundgerüst`);
        assert.ok(/\{\w+\}/.test(mail.html) === false && /\{\w+\}/.test(mail.text) === false, `${where}: Platzhalter-Rest`);
        assert.ok(!/\bundefined\b|\[object/.test(mail.html + mail.text), `${where}: undefined im Text`);
        assert.ok(mail.text.includes('Stella by EVOLSIOR · Built to become'), `${where}: Fuß in der Textversion`);
        assert.ok(mail.html.includes('color-scheme') && mail.html.includes('prefers-color-scheme: dark'), `${where}: dunkle Variante`);
        assert.ok(!/<img[^>]+\.svg/i.test(mail.html), `${where}: keine SVG-Bilder (Gmail)`);
        assert.ok(!/\p{Extended_Pictographic}/u.test(mail.html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<title>[\s\S]*?<\/title>/, '')), `${where}: Emojis in der Mail`);
        assert.ok(/<img[^>]+alt="[^"]+"/.test(mail.html), `${where}: Bild mit Alt-Text`);
      }
    }
  }
  assert.deepEqual([...missingKeys], [], 'fehlende Schlüssel');
});

test('Textversion enthält Link bzw. Code, der Knopf hat die VML-Variante für Outlook', () => {
  const signup = renderTemplate('verify-signup', 'en', SAMPLE);
  assert.match(signup.text, /https:\/\/login\.stella\.evolsior\.com\/v\/EXAMPLE-TOKEN/);
  assert.match(signup.text, /\n\s{4}482913\n/);
  assert.match(signup.html, /<!--\[if mso\]>[\s\S]*v:roundrect/);
  assert.match(signup.html, /class="btn"/);
  const onlyCode = renderTemplate('verify-signup', 'de', { name: 'Mia', code: '123456' });
  assert.ok(!onlyCode.html.includes('class="btn"'), 'ohne Link kein Knopf');
  assert.match(onlyCode.text, /\n\s{4}123456\n/);
});

test('kein ungeescapter Nutzertext im HTML (Name mit <script>, Antwort mit HTML und javascript:-Link)', () => {
  const evil = '<script>alert(1)</script>';
  for (const name of TEMPLATE_NAMES) {
    const mail = renderTemplate(name, 'en', { ...SAMPLE, name: evil, email: `${evil}@x.at`, replyText: `${evil}\n[klick](javascript:alert(1))\n<img src=x onerror=alert(1)>`, actions: [evil], plan: evil });
    assert.ok(!mail.html.includes('<script>alert'), `${name}: <script> im HTML`);
    assert.ok(!/href="javascript:/i.test(mail.html), `${name}: javascript:-Link`);
    assert.ok(!/<img src=x/i.test(mail.html), `${name}: eingeschleuste Bild-Tags`);
  }
  const md = markdownToEmail('**fett** und _kursiv_\n\n- eins\n- zwei\n\n[Seite](https://example.com/a?x=1&y=2) und https://example.org');
  assert.match(md.html, /<strong[^>]*>fett<\/strong>/);
  assert.match(md.html, /<ul[\s\S]*<li[^>]*>eins<\/li>/);
  assert.match(md.html, /href="https:\/\/example\.com\/a\?x=1&amp;y=2"/);
  assert.equal(md.text.includes('**'), false);
});

test('Stella-Antwort: Karten „Das habe ich getan“ und Rückgängig-Knopf mit signiertem Link', () => {
  const mail = renderTemplate('stella-reply', 'de', { replyText: 'Eingetragen.', actions: ['Mathe-Schularbeit · Do, 12.11.'], undoUrl: 'https://stella.evolsior.com/api/mail/undo/abc.def' });
  assert.match(mail.html, /Erledigt/);
  assert.match(mail.html, /Mathe-Schularbeit · Do, 12\.11\./);
  assert.match(mail.html, /href="https:\/\/stella\.evolsior\.com\/api\/mail\/undo\/abc\.def"[^>]*>Rückgängig machen</);
  assert.match(mail.text, /Rückgängig machen: https:\/\/stella\.evolsior\.com\/api\/mail\/undo\/abc\.def/);
});

const { user } = register('Lukas', 'l@example.com', 'supergeheim', 'Europe/Vienna');
updateUserSettings(user.id, { locale: 'de' });
const app = Fastify({ maxParamLength: 1000 });
registerUndoRoutes(app);
await app.ready();
after(() => app.close());

test('Rückgängig-Link: Signatur prüfen (403), Ablauf freundlich (410), GET löst nichts aus, POST macht es rückgängig', async () => {
  const u = getUser(user.id)!;
  const r = perform(u, 'item.create', { kind: 'todo', title: 'Müll', due: '2026-12-01', source: 'chat' }, { source: 'chat', quiet: true });
  assert.equal(r.status, 'done');
  const id = r.actionId!;
  const token = undoToken(u.id, [id]);
  assert.equal(checkUndoToken(token).ok, true);

  // falsche Signatur
  const bad = await app.inject({ method: 'GET', url: `/api/mail/undo/${token.slice(0, -2)}xx` });
  assert.equal(bad.statusCode, 403);
  assert.match(bad.body, /funktioniert nicht|does not work/);
  assert.equal((await app.inject({ method: 'POST', url: `/api/mail/undo/${token.slice(0, -2)}xx` })).statusCode, 403);

  // abgelaufen (8 Tage her ausgestellt)
  const old = undoToken(u.id, [id], 7, Date.now() - 8 * 86_400_000);
  assert.deepEqual(checkUndoToken(old), { ok: false, reason: 'expired' });
  const expired = await app.inject({ method: 'GET', url: `/api/mail/undo/${old}` });
  assert.equal(expired.statusCode, 410);
  assert.match(expired.body, /abgelaufen|expired/);

  // GET zeigt nur die Bestätigung – Mail-Scanner dürfen nichts auslösen
  const page = await app.inject({ method: 'GET', url: `/api/mail/undo/${token}` });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /Rückgängig machen\?/);
  assert.match(page.body, /<form method="post"/);
  assert.equal(getAction(u.id, id)!.status, 'done', 'GET hat nichts rückgängig gemacht');

  // POST (Knopf) macht es rückgängig – als Formular, wie der Browser es schickt
  const done = await app.inject({ method: 'POST', url: `/api/mail/undo/${token}`, headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: '' });
  assert.equal(done.statusCode, 200);
  assert.match(done.body, /Rückgängig gemacht/);
  assert.equal(getAction(u.id, id)!.status, 'undone');
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM items WHERE user_id = ? AND title = 'Müll' AND deleted = 0").get(u.id) as { n: number }).n, 0);

  // noch einmal: freundlich, kein Fehler
  const again = await app.inject({ method: 'POST', url: `/api/mail/undo/${token}`, headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: '' });
  assert.equal(again.statusCode, 200);
  assert.match(again.body, /schon rückgängig|already undone/);
});

test('Layout im Browser: kein seitliches Scrollen am Handy, Knopf in voller Breite, hell und dunkel', async () => {
  let playwright: typeof import('playwright');
  try { playwright = await import('playwright'); } catch { return; }
  let browser;
  try { browser = await playwright.chromium.launch({ executablePath: process.env.STELLA_CHROMIUM_PATH || undefined }); } catch { return; }
  try {
    const shots = path.join(process.env.STELLA_DATA_DIR!, 'mail-shots');
    mkdirSync(shots, { recursive: true });
    for (const name of TEMPLATE_NAMES) {
      const mail = renderTemplate(name, 'en', SAMPLE);
      for (const [width, scheme] of [[375, 'light'], [375, 'dark'], [900, 'light']] as const) {
        const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
        const page = await ctx.newPage();
        await page.route(/^https?:.*/, (r) => r.abort()); // Bilder und Schriften nicht laden: Layout muss auch ohne Bilder stehen
        await page.setContent(mail.html);
        const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
          bg: getComputedStyle(document.querySelector('td.card')!).backgroundColor, btn: document.querySelector('a.btn')?.getBoundingClientRect().width ?? null }));
        assert.ok(m.sw <= m.cw + 1, `${name} @${width}: seitliches Scrollen (${m.sw} > ${m.cw})`);
        assert.equal(m.bg, scheme === 'dark' ? 'rgb(24, 24, 27)' : 'rgb(255, 255, 255)', `${name} ${scheme}: Kartenfarbe`);
        if (m.btn !== null && width === 375) assert.ok(m.btn > 270, `${name}: Knopf auf dem Handy zu schmal (${m.btn})`);
        if (name === 'welcome' || name === 'verify-signup') await page.screenshot({ path: path.join(shots, `${name}-${width}-${scheme}.png`), fullPage: true });
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }
});
