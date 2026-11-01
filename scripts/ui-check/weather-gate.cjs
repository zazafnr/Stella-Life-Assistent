// Wetter nur in der PC-App: Browser ohne Wetter, PC-App (window.stellaDesktop) mit gemaltem Wetter und Chip.
// Aufruf: node scripts/ui-check/weather-gate.cjs   (Chromium aus Playwright oder CHROME_PATH)
const { chromium } = require('playwright');
const { BASE, login, weatherState, check, done } = require('./common.cjs');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
  for (const mode of ['browser', 'desktop']) {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    if (mode === 'desktop') await page.addInitScript(() => { window.stellaDesktop = { platform: 'win32', notify() {}, setBadge() {}, setTitleBarColor() {} }; });
    await page.goto(BASE + '/');
    await login(page, { tab: 'chat', weather: 'rain' });
    const w = await weatherState(page);
    if (mode === 'browser') {
      check('Browser: keine Wetter-Leinwand', !w.canvas);
      check('Browser: kein Wetter-Chip', !w.chip);
    } else {
      check('PC-App: Klasse is-desktop', w.desktopClass);
      check('PC-App: Wetter-Leinwand gemalt', w.canvas && w.painted > 100, `${w.painted} Punkte`);
      check('PC-App: Wetter-Chip', !!w.chip, w.chip || '');
    }
    await page.goto(BASE + '/#settings'); await page.reload(); await page.waitForTimeout(2000);
    const s = await page.locator('text=Wetter-Animation').count();
    check(`${mode}: Wetter-Einstellung ${mode === 'desktop' ? 'sichtbar' : 'versteckt'}`, mode === 'desktop' ? s > 0 : s === 0);
    check(`${mode}: keine Skriptfehler`, errors.length === 0, errors.join(' | '));
    await page.screenshot({ path: `/tmp/ui-check-${mode}.png` });
  }
  await browser.close();
  done();
})();
