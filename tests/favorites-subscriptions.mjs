import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { installMocks } from './mocks.mjs';

const extension = resolve(process.env.SMOKE_EXT || 'dist');
const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/favorites-subscriptions');
mkdirSync(out, { recursive: true });
const results = [], errors = [], requests = [];
let listing = 'normal';
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-subscriptions-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  viewport: { width: 1440, height: 900 }, locale: 'zh-CN',
});
try {
  await installMocks(context, async url => {
    const u = new URL(url);
    if (u.pathname === '/x/v3/fav/folder/collected/list') {
      requests.push(url);
      if (listing === 'error') return { code: -500, message: '订阅服务暂时不可用' };
      if (listing === 'empty') return { code: 0, data: { list: [], has_more: false } };
      if (listing === 'slow') await new Promise(resolve => setTimeout(resolve, 600));
      const second = u.searchParams.get('pn') === '2';
      return { code: 0, data: { has_more: !second, list: second
        ? [{ id: 999, type: 21, title: '下一页合集', media_count: 1, cover: '' }]
        : [{ id: 101, type: 21, title: '订阅合集', media_count: 25, cover: '' }, { id: 101, type: 11, title: '他人的收藏夹', media_count: 8, cover: '' }] } };
    }
    if (u.pathname === '/x/space/fav/season/list') {
      requests.push(url);
      return { code: 0, data: { info: { upper: { mid: 9, name: '合集作者' } }, medias: Array.from({ length: 25 }, (_, i) => ({
        id: i + 1, bvid: `BVcollection${i}`, title: `订阅视频 ${i + 1}`, cover: '', duration: 30, pubtime: 123,
      })) } };
    }
    return null;
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': { intro: false, theme: 'dark', bg: { mode: 'off' }, favDirect: true } }));
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const sheet = page.getByRole('dialog', { name: '收藏夹', exact: true });
  const open = async () => {
    await page.goto('https://www.bilibili.com/');
    await page.locator('#margin-root .top').waitFor();
    await page.evaluate(() => dispatchEvent(new Event('margin:open-fav', { cancelable: true })));
    await sheet.waitFor();
    await sheet.locator('.gf-root').first().waitFor();
  };
  const check = async (name, run) => {
    try { await run(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
    catch (error) { results.push({ name, ok: false, error: error.message }); console.log(`FAIL ${name}: ${error.message}`); }
  };
  await open();
  await check('75-subscribed-types-and-id-collision', async () => {
    assert.equal(requests.length, 0, 'subscription data should load on demand');
    await sheet.getByRole('radio', { name: '订阅内容', exact: true }).click({ timeout: 2000 });
    await sheet.locator('.gf-root').filter({ hasText: '订阅合集' }).waitFor();
    assert.equal(await sheet.locator('.gf-root').count(), 2);
    assert.equal(await sheet.locator('.fav-new').count(), 0);
    assert.equal(await sheet.getByRole('menuitem', { name: '删除收藏夹', includeHidden: true }).count(), 0);
    const season = sheet.locator('.gf-root').filter({ hasText: '订阅合集' });
    await season.locator('.gf-hit').click();
    await sheet.locator('.fav-grid .card').filter({ hasText: '订阅视频 1' }).first().waitFor();
    await sheet.locator('.sheet-body').evaluate(body => { body.scrollTop = body.scrollHeight; });
    await page.waitForFunction(() => document.querySelector('#margin-root').shadowRoot.querySelectorAll('.fav-grid .card').length === 25);
    assert.equal(requests.filter(url => url.includes('/fav/season/list?season_id=101')).length, 1, 'full collection downloaded more than once');
    await sheet.locator('.gf-root').filter({ hasText: '他人的收藏夹' }).locator('.gf-hit').click();
    await page.waitForFunction(() => {
      const grid = document.querySelector('#margin-root').shadowRoot.querySelector('.fav-grid');
      return grid.querySelectorAll('.card').length === 8 && !grid.textContent.includes('订阅视频');
    });
    await sheet.getByRole('button', { name: '加载更多订阅', exact: true }).click();
    await sheet.locator('.gf-root').filter({ hasText: '下一页合集' }).waitFor();
    assert.equal(await sheet.locator('.gf-root').count(), 3);
    await sheet.locator('.sheet-body').evaluate(body => { body.scrollTop = 0; });
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(out, 'subscriptions.png') });
    await sheet.getByRole('radio', { name: '我的收藏', exact: true }).click();
    await sheet.locator('.gf-root').filter({ hasText: '默认收藏夹' }).waitFor();
    assert.equal(await sheet.locator('.gf-root').count(), 3);
    assert.equal(await sheet.locator('.fav-new').count(), 1);
  });
  await check('75-subscription-error-retry-and-empty', async () => {
    await open();
    listing = 'error';
    await sheet.getByRole('radio', { name: '订阅内容', exact: true }).click({ timeout: 2000 });
    await sheet.getByText('加载失败：订阅服务暂时不可用', { exact: true }).waitFor();
    listing = 'empty';
    await sheet.getByRole('button', { name: '重试', exact: true }).click();
    await sheet.getByText('还没有订阅合集或收藏夹', { exact: true }).waitFor();
    await sheet.getByRole('radio', { name: '我的收藏', exact: true }).click();
    await sheet.locator('.gf-root').filter({ hasText: '默认收藏夹' }).waitFor();
  });
  await check('75-rapid-switch-ignores-late-subscriptions', async () => {
    await open();
    listing = 'slow';
    await sheet.getByRole('radio', { name: '订阅内容', exact: true }).click({ timeout: 2000 });
    await sheet.getByRole('radio', { name: '我的收藏', exact: true }).click();
    await page.waitForTimeout(900);
    assert.equal(await sheet.locator('.gf-root').filter({ hasText: '默认收藏夹' }).count(), 1);
    assert.equal(await sheet.locator('.gf-root').filter({ hasText: '订阅合集' }).count(), 0);
    assert.equal(await sheet.locator('.fav-new').count(), 1);
  });
  await check('75-switch-releases-folder-observers', async () => {
    listing = 'normal';
    await open();
    const cdp = await context.newCDPSession(page), worlds = [];
    cdp.on('Runtime.executionContextCreated', ({ context }) => worlds.push(context));
    await cdp.send('Runtime.enable');
    const origin = worker.url().split('/').slice(0, 3).join('/');
    const world = worlds.find(world => world.origin === origin);
    assert(world, 'extension isolated world missing');
    const evaluate = async expression => {
      const result = await cdp.send('Runtime.evaluate', { contextId: world.id, expression, returnByValue: true });
      assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    await evaluate(`(() => {
      const Original = ResizeObserver;
      globalThis.folderObservers = new Set();
      globalThis.ResizeObserver = class extends Original {
        targets = new Set();
        observe(target, options) {
          super.observe(target, options);
          if (target.matches('.gf-root')) { this.targets.add(target); folderObservers.add(target); }
        }
        disconnect() { super.disconnect(); for (const target of this.targets) folderObservers.delete(target); this.targets.clear(); }
      };
    })()`);
    for (let i = 0; i < 3; i++) {
      await sheet.getByRole('radio', { name: '订阅内容', exact: true }).click();
      await sheet.locator('.gf-root').filter({ hasText: '订阅合集' }).waitFor();
      await sheet.getByRole('radio', { name: '我的收藏', exact: true }).click();
      await sheet.locator('.gf-root').filter({ hasText: '默认收藏夹' }).waitFor();
    }
    assert.equal(await evaluate('folderObservers.size'), 3, 'detached folder observers accumulate after switching');
    assert.equal(await evaluate('[...folderObservers].filter(node => !node.isConnected).length'), 0);
    await cdp.detach();
  });
} finally {
  writeFileSync(join(out, 'results.json'), JSON.stringify({ results, errors, requests }, null, 2));
  await context.close();
}
if (results.some(result => !result.ok) || errors.length) process.exitCode = 1;
