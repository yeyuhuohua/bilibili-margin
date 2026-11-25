import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { installMocks } from './mocks.mjs';
const ext = resolve(process.env.SMOKE_EXT || 'dist'), out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/page-redesign');
mkdirSync(out, { recursive: true });
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-pages-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, viewport: { width: 1440, height: 1000 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const results = [], errors = [];
try {
  await installMocks(ctx);
  const worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  const seed = patch => worker.evaluate(async patch => { const saved = (await chrome.storage.local.get('margin:settings'))['margin:settings']; await chrome.storage.local.set({ 'margin:settings': { ...saved, ...patch } }); }, patch);
  await seed({ intro: false, theme: 'dark', bg: { mode: 'off' }, footprint: false, weather: false });
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
  const routes = [
    ['home', 'https://www.bilibili.com/'],
    ['feed', 'https://t.bilibili.com/'],
    ['feed', 'https://t.bilibili.com/123456789/'],
    ['feed', 'https://www.bilibili.com/opus/123456789'],
    ['watch', 'https://www.bilibili.com/video/BV1mock00001/'],
    ['watch', 'https://www.bilibili.com/bangumi/play/ep123'],
    ['live', 'https://live.bilibili.com/'],
    ['live', 'https://live.bilibili.com/12345'],
  ];
  for (const [kind, url] of routes) {
    await seed({ pageOff: [], enabled: true, watch: true });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const on = () => page.evaluate(() => !!document.querySelector('#margin-root,#margin-watch-top') || document.documentElement.classList.contains('margin-skin'));
    await page.waitForFunction(() => !!document.querySelector('#margin-root,#margin-watch-top') || document.documentElement.classList.contains('margin-skin'));
    await seed({ pageOff: [kind] });
    await page.waitForFunction(() => !document.querySelector('#margin-root,#margin-watch-top,#margin-hide') && !document.documentElement.classList.contains('margin-skin') && !!document.body && getComputedStyle(document.body).display !== 'none');
    await page.waitForTimeout(300);
    assert.equal(await on(), false);
    const native = await page.evaluate(() => document.querySelector('#app')?.getBoundingClientRect().width ?? document.body.getBoundingClientRect().width);
    assert(native > 0);
    await seed({ pageOff: [] });
    await page.waitForFunction(() => !!document.querySelector('#margin-root,#margin-watch-top') || document.documentElement.classList.contains('margin-skin'));
    results.push({ kind, url, restoredNative: true, reenabled: true });
  }
  await page.goto('https://www.bilibili.com/');
  await page.locator('#margin-root .top [aria-label="设置"]').click();
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  const control = dialog.locator('.block').filter({ has: page.locator('.row-label > span', { hasText: /^按页面重设计$/ }) });
  const feed = control.getByRole('button', { name: '动态', exact: true });
  assert.equal(await feed.getAttribute('aria-pressed'), 'true'); await feed.click();
  assert.equal(await feed.getAttribute('aria-pressed'), 'false');
  assert.equal(await page.getByRole('dialog', { name: '设置', exact: true }).count(), 1, 'other page preferences must not reload the homepage');
  await page.screenshot({ path: join(out, 'settings.png') });
  const popup = await ctx.newPage(); await popup.goto(`chrome-extension://${new URL(worker.url()).hostname}/popup.html`);
  await popup.locator('summary').click();
  const toggle = popup.getByRole('switch', { name: '动态重设计', exact: true });
  await toggle.waitFor(); assert.equal(await toggle.getAttribute('aria-checked'), 'false'); await toggle.click();
  await toggle.and(popup.locator('[aria-checked="true"]')).waitFor();
  await popup.getByRole('switch', { name: '首页重设计', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#margin-root,#margin-hide') && !!document.body && getComputedStyle(document.body).display !== 'none');
  await popup.getByRole('switch', { name: '首页重设计', exact: true }).click();
  await page.locator('#margin-root .app.home').waitFor();
  results.push('settings and extension popup can independently disable and restore pages');
  assert.deepEqual(errors, []);
} finally { writeFileSync(join(out, 'results.json'), JSON.stringify({ results, errors }, null, 2)); await ctx.close(); }
console.log(JSON.stringify(results));
