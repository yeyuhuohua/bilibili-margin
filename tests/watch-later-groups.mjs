import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { installMocks } from './mocks.mjs';

const extension = resolve(process.env.SMOKE_EXT || 'dist');
const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/watch-later-groups');
mkdirSync(out, { recursive: true });
const results = [], errors = [];
const originals = [1, 2, 1, 3, 3].map((mid, i) => ({
  aid: i + 1, bvid: `BVlater${i}`, title: `稍后视频 ${i + 1}`, pic: '', duration: 300,
  progress: i === 0 ? -1 : 30, owner: { mid, name: mid === 3 ? 'UP 乙' : '同名 UP' },
}));
let items = originals.slice(), mode = 'normal', deletionFails = false, requests = 0;
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-later-groups-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  viewport: { width: 1440, height: 900 }, locale: 'zh-CN',
});
try {
  context.setDefaultTimeout(4000);
  await context.addCookies([{ name: 'bili_jct', value: 'test', domain: '.bilibili.com', path: '/' }]);
  await installMocks(context, async url => {
    if (new URL(url).pathname !== '/x/v2/history/toview') return null;
    requests++;
    const snapshot = items.slice(), responseMode = mode;
    if (responseMode === 'slow') await new Promise(resolve => setTimeout(resolve, 800));
    if (responseMode === 'logout') return { code: -101 };
    if (responseMode === 'error') return { code: -500, message: '暂时不可用' };
    return { code: 0, data: { list: snapshot } };
  });
  await context.route('**/x/v2/history/toview/del', async route => {
    const aid = Number(new URLSearchParams(route.request().postData()).get('aid'));
    if (!deletionFails) items = items.filter(item => item.aid !== aid);
    await route.fulfill({ json: { code: deletionFails ? -500 : 0 }, headers: {
      'access-control-allow-origin': route.request().headers().origin || 'https://www.bilibili.com',
      'access-control-allow-credentials': 'true',
    } });
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const seed = patch => worker.evaluate(async patch => {
    const current = (await chrome.storage.local.get('margin:settings'))['margin:settings'] || {};
    await chrome.storage.local.set({ 'margin:settings': { ...current, ...patch } });
  }, patch);
  await seed({ intro: false, reduceMotion: true, theme: 'dark', bg: { mode: 'off' } });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const drawer = page.getByRole('dialog', { name: '稍后再看', exact: true });
  const select = drawer.getByRole('combobox', { name: '按 UP 主筛选' });
  const group = drawer.getByRole('checkbox', { name: '按 UP 主分组' });
  const close = () => drawer.getByRole('button', { name: '关闭', exact: true }).click();
  const open = () => page.locator('.top').getByRole('button', { name: '稍后', exact: true }).click();
  const count = async n => page.waitForFunction(n => {
    const host = document.querySelector('#margin-root, #margin-watch-top');
    return host?.shadowRoot?.querySelectorAll('.dw-body a.dw-item:not(.sk)').length === n;
  }, n);
  const check = async (name, run) => {
    try { await run(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
    catch (error) { results.push({ name, ok: false, error: error.message }); console.log(`FAIL ${name}: ${error.message}`); }
  };

  for (const [name, url] of [['home', 'https://www.bilibili.com/'], ['watch', 'https://www.bilibili.com/video/BV1mdxN68E7F/'], ['search', 'https://search.bilibili.com/all?keyword=test']]) {
    await check(`82-${name}-filter-and-group`, async () => {
      items = originals.slice(); mode = 'normal';
      await page.goto(url);
      await open(); await count(5);
      await select.waitFor();
      assert.equal(await select.locator('option').count(), 4);
      const before = requests;
      await select.selectOption('1'); await count(2);
      assert.deepEqual(await drawer.locator('.dw-t').allTextContents(), ['稍后视频 1', '稍后视频 3']);
      await select.selectOption('2'); await count(1);
      assert.equal(await drawer.locator('.dw-t').textContent(), '稍后视频 2');
      await select.selectOption(''); await count(5);
      await group.check();
      assert.equal(await drawer.locator('.dw-group').count(), 3);
      assert.deepEqual(await drawer.locator('.dw-group').first().locator('.dw-t').allTextContents(), ['稍后视频 1', '稍后视频 3']);
      assert.equal(requests, before, 'local filtering should not request the list again');
      await page.screenshot({ path: join(out, `${name}-grouped.png`) });
      await close();
    });
  }
  await check('82-deletion-updates-groups-and-filter', async () => {
    await open(); await count(5); await select.selectOption('2'); await count(1);
    await drawer.getByRole('button', { name: '移出稍后再看' }).click(); await count(4);
    assert.equal(await select.inputValue(), '');
    assert.equal(await select.locator('option').count(), 3);
    assert.equal(await drawer.locator('.dw-group').count(), 2);
    assert.equal((await drawer.locator('.dw-count').textContent()).trim(), '4');
    deletionFails = true;
    await drawer.getByRole('button', { name: '移出稍后再看' }).first().click();
    await page.getByText('没移掉，稍后再试', { exact: true }).waitFor();
    assert.equal(await drawer.locator('.dw-item.out').count(), 0);
    assert.equal(await drawer.locator('.dw-t').count(), 4);
    deletionFails = false;
    await close();
  });
  await check('82-filter-settings-theme-and-keyboard', async () => {
    await seed({ filters: { ups: ['3'] }, theme: 'light' });
    await open(); await count(2);
    assert.equal(await select.locator('option').count(), 2);
    assert.equal(await drawer.locator('.dw-group').count(), 1);
    await select.focus(); await page.keyboard.press('Tab');
    assert.equal(await group.evaluate(element => element.getRootNode().activeElement === element), true);
    await page.screenshot({ path: join(out, 'light-filtered.png') });
    await close();
    await seed({ filters: { ups: [] } });
  });
  await check('82-empty-logout-error-and-retry', async () => {
    items = []; await open();
    await drawer.getByText('列表是空的', { exact: true }).waitFor();
    assert.equal(await drawer.locator('.dw-tools').isVisible(), false);
    await close(); mode = 'logout'; await open();
    await drawer.getByText('还没登录', { exact: true }).waitFor();
    assert.equal(await drawer.locator('.dw-tools').isVisible(), false);
    await close(); mode = 'error'; await open();
    await drawer.getByText('加载失败', { exact: true }).waitFor();
    assert.equal(await drawer.locator('.dw-tools').isVisible(), false);
    mode = 'normal'; items = originals.slice();
    await drawer.getByRole('button', { name: '重试' }).click(); await count(5);
    await select.waitFor(); await close();
  });
  await check('82-stale-response-after-reopen', async () => {
    mode = 'slow'; items = originals.slice();
    const pending = context.waitForEvent('request', { predicate: request => new URL(request.url()).pathname === '/x/v2/history/toview' });
    await open(); await pending;
    await close(); mode = 'normal'; items = originals.slice(0, 1);
    await open(); await count(1); await page.waitForTimeout(1000);
    assert.equal(await drawer.locator('.dw-t').count(), 1);
    assert.equal(await select.locator('option').count(), 2);
  });
} finally {
  writeFileSync(join(out, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  await context.close();
}
if (results.some(result => !result.ok) || errors.length) process.exitCode = 1;
