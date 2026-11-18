import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installMocks, apiBody } from './mocks.mjs';
const ext = resolve(process.env.SMOKE_EXT || 'dist'), out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/hover-list-feedback');
mkdirSync(out, { recursive: true });
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-hover-list-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, viewport: { width: 1440, height: 1000 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const counts = { folders: 0, history: 0, later: 0, remove: 0 }, results = [], errors = [];
let deleteFails = true, historyFails = true;
const historyCursors = [];
try {
  await ctx.addCookies([{ name: 'bili_jct', value: 'test-token', domain: '.bilibili.com', path: '/' }]);
  await installMocks(ctx, url => {
    const u = new URL(url);
    if (u.pathname.endsWith('/fav/folder/created/list')) {
      counts.folders++; const start = (Number(u.searchParams.get('pn')) - 1) * 50;
      return { code: 0, data: { count: 53, list: Array.from({ length: Math.max(0, Math.min(50, 53 - start)) }, (_, i) => ({ id: start + i + 1, title: `收藏夹 ${start + i + 1}`, media_count: 2, cover: '', attr: 2 })) } };
    }
    if (u.pathname.endsWith('/history/cursor')) {
      counts.history++; const start = Number(u.searchParams.get('max')); historyCursors.push(start);
      if (start && historyFails) { historyFails = false; return { code: -500, message: 'temporary failure' }; }
      const sample = apiBody(url).data.list[0];
      return { code: 0, data: { cursor: { max: start === 0 ? 30 : 0, view_at: 0, business: 'archive' }, list: Array.from({ length: start === 0 ? 30 : 5 }, (_, i) => ({ ...sample, title: `历史视频 ${start + i + 1}`, history: { ...sample.history, oid: start + i + 1, bvid: `BV${String(start + i + 1).padStart(10, '0')}` } })) } };
    }
    if (u.pathname.endsWith('/history/toview/del')) { counts.remove++; return new Promise(resolve => setTimeout(() => resolve({ code: deleteFails ? -1 : 0 }), 250)); }
    if (u.pathname.endsWith('/history/toview')) {
      counts.later++; const sample = apiBody(url).data.list[0];
      return { code: 0, data: { list: Array.from({ length: 25 }, (_, i) => ({ ...sample, aid: i + 1, title: `稍后视频 ${i + 1}`, bvid: `BV${String(i + 1).padStart(10, '0')}` })) } };
    }
    return null;
  });
  const worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': { intro: false, theme: 'dark', bg: { mode: 'off' }, footprint: false, weather: false } }));
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto('https://www.bilibili.com/');
  for (const [label, title, expected, key] of [['收藏', '收藏夹', 53, 'folders'], ['历史', '最近看过', 35, 'history'], ['稍后', '稍后再看', 25, 'later']]) {
    await page.locator(`#margin-root .et-btn[aria-label="${label}"]`).hover();
    const pop = page.getByRole('dialog', { name: title, exact: true }); await pop.locator('.dp-row').first().waitFor();
    await pop.hover(); await page.waitForTimeout(200);
    const firstCount = await pop.locator('.dp-row').count();
    assert(firstCount >= 8 && firstCount <= (key === 'folders' ? 50 : key === 'history' ? 30 : 25), 'viewport filling must stay within the first buffered page');
    const initialRequests = counts[key];
    for (let i = 0; i < 12 && await pop.locator('.dp-row').count() < expected; i++) {
      const before = await pop.locator('.dp-row').count();
      await pop.locator('.dp-list').evaluate(el => { el.scrollTop = el.scrollHeight; });
      await page.waitForFunction(({ title, before, expected }) => {
        const pop = [...document.querySelector('#margin-root').shadowRoot.querySelectorAll('.dp')].find(el => el.getAttribute('aria-label') === title);
        return pop?.querySelectorAll('.dp-row').length >= Math.min(expected, before + 1) || pop?.querySelector('.dp-more')?.textContent === '加载失败，重试';
      }, { title, before, expected }, { timeout: 3000 });
      const retry = pop.getByRole('button', { name: '加载失败，重试', exact: true });
      if (await retry.isVisible()) {
        const requests = counts[key]; await page.waitForTimeout(200);
        assert.equal(counts[key], requests, 'a failed page must not loop automatically');
        await retry.click();
        await page.waitForFunction(({ title, before }) => [...document.querySelector('#margin-root').shadowRoot.querySelectorAll('.dp')].find(el => el.getAttribute('aria-label') === title)?.querySelectorAll('.dp-row').length > before, { title, before });
      }
    }
    assert.equal(await pop.locator('.dp-row').count(), expected);
    assert.equal(counts[key], key === 'later' ? initialRequests : initialRequests + (key === 'history' ? 2 : 1), 'reuse current page before requesting the next');
    results.push({ label, rows: expected, requests: counts[key] - initialRequests + 1 });
    if (key === 'later') {
      await pop.locator('.dp-list').evaluate(el => { el.scrollTop = 0; });
      const first = pop.locator('.dp-entry').first(); await first.hover();
      const remove = first.getByRole('button', { name: '移出稍后再看', exact: true });
      await remove.evaluate(el => { el.click(); el.click(); });
      await page.waitForTimeout(400);
      assert.equal(counts.remove, 1); assert.equal(await pop.locator('.dp-row').count(), 25);
      deleteFails = false; await remove.click();
      await page.waitForFunction(() => ![...document.querySelector('#margin-root').shadowRoot.querySelectorAll('.dp[aria-label="稍后再看"] .dp-line')].some(el => el.textContent === '稍后视频 1'));
      assert.equal(await pop.locator('.dp-row').count(), 24); assert.equal(counts.remove, 2);
      await pop.screenshot({path:join(out,'watch-later-dark.png')});
      results.push('failed removal retains the row; repeated clicks send once; success removes only the selected row');
    }
    await page.keyboard.press('Escape');
  }
  assert.deepEqual(historyCursors, [0, 30, 30], 'retry must use the failed cursor');
  assert.deepEqual(errors, []);
} finally { writeFileSync(join(out, 'results.json'), JSON.stringify({ results, counts, errors }, null, 2)); await ctx.close(); }
console.log(JSON.stringify(results));
