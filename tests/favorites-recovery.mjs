import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { installMocks } from './mocks.mjs';

const extension = resolve(process.env.SMOKE_EXT || 'dist');
const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/favorites-recovery');
mkdirSync(out, { recursive: true });
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-fav-recovery-')), {
  channel: 'chromium', headless: true, viewport: { width: 1440, height: 1000 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
const results = [], errors = [], requests = [];
let mode = '412', releaseList;
try {
  await installMocks(context, async address => {
    if (address.includes('/fav/folder/created/list')) {
      if (mode === 'list-slow') await new Promise(resolve => { releaseList = resolve; });
      return { code: 0, data: {
      list: Array.from({ length: 50 }, (_, i) => ({ id: 60000 + i, title: `收藏 ${i}`, media_count: 4, attr: 2,
        cover: 'https://i0.hdslb.com/folder.jpg' })),
      } };
    }
    return null;
  });
  await context.route('**/x/v3/fav/resource/list?*', async route => {
    const url = new URL(route.request().url());
    const id = Number(url.searchParams.get('media_id')), page = Number(url.searchParams.get('pn'));
    const requestMode = mode;
    requests.push({ id, page, mode: requestMode });
    const delay = requestMode === 'timeout' ? 14000 : requestMode === 'slow' ? 500 : 80;
    await new Promise(resolve => setTimeout(resolve, delay));
    if (requestMode === 'network') { await route.abort('timedout'); return; }
    const blocked = ['412', '-352'].includes(requestMode) && id !== 60000;
    const failedPage = requestMode === 'page-failure' && page === 2;
    const body = blocked && requestMode === '-352' ? { code: -352, message: '请求被拦截' }
      : { code: 0, data: { has_more: page === 1, medias: [
        { id: id * 10 + page, bvid: `BV${String(id * 10 + page).padStart(10, '0')}`, type: 2, attr: 0,
          title: `视频 ${id}-${page}`, cover: 'https://i0.hdslb.com/video.jpg', duration: 125, upper: { mid: 1, name: '作者' }, cnt_info: {} },
      ] } };
    await route.fulfill({ status: blocked && requestMode === '412' ? 412 : failedPage ? 503 : 200,
      contentType: 'application/json', headers: { 'access-control-allow-origin': 'https://www.bilibili.com', 'access-control-allow-credentials': 'true' },
      body: JSON.stringify(body) }).catch(() => {});
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': {
    intro: false, theme: 'dark', bg: { mode: 'off' }, weather: false, footprint: false, reduceMotion: true,
  } }));
  const page = context.pages()[0];
  page.setDefaultTimeout(4000);
  page.on('pageerror', error => errors.push(error.message));
  const dialog = page.getByRole('dialog', { name: '收藏夹', exact: true });
  const open = async () => {
    await page.goto('https://www.bilibili.com/');
    await page.locator('#margin-root .top').waitFor();
    await page.evaluate(() => dispatchEvent(new Event('margin:open-fav')));
    await dialog.locator('.gf-root').nth(49).waitFor();
  };
  const check = async (name, run) => {
    try { await run(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, error: error.message }); }
    console.log(JSON.stringify(results.at(-1)));
  };
  for (const failure of ['412', '-352', 'network']) {
    mode = failure;
    await open();
    await page.waitForTimeout(700);
    await check(`${failure}: failed preview queue stays paused while scrolling`, async () => {
      const count = requests.length;
      await dialog.locator('.gf-root').nth(45).scrollIntoViewIfNeeded();
      await page.waitForTimeout(600);
      assert.equal(requests.length, count, 'scrolling started more requests after an error');
    });
    await check(`${failure}: explicit retry recovers previews and keeps successful cached pages`, async () => {
      const cached = requests.filter(r => r.mode === failure && r.id === 60000 && r.page === 1).length;
      mode = 'healthy';
      await dialog.getByRole('button', { name: '重试加载', exact: true }).click();
      await dialog.locator('.gf-root').first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(600);
      assert(await dialog.locator('.gf-root[data-id="60001"] .gf-files .gf-sheet').count() > 0);
      if (failure !== 'network') assert.equal(requests.filter(r => r.id === 60000 && r.page === 1).length, cached);
    });
    requests.length = 0;
  }

  mode = 'page-failure';
  await open();
  await page.waitForTimeout(500);
  await check('failed pagination keeps its page and recovers through one explicit retry', async () => {
    await dialog.locator('.sentinel').scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    assert.equal(await dialog.locator('.fav-grid .title').count(), 1);
    const count = requests.filter(r => r.page === 2).length;
    await dialog.locator('.sheet-body').evaluate(el => { el.scrollTop -= 1000; });
    await dialog.locator('.sentinel').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    assert.equal(requests.filter(r => r.page === 2).length, count);
    mode = 'healthy';
    await dialog.getByRole('button', { name: '重试加载', exact: true }).click();
    await page.waitForTimeout(500);
    assert.equal(await dialog.locator('.fav-grid .title').count(), 2);
  });

  mode = 'slow';
  await open();
  await check('closing the sheet stops dispatching further preview and pagination requests', async () => {
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await page.waitForTimeout(100);
    const count = requests.length;
    await page.waitForTimeout(1000);
    assert.equal(requests.length, count);
    await page.evaluate(() => dispatchEvent(new Event('margin:open-fav')));
    await dialog.locator('.gf-root[data-id="60001"] .gf-files .gf-sheet').first().waitFor();
  });

  mode = '412';
  await open();
  await check('switching folders while paused resumes the selected folder on retry', async () => {
    await dialog.getByRole('button', { name: '重试加载', exact: true }).waitFor();
    await dialog.locator('.gf-root[data-id="60002"] .gf-hit').click();
    assert.equal(await dialog.locator('.fav-grid .title').count(), 0);
    mode = 'healthy';
    await dialog.getByRole('button', { name: '重试加载', exact: true }).click();
    await dialog.locator('.fav-grid .title').filter({ hasText: '视频 60002-1' }).waitFor();
  });

  mode = 'timeout';
  await open();
  await check('a hanging read times out and permits explicit recovery', async () => {
    await dialog.locator('.fav-recovery').filter({ hasText: '请求超时' }).waitFor({ timeout: 14000 });
    await page.screenshot({ path: join(out, 'timeout-recovery.png') });
    mode = 'healthy';
    await dialog.getByRole('button', { name: '重试加载', exact: true }).click();
    await dialog.locator('.gf-root[data-id="60001"] .gf-files .gf-sheet').first().waitFor();
  });

  mode = 'list-slow';
  await check('reopening after the folder list completed while closed loads the first page', async () => {
    await page.goto('https://www.bilibili.com/');
    await page.locator('#margin-root .top').waitFor();
    requests.length = 0;
    await page.evaluate(() => dispatchEvent(new Event('margin:open-fav')));
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(typeof releaseList, 'function', 'folder request must be pending before closing');
    releaseList();
    await page.getByRole('dialog', { name: '收藏夹', exact: true, includeHidden: true }).locator('.gf-root').nth(49).waitFor({ state: 'attached' });
    assert.equal(requests.filter(r => r.mode === 'list-slow').length, 0);
    await page.evaluate(() => dispatchEvent(new Event('margin:open-fav')));
    await dialog.locator('.fav-grid .title').first().waitFor({ state: 'attached' });
  });
  assert.deepEqual(errors, []);
} finally {
  writeFileSync(join(out, 'report.json'), JSON.stringify({ results, errors, requests }, null, 2));
  await context.close();
}
if (results.some(result => !result.passed)) process.exitCode = 1;
