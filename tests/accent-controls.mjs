import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installMocks } from './mocks.mjs';

const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/accent-controls');
mkdirSync(out, { recursive: true });
const extension = resolve(process.env.SMOKE_EXT || 'dist'), results = [], errors = [];
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-accent-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, viewport: { width: 1440, height: 900 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
try {
  await installMocks(context);
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  for (const theme of ['light', 'dark']) {
    await worker.evaluate(theme => chrome.storage.local.set({ 'margin:settings': { theme, intro: false, bg: { mode: 'off' } } }), theme);
    for (const route of ['watch', 'search']) {
      await page.goto(route === 'watch' ? 'https://www.bilibili.com/video/BV1mdxN68E7F/' : 'https://search.bilibili.com/all?keyword=test');
      await page.locator('#margin-watch-top .app').waitFor();
      await page.evaluate(route => {
        const box = document.createElement('section'); box.id = 'accent-fixture';
        box.style.cssText = 'position:relative;margin:140px 40px 30px;padding:24px;background:var(--m-surface);z-index:1';
        box.innerHTML = route === 'watch'
          ? '<div class="upinfo-btn-panel"><button class="default-btn charge-btn">充电</button><button class="default-btn follow-btn not-follow"><span class="follow-btn-inner">＋ 关注 8808</span></button></div>'
          : '<div class="search-tabs"><span class="vui_tabs--nav-item vui_tabs--nav-item-active"><span class="vui_tabs--nav-text">综合</span></span><div class="vui_tabs--nav-bar" style="width:32px"></div></div><div class="search-conditions"><button class="vui_button vui_button--active">综合排序</button><button class="vui_button">最多播放</button></div><button class="vui_pagenation--btn vui_button--active">1</button>';
        document.body.prepend(box);
      }, route);
      // Change the setting while the same DOM stays mounted, including returning to classic.
      for (const accent of ['classic', 'blue', 'pink', 'classic']) {
        await worker.evaluate(async accent => {
          const settings = (await chrome.storage.local.get('margin:settings'))['margin:settings'];
          await chrome.storage.local.set({ 'margin:settings': { ...settings, accent } });
        }, accent);
        await page.waitForFunction(accent => document.documentElement.style.getPropertyValue('--margin-primary') ===
          ({ classic: '', blue: '#007da8', pink: '#b92f64' })[accent], accent);
        await page.waitForTimeout(250);
        const filled = accent === 'classic' ? (theme === 'light' ? 'rgb(23, 24, 26)' : 'rgb(237, 237, 238)')
          : accent === 'blue' ? 'rgb(0, 125, 168)' : 'rgb(185, 47, 100)';
        const foreground = accent === 'classic' ? (theme === 'light' ? 'rgb(245, 244, 241)' : 'rgb(17, 17, 18)') : 'rgb(255, 255, 255)';
        const selectors = route === 'watch' ? ['.follow-btn', '.follow-btn-inner'] : ['.vui_button--active'];
        const failures = [];
        for (const selector of selectors) for (const element of await page.locator(`#accent-fixture ${selector}`).all()) {
          const style = await element.evaluate(el => ({ bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(el).color }));
          if (style.bg !== filled || style.fg !== foreground) failures.push({ selector, ...style, expected: { filled, foreground } });
        }
        if (route === 'search') {
          await page.locator('#accent-fixture .vui_tabs--nav-item-active').hover();
          const active = await page.locator('#accent-fixture .vui_tabs--nav-item-active').evaluate(el => getComputedStyle(el).color);
          const bar = await page.locator('#accent-fixture .vui_tabs--nav-bar').evaluate(el => getComputedStyle(el).backgroundColor);
          if (active !== filled || bar !== filled) failures.push({ active, bar, expected: filled });
          await page.mouse.move(0, 0);
        }
        const name = `${theme} ${route} ${accent}`;
        results.push({ name, failures }); console.log(`${failures.length ? 'FAIL' : 'PASS'} ${name}`);
        if (accent === 'pink') await page.screenshot({ path: join(out, `${theme}-${route}.png`) });
      }
    }
  }
  assert.deepEqual(errors, []);
  assert.equal(results.filter(r => r.failures.length).length, 0, JSON.stringify(results.filter(r => r.failures.length)));
} finally {
  writeFileSync(join(out, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  await context.close();
}
