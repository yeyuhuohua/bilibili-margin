import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installMocks } from './mocks.mjs';
const ext = resolve(process.env.SMOKE_EXT || 'dist'), out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/search-return');
mkdirSync(out, { recursive: true });
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-search-return-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, viewport: { width: 1440, height: 1000 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const results = [], errors = [];
try {
  await installMocks(ctx);
  await ctx.route('https://search.bilibili.com/**', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Results</title>' }));
  const worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker'), page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  for (const mode of ['hero', 'classic', 'new']) {
    await worker.evaluate(opts => chrome.storage.local.set({ 'margin:settings': { intro: false, theme: 'dark', bg: { mode: 'off' }, ...opts } }), { searchStyle: mode === 'new' ? 'new' : 'classic', homeHide: mode === 'hero' ? [] : ['search'] });
    await page.goto('https://www.bilibili.com/');
    const input = page.locator(mode === 'hero' ? '#margin-root .hs-input' : '#margin-root .cp-input input');
    const open = async () => { if (mode === 'hero') await input.focus(); else await page.locator('#margin-root .top .search').click(); };
    for (const event of ['pagehide', 'pageshow']) {
      await open(); await input.fill('保留的草稿');
      await page.evaluate(event => dispatchEvent(new PageTransitionEvent(event, { persisted: true })), event);
      assert.equal(await page.locator('#margin-root .cp').evaluate(el => el.hidden), true);
      assert.equal(await page.locator('#margin-root .hero-search').getAttribute('data-open'), 'false');
      assert.equal(await input.inputValue(), '保留的草稿');
    }
    await open();
    await input.fill('测试视频');
    const popup = page.waitForEvent('popup');
    await input.press('Enter');
    const target = await popup; await target.waitForLoadState('domcontentloaded'); await target.close(); await page.bringToFront();
    const atNavigation = await page.evaluate(() => { const r=document.querySelector('#margin-root').shadowRoot; return {hero:r.querySelector('.hero-search').dataset.open,palette:r.querySelector('.cp').dataset.open,hidden:r.querySelector('.cp').hidden,focused:r.activeElement?.tagName}; });
    assert.equal(atNavigation.hero, 'false'); assert.equal(atNavigation.palette, 'false'); assert.equal(atNavigation.hidden, true);
    assert.notEqual(atNavigation.focused, 'INPUT', 'returning must not retain search focus');
    if (mode !== 'hero') assert(await page.locator('#margin-root .top .search').evaluate(el => !el.style.opacity && !el.style.pointerEvents));
    results.push({ mode, atNavigation, lifecycleReset: true });
  }
  for (const searchStyle of ['classic', 'new']) {
    await worker.evaluate(searchStyle => chrome.storage.local.set({
      'margin:settings': { intro: false, theme: 'dark', bg: { mode: 'off' }, searchStyle },
    }), searchStyle);
    await page.goto('https://www.bilibili.com/video/BV1mdxN68E7F/');
    await page.evaluate(() => {
      window.playerKeys = [];
      const shortcut = event => {
        if (![' ', 'e', 'f'].includes(event.key) || /^(INPUT|TEXTAREA)$/.test(event.target?.tagName)) return;
        window.playerKeys.push([event.type, event.key]);
        event.preventDefault();
      };
      window.addEventListener('keydown', shortcut, true);
      document.addEventListener('keypress', shortcut, true);
      document.addEventListener('keyup', shortcut, true);
    });
    const host = page.locator('#margin-watch-top');
    await host.locator('.top .search').click();
    const input = host.locator('.cp-input input');
    await input.pressSequentially('ef ef');
    assert.equal(await input.inputValue(), 'ef ef');
    assert.deepEqual(await page.evaluate(() => window.playerKeys), []);
    await input.evaluate(element => element.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', isComposing: true, bubbles: true, composed: true, cancelable: true,
    })));
    assert.equal(await host.locator('.cp').getAttribute('data-open'), 'true', 'IME Enter must not submit');
    await input.press('ArrowDown');
    await input.press('Escape');
    assert.equal(await host.locator('.cp').getAttribute('data-open'), 'false');
    await page.keyboard.press('Space');
    assert((await page.evaluate(() => window.playerKeys)).some(([type, key]) => type === 'keydown' && key === ' '),
      'player shortcuts should run again after the search closes');
    await page.keyboard.press('Control+k');
    await input.press('Control+k');
    assert.equal(await host.locator('.cp').getAttribute('data-open'), 'false', 'Ctrl+K still toggles the palette');
    await page.keyboard.press('/');
    await input.fill('ef ef');
    const popup = page.waitForEvent('popup');
    await input.press('Enter');
    const target = await popup;
    await target.waitForURL(url => url.searchParams.get('keyword') === 'ef ef');
    await target.close();
    await page.bringToFront();
    results.push({ mode: `watch-${searchStyle}`, shortcutsIsolated: true, imeEnterPreserved: true });
  }
  assert.deepEqual(errors, []);
} finally { writeFileSync(join(out, 'results.json'), JSON.stringify({ results, errors }, null, 2)); await ctx.close(); }
console.log(JSON.stringify(results));
