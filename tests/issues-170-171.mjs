import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { installMocks } from './mocks.mjs';

const ext = resolve(process.env.SMOKE_EXT || 'dist');
const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/issues-170-171');
mkdirSync(out, { recursive: true });
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-170-171-')), {
  channel: 'chromium', headless: true, viewport: { width: 1452, height: 730 }, deviceScaleFactor: 2,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const checks = [], errors = [];
let hot = true;
try {
  await installMocks(context, address => {
    if (new URL(address).pathname.endsWith('/search/square')) return { code: 0, data: { trending: { list: hot ? [
      { keyword: '主题与文字回归检查', show_name: '主题与文字回归检查' },
      { keyword: '第二条热搜', show_name: '第二条热搜' },
    ] : [] } } };
  });
  await context.route('https://live.bilibili.com/3', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body:
    '<!doctype html><body><div class="live-room-app"><main class="app-content" style="min-height:1600px"><div id="player-ctnr">原生播放器</div></main></div>' }));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const seed = patch => worker.evaluate(patch => chrome.storage.local.set({ 'margin:settings': {
    enabled: true, watch: true, intro: false, weather: false, footprint: false, searchStyle: 'new', bg: { mode: 'off' }, ...patch,
  } }), patch);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(7000);
  for (const theme of ['dark', 'light']) {
    await seed({ theme }); await page.goto('https://www.bilibili.com/video/BV1mdxN68E7F/');
    await page.locator('.top .search.has-hot .search-ph-w').first().waitFor();
    const input = page.locator('.top .search input');
    assert.equal(await input.evaluate(el => getComputedStyle(el, '::placeholder').color), 'rgba(0, 0, 0, 0)');
    assert(await page.locator('.video-container-v1').isVisible());
    checks.push(`${theme}: rotating hot search hides the native placeholder and leaves native content visible`);
    await page.screenshot({ path: join(out, `search-${theme}.png`) });
    await seed({ theme, searchStyle: 'classic' });
    await page.locator('.top .search:not(.has-hot)').waitFor();
    assert.equal(await page.locator('.search-ph').count(), 0);
    assert.notEqual(await input.evaluate(el => getComputedStyle(el, '::placeholder').color), 'rgba(0, 0, 0, 0)');
    checks.push(`${theme}: classic search restores its native placeholder`);
    await seed({ theme, bg: { mode: 'fixed', shader: 'blend' } }); await page.goto('https://live.bilibili.com/3');
    await page.locator('html.margin-has-bg').waitFor({ state: 'attached' });
    for (const selector of ['body', '.live-room-app', '.app-content'])
      assert.equal(await page.locator(selector).evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');
    await page.screenshot({ path: join(out, `live-${theme}.png`) });
    await seed({ theme, bg: { mode: 'off' } });
    await page.locator('html:not(.margin-has-bg)').waitFor({ state: 'attached' });
    assert.notEqual(await page.locator('.app-content').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');
    checks.push(`${theme}: live wallpaper shows through content only when enabled`);
  }
  hot = false; await seed({ theme: 'dark' });
  await page.goto('https://www.bilibili.com/video/BV1mdxN68E7F/');
  await page.locator('.top .search input').waitFor(); await page.waitForTimeout(300);
  assert.equal(await page.locator('.top .search.has-hot').count(), 0);
  assert.notEqual(await page.locator('.top .search input').evaluate(el => getComputedStyle(el, '::placeholder').color), 'rgba(0, 0, 0, 0)');
  checks.push('empty hot search retains the visible native placeholder');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: checks.length, checks }));
} finally {
  writeFileSync(join(out, 'report.json'), JSON.stringify({ checks, errors, scope: 'Built extension with mocked HTTP; blank native-page report is not reproduced by this test.' }, null, 2));
  await context.close();
}
