import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installMocks } from './mocks.mjs';

const extension = resolve(process.env.SMOKE_EXT || 'dist');
const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/intro');
mkdirSync(out, { recursive: true });
const results = [];
for (const [name, flags, force, theme] of [
  ['software', ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'], false, 'dark'],
  ['webgl', ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'], true, 'dark'],
  ['webgl-light', ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'], true, 'light'],
  ['no-webgl', ['--disable-webgl'], false, 'light'],
]) {
  if (process.env.INTRO_ONLY && name !== process.env.INTRO_ONLY) continue;
  const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-intro-')), {
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
    headless: true, args: ['--headless=new', '--no-sandbox', ...flags, `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference',
  });
  try {
    await installMocks(context);
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const seed = patch => worker.evaluate(({ patch, theme }) => chrome.storage.local.set({ 'margin:settings': {
      intro: true, reduceMotion: false, theme, bg: { mode: 'off' }, ...patch,
    } }), { patch, theme });
    await seed({});
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(force => { if (force) localStorage.setItem('margin:force-gl', '1'); }, force);
    await page.goto('https://www.bilibili.com/', { waitUntil: 'domcontentloaded' });
    const intro = page.locator('#margin-root .intro').last();
    await page.locator('#margin-root .intro canvas').waitFor();
    await page.waitForTimeout(700);
    assert(await intro.evaluate(el => Number(getComputedStyle(el).opacity) > .5), 'opening animation was skipped');
    await page.screenshot({ path: join(out, `${name}.png`) });
    await intro.waitFor({ state: 'detached', timeout: 10000 });
    await page.locator('#margin-root .intro-fly').waitFor({ state: 'detached' });
    assert(await page.locator('#margin-root .top .brand .tv').isVisible());
    assert.deepEqual(errors, []);
    await page.reload();
    await page.locator('#margin-root .main .hero-search').waitFor();
    await page.waitForTimeout(500);
    assert.equal(await page.locator('#margin-root .intro').count(), 0, 'same-session reload replayed intro');
    await page.evaluate(() => sessionStorage.removeItem('margin:intro-played'));
    await page.reload();
    await page.locator('#margin-root .intro canvas').waitFor();
    const skippedAt = Date.now();
    await page.keyboard.press('Escape');
    await page.locator('#margin-root .intro').waitFor({ state: 'detached', timeout: 3000 });
    const skipMs = Date.now() - skippedAt;
    await page.evaluate(() => sessionStorage.removeItem('margin:intro-played'));
    await seed({ intro: false });
    await page.reload();
    await page.locator('#margin-root .main .hero-search').waitFor();
    assert.equal(await page.locator('#margin-root .intro').count(), 0);
    await seed({ reduceMotion: true });
    await page.reload();
    await page.locator('#margin-root .main .hero-search').waitFor();
    assert.equal(await page.locator('#margin-root .intro').count(), 0);
    await seed({});
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    await page.locator('#margin-root .main .hero-search').waitFor();
    assert.equal(await page.locator('#margin-root .intro').count(), 0);
    assert.deepEqual(errors, []);
    results.push({ name, ok: true, skipMs }); console.log(`PASS ${name}: animation, cleanup, reload, skip (${skipMs}ms) and settings`);
  } catch (error) {
    results.push({ name, ok: false, error: error.message }); console.log(`FAIL ${name}: ${error.message}`);
  } finally { await context.close(); }
}
writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2));
if (results.some(result => !result.ok)) process.exitCode = 1;
