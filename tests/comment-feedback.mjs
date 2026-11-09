import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installMocks } from './mocks.mjs';

const extension = resolve(process.env.SMOKE_EXT || 'dist');
const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/comment-feedback');
mkdirSync(out, { recursive: true });
const results = [], laterRequests = [];
let rejectLater = false;
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-comments-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  viewport: { width: 1440, height: 900 }, locale: 'zh-CN',
});
try {
  await installMocks(context);
  await context.addCookies([{ name: 'bili_jct', value: 'test-token', domain: '.bilibili.com', path: '/' }]);
  await context.route('**/x/v2/history/toview/add', async route => {
    laterRequests.push(new URLSearchParams(route.request().postData()).get('bvid'));
    await new Promise(resolve => setTimeout(resolve, 100));
    await route.fulfill({ contentType: 'application/json', headers: {
      'access-control-allow-origin': route.request().headers().origin,
      'access-control-allow-credentials': 'true',
    }, body: JSON.stringify(rejectLater ? { code: -1, message: '重试添加' } : { code: 0 }) });
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page = await context.newPage(); page.setDefaultTimeout(5000);
  const seed = patch => worker.evaluate(patch => chrome.storage.local.set({ 'margin:settings': { searchStyle: 'new', intro: false, theme: 'dark', bg: { mode: 'off' }, ...patch } }), patch);
  const check = async (name, run) => {
    if (process.env.FEEDBACK_ONLY && !name.startsWith(process.env.FEEDBACK_ONLY)) return;
    try { const evidence = await run(); results.push({ name, ok: true, evidence }); console.log(`PASS ${name}`); }
    catch (error) { results.push({ name, ok: false, error: error.message }); console.log(`FAIL ${name}: ${error.message}`); }
  };
  for (const [name, url, host] of [
    ['home', 'https://www.bilibili.com/', '#margin-root'],
    ['watch', 'https://www.bilibili.com/video/BV1mdxN68E7F/', '#margin-watch-top'],
    ['search', 'https://search.bilibili.com/all?keyword=test', '#margin-watch-top'],
  ]) {
    await seed({}); await page.goto(url); await page.locator(`${host} .top`).waitFor();
    await check(`dynamic-later-${name}`, async () => {
      await page.locator(`${host} .et-btn[aria-label="动态"]`).hover();
      const pop = page.locator(`${host} .dp[aria-label="最新动态"]`);
      const button = pop.locator('.dp-entry').first().getByRole('button');
      await button.waitFor({ timeout: 1500 });
      await page.waitForTimeout(350);
      const tabs = context.pages().length, before = laterRequests.length;
      const href = page.url();
      const position = await button.boundingBox();
      await button.dblclick();
      await pop.locator('.card-later[data-state="ok"]').first().waitFor();
      assert.equal(laterRequests.length, before + 1);
      assert.match(laterRequests.at(-1), /^BV/);
      assert.equal(await button.getAttribute('aria-label'), '已加入稍后再看');
      const addedPosition = await button.boundingBox();
      assert(Math.abs(position.y - addedPosition.y) < 1, 'button moved after adding');
      assert.equal(context.pages().length, tabs); assert.equal(page.url(), href);
      assert(await pop.isVisible());
      await page.screenshot({ path: join(out, `${name}-later.png`) });
    });
    await check(`dynamic-later-retry-${name}`, async () => {
      const button = page.locator(`${host} .dp[aria-label="最新动态"] .dp-entry`).nth(1).getByRole('button');
      rejectLater = true;
      try {
        await button.click();
        await button.and(page.getByRole('button', { name: '重试添加', exact: true })).waitFor();
      } finally { rejectLater = false; }
      await button.click();
      await button.and(page.getByRole('button', { name: '已加入稍后再看', exact: true })).waitFor();
    });
    await page.keyboard.press('Escape'); await page.mouse.move(5, 850);
    await check(`drop-search-${name}`, async () => {
      const text = '评论中的关键词';
      const form = page.locator(`${host} .top .search`);
      await form.evaluate((element, text) => {
        const data = new DataTransfer(); data.setData('text/plain', text);
        element.dispatchEvent(new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true }));
        element.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
      }, text);
      const input = page.locator(`${host} .cp[data-open="true"] input`);
      await input.waitFor({ timeout: 1500 });
      assert.equal(await input.inputValue(), text);
      const replacement = `${text} 补充`;
      await input.evaluate((element, text) => {
        const data = new DataTransfer(); data.setData('text/plain', text);
        element.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
      }, replacement);
      assert.equal(await input.inputValue(), replacement);
      const tabs = context.pages().length;
      await page.waitForTimeout(180);
      assert.equal(context.pages().length, tabs);
      const opened = context.waitForEvent('page'); await input.press('Enter');
      const result = await opened;
      await result.waitForLoadState('domcontentloaded');
      assert.equal(new URL(result.url()).searchParams.get('keyword'), replacement);
      await result.close();
    });
  }
  for (const [name, url, selector] of [
    ['hero', 'https://www.bilibili.com/', '#margin-root .hero-search'],
    ['palette-header', 'https://message.bilibili.com/#/whisper', '#margin-root .top .search'],
  ]) {
    await check(`drop-search-${name}`, async () => {
      await seed({}); await page.goto(url);
      const form = page.locator(selector);
      const input = name === 'palette-header' ? page.locator('#margin-root .cp[data-open="true"] input') : form.locator('input');
      await form.waitFor();
      const tabs = context.pages().length;
      const drop = async (text, file = false) => form.evaluate((el, { text, file }) => {
        const data = new DataTransfer(); data.setData('text/plain', text);
        if (file) data.items.add(new File(['image'], 'image.png', { type: 'image/png' }));
        el.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
      }, { text, file });
      await drop('  评论关键词  ');
      if (name === 'palette-header') await input.waitFor();
      assert.equal(await input.inputValue(), '评论关键词');
      await drop('   '); await drop('文件拖拽', true);
      assert.equal(await input.inputValue(), '评论关键词');
      assert.equal(context.pages().length, tabs);
    });
  }
  await check('search-filter-column', async () => {
    await seed({ filters: { keywords: [], ups: [], minViews: 0, minDuration: 180 } });
    await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
      if (location.hostname !== 'search.bilibili.com') return;
      const list = document.querySelector('.video-list'); list.classList.add('row');
      list.style.cssText = 'display:flex;flex-wrap:wrap';
      for (const card of [...list.children]) {
        const col = document.createElement('div'); col.className = 'col_3'; col.style.width = '25%';
        card.before(col); col.append(card);
      }
    }));
    await page.goto('https://search.bilibili.com/all?keyword=test');
    await page.locator('[data-k="low"][data-margin-filtered]').waitFor({ state: 'attached' });
    const short = page.locator('.col_3').filter({ has: page.locator('[data-k="low"]') });
    assert.equal(await short.isVisible(), false, 'filtered search result still occupies a grid column');
    await seed({ filters: { keywords: [], ups: [], minViews: 0, minDuration: 0 } });
    await short.waitFor({ state: 'visible' });
    assert(await page.locator('[data-k="low"]').isVisible());
  });
  await check('search-filter-unrelated-mutations', async () => {
    await seed({ filters: { keywords: [], ups: [], minViews: 0, minDuration: 180 } });
    const cdp = await context.newCDPSession(page), worlds = new Map();
    cdp.on('Runtime.executionContextCreated', ({ context }) => worlds.set(context.id, context));
    await cdp.send('Runtime.enable');
    const origin = worker.url().split('/').slice(0, 3).join('/');
    const world = [...worlds.values()].find(value => value.origin === origin);
    assert(world);
    const evaluate = async expression => {
      const result = await cdp.send('Runtime.evaluate', { contextId: world.id, expression, returnByValue: true });
      assert(!result.exceptionDetails);
      return result.result.value;
    };
    await page.waitForTimeout(600);
    await evaluate(`window.filterScans = 0;
      window.originalQuery = Document.prototype.querySelectorAll;
      Document.prototype.querySelectorAll = function(selector) {
        if (selector === '.search-content, .video-list, #search-content') window.filterScans++;
        return window.originalQuery.call(this, selector);
      };`);
    try {
      for (let i = 0; i < 4; i++) {
        await page.evaluate(() => {
          let unrelated = document.getElementById('unrelated-comments');
          if (!unrelated) { unrelated = document.createElement('div'); unrelated.id = 'unrelated-comments'; document.body.append(unrelated); }
          unrelated.append(document.createElement('p'));
        });
        await page.waitForTimeout(180);
      }
      const scans = await evaluate('window.filterScans');
      assert.equal(scans, 0, 'unrelated comments caused full result scans');
      await page.locator('[data-k="normal"] .bili-video-card__stats__duration').evaluate(el => { el.textContent = '2:59'; });
      await page.locator('[data-k="normal"][data-margin-filtered]').waitFor({ state: 'attached' });
      assert(await evaluate('window.filterScans') > 0, 'changed video duration was not scanned');
      await page.locator('[data-k="normal"] .bili-video-card__stats__duration').evaluate(el => { el.textContent = '3:00'; });
      await page.locator('[data-k="normal"]').waitFor({ state: 'visible' });
      await page.locator('[data-k="low"] .bili-video-card__stats__duration').evaluate(el => { el.textContent = ''; });
      await page.locator('[data-k="low"]').waitFor({ state: 'visible' });
      await page.locator('.search-content').evaluate(el => {
        const replacement = el.cloneNode(true);
        replacement.querySelector('[data-k="normal"] .bili-video-card__stats__duration').textContent = '2:59';
        el.replaceWith(replacement);
      });
      await page.locator('[data-k="normal"][data-margin-filtered]').waitFor({ state: 'attached' });
      return { unrelatedScans: scans };
    } finally {
      await evaluate('Document.prototype.querySelectorAll = window.originalQuery');
      await cdp.detach();
    }
  });
  await check('home-exit-stable', async () => {
    await seed({}); await page.goto('https://www.bilibili.com/');
    const exit = page.locator('#margin-root .et-btn[aria-label="原版"]');
    await exit.waitFor();
    await page.locator('#margin-root .home-grid').evaluate(grid => grid.append(...[...grid.children].map(card => card.cloneNode(true))));
    assert.equal(await page.locator('#margin-root .home-exit').count(), 0);
    await exit.click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(200);
    assert.equal(await page.locator('#margin-root').count(), 0);
    await page.locator('#margin-back').waitFor();
  });
} finally {
  writeFileSync(join(out, 'results.json'), JSON.stringify({ results, laterRequests }, null, 2));
  await context.close();
}
if (results.some(result => !result.ok)) process.exitCode = 1;
