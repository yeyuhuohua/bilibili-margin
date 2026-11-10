import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installMocks } from './mocks.mjs';

const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/settings-page');
mkdirSync(out, { recursive: true });
const ext = resolve(process.env.SMOKE_EXT || 'dist');
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-settings-page-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, viewport: { width: 1440, height: 1000 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const errors = [], results = [];
try {
  await installMocks(ctx);
  const worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': { intro: false, theme: 'dark', bg: { mode: 'off' } } }));
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto('https://www.bilibili.com/');
  await page.locator('#margin-root .top [aria-label="设置"]').click();
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  const tabs = dialog.getByRole('tab'); assert.equal(await tabs.count(), 8);
  for (let i = 0; i < 8; i++) { await tabs.nth(i).click(); assert.equal(await dialog.getByRole('tabpanel').count(), 1); }
  const checkDialogSize = async () => {
    const viewport = page.viewportSize(), box = await dialog.boundingBox();
    assert(box.width <= 960 && box.height <= 680, `settings too large: ${box.width}x${box.height}`);
    assert(Math.abs(box.x + box.width / 2 - viewport.width / 2) < 2, 'settings not horizontally centered');
    assert(Math.abs(box.y + box.height / 2 - viewport.height / 2) < 2, 'settings not vertically centered');
    assert(box.x >= 10 && box.y >= 10, 'settings has no viewport clearance');
  };
  await checkDialogSize();
  await tabs.first().focus(); await page.keyboard.press('End'); assert.equal(await tabs.last().getAttribute('aria-selected'), 'true');
  await page.keyboard.press('Home'); assert.equal(await tabs.first().getAttribute('aria-selected'), 'true');
  results.push('eight categories, single panel and keyboard navigation');
  await tabs.nth(1).click();
  const search = dialog.getByRole('searchbox', { name: '搜索设置' });
  await search.fill('播放器圆角');
  const corners = dialog.getByRole('switch', { name: '播放器圆角', exact: true });
  await corners.waitFor(); assert.equal(await tabs.nth(4).getAttribute('aria-selected'), 'true');
  await corners.click();
  await page.waitForFunction(async () => {
    const button = document.querySelector('#margin-root')?.shadowRoot?.querySelector('[aria-label="播放器圆角"]');
    return button?.getAttribute('aria-checked') === 'false';
  });
  assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('margin:settings'))['margin:settings'].playerCorners), false);
  await search.focus(); await page.keyboard.press('Escape');
  assert.equal(await search.inputValue(), ''); assert.equal(await tabs.nth(1).getAttribute('aria-selected'), 'true');
  results.push('cross-category search retains player-corner setting and restores original category');
  await page.waitForTimeout(350); await page.screenshot({ path: join(out, 'dark-desktop.png') });
  await worker.evaluate(() => chrome.storage.local.get('margin:settings').then(s => chrome.storage.local.set({ 'margin:settings': { ...s['margin:settings'], theme: 'light', reduceMotion: true } })));
  await page.waitForFunction(() => document.documentElement.classList.contains('margin-reduce'));
  await tabs.first().click();
  assert.equal(await dialog.locator('.stg-indicator').evaluate(el => el.getAnimations().length), 0);
  await page.setViewportSize({ width: 720, height: 900 });
  await tabs.last().click(); await tabs.nth(1).click(); await tabs.last().click();
  const box = await dialog.boundingBox(); assert(box.x >= 0 && box.x + box.width <= 720);
  assert(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth));
  await checkDialogSize();
  await page.screenshot({ path: join(out, 'light-narrow.png') });
  results.push('reduced motion, light theme and narrow tab navigation');
  await search.focus(); await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
  await page.locator('#margin-root .top [aria-label="设置"]').click();
  await tabs.nth(4).click(); assert.equal(await corners.getAttribute('aria-checked'), 'false');
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1280, height: 600 }]) {
    await page.setViewportSize(viewport); await checkDialogSize();
    assert(await dialog.locator('.stg-body').evaluate(el => el.scrollHeight > el.clientHeight), 'long settings panel must scroll internally');
  }
  results.push('compact centered dialog on desktop, narrow and short windows');
  assert.deepEqual(errors, []); results.push('saved preference survives close and reopen');
  results.forEach(result => console.log('PASS ' + result));
} finally {
  writeFileSync(join(out, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  await ctx.close();
}
