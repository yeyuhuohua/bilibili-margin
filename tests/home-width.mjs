import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installMocks } from './mocks.mjs';

const ext = resolve(process.env.SMOKE_EXT || 'dist');
const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/home-width');
mkdirSync(out, { recursive: true });
const results = [], errors = [];
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-home-width-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, viewport: { width: 2560, height: 1440 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
try {
  await installMocks(ctx);
  const worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': { intro: false, theme: 'dark', bg: { mode: 'off' } } }));
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('https://www.bilibili.com/');
  const app = page.locator('#margin-root .app.home');
  const grid = app.locator('.grid:not(.fav-grid)').first();
  await grid.locator('.card:not(.sk)').first().waitFor();
  assert.equal(await app.getAttribute('data-home-width'), 'current');
  const originalCard = await grid.locator('.card').first().elementHandle();
  const currentWidth = (await grid.boundingBox()).width;
  await page.locator('#margin-root .top [aria-label="设置"]').click();
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  await dialog.getByRole('searchbox', { name: '搜索设置' }).fill('内容宽度');
  const block = dialog.locator('.block').filter({ has: page.locator('.row-label > span', { hasText: /^内容宽度$/ }) });
  const widths = {};
  for (const [value, label] of [['compact', '居中收窄'], ['fluid', '自适应铺开'], ['current', '当前宽度']]) {
    await block.getByRole('radio', { name: label, exact: true }).click();
    await page.waitForFunction(value => document.querySelector('#margin-root').shadowRoot.querySelector('.app.home').dataset.homeWidth === value, value);
    assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('margin:settings'))['margin:settings'].homeWidth), value);
    assert(await grid.locator('.card').first().evaluate((el, previous) => el === previous, originalCard), 'width change must retain loaded card nodes');
    widths[value] = (await grid.boundingBox()).width;
    await page.screenshot({ path: join(out, `${value}.png`) });
  }
  assert.equal(widths.current, currentWidth);
  assert(widths.compact < widths.current && widths.current < widths.fluid);
  results.push({ largeScreen: widths });
  await dialog.getByRole('searchbox', { name: '搜索设置' }).fill('每行视频');
  const columns = dialog.locator('.block').filter({ has: page.locator('.row-label > span', { hasText: /^每行视频$/ }) });
  await columns.getByRole('radio', { name: '4 个', exact: true }).click();
  await dialog.getByRole('searchbox', { name: '搜索设置' }).fill('内容宽度');
  await block.getByRole('radio', { name: '居中收窄', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#margin-root').shadowRoot.querySelector('.app.home').dataset.homeWidth === 'compact');
  assert.equal(await grid.evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 4);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.reload();
  await grid.locator('.card:not(.sk)').first().waitFor();
  assert.equal(await app.getAttribute('data-home-width'), 'compact');
  assert.equal(await app.getAttribute('data-cols'), '4');
  results.push('manual columns and selected width survive reload');
  const second = await ctx.newPage();
  second.on('pageerror', e => errors.push(e.message));
  await second.goto('https://www.bilibili.com/');
  await second.locator('#margin-root .app.home[data-home-width="compact"]').waitFor();
  await worker.evaluate(() => chrome.storage.local.get('margin:settings').then(s => chrome.storage.local.set({ 'margin:settings': { ...s['margin:settings'], homeWidth: 'fluid' } })));
  for (const tab of [page, second]) await tab.locator('#margin-root .app.home[data-home-width="fluid"]').waitFor();
  await second.close();
  results.push('width preference synchronizes to an already-open second tab');
  for (const width of [2560, 1920, 1440, 1280, 1100, 900, 800]) {
    await page.setViewportSize({ width, height: 1000 });
    const measures = {};
    for (const homeWidth of ['current', 'compact', 'fluid']) {
      await worker.evaluate(homeWidth => chrome.storage.local.get('margin:settings').then(s => chrome.storage.local.set({ 'margin:settings': { ...s['margin:settings'], homeWidth, cols: 0 } })), homeWidth);
      await page.waitForFunction(homeWidth => document.querySelector('#margin-root').shadowRoot.querySelector('.app.home').dataset.homeWidth === homeWidth, homeWidth);
      measures[homeWidth] = await grid.evaluate(el => ({ width: el.getBoundingClientRect().width, cols: getComputedStyle(el).gridTemplateColumns.split(' ').length }));
      assert(await app.evaluate(el => el.scrollWidth <= el.clientWidth), `horizontal overflow at ${width}/${homeWidth}`);
    }
    if (width < 1280) assert.deepEqual(measures.compact, measures.current), assert.deepEqual(measures.fluid, measures.current);
    assert(measures.compact.width <= measures.current.width, 'compact preset must not widen the current layout');
    results.push({ viewport: width, measures });
  }
  assert.deepEqual(errors, []);
} finally {
  writeFileSync(join(out, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  await ctx.close();
}
console.log(JSON.stringify(results));
