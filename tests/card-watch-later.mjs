import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { apiBody, installMocks } from './mocks.mjs';

const ext = resolve(process.env.SMOKE_EXT || 'dist');
const ctx = await chromium.launchPersistentContext('', {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, args: [`--load-extension=${ext}`, `--disable-extensions-except=${ext}`],
});
try {
  const writes = [], lookups = [];
  let failRemoval = true;
  await installMocks(ctx, url => {
    if (url.includes('/feed/rcmd')) {
      const body = apiBody(url);
      body.data.item[0].aid = 1234;
      return body;
    }
    if (new URL(url).pathname === '/x/web-interface/view') {
      lookups.push(new URL(url).searchParams.get('bvid'));
      return { code: 0, data: { aid: 5678 } };
    }
    if (url.endsWith('/toview/del')) return { code: failRemoval ? -1 : 0 };
  });
  ctx.on('request', req => {
    if (req.method() === 'POST' && /\/toview\/(add|del)$/.test(req.url())) {
      writes.push([req.url().split('/').pop(), Object.fromEntries(new URLSearchParams(req.postData()))]);
    }
  });
  const worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': { intro: false } }));
  const page = await ctx.newPage();
  await page.goto('https://www.bilibili.com/');
  await page.evaluate(() => { document.cookie = 'bili_jct=fixture;path=/'; });
  const cards = page.locator('#margin-root main .grid .card');
  const first = cards.first().locator('.card-later');
  const burst = b => b.evaluate(el => { el.click(); el.click(); });
  await burst(first);
  await first.and(page.getByRole('button', {name:'取消稍后再看'})).waitFor();
  await burst(first);
  await first.and(page.getByRole('button', {name:'取消失败，点击重试'})).waitFor();
  assert.equal(await first.getAttribute('aria-pressed'), 'true');
  failRemoval = false;
  await burst(first);
  await first.and(page.getByRole('button', {name:'加入稍后再看'})).waitFor();
  await burst(first);
  await first.and(page.getByRole('button', {name:'取消稍后再看'})).waitFor();
  assert.deepEqual(writes.map(([action]) => action), ['add','del','del','add']);
  assert.equal(writes[1][1].aid,'1234');
  assert.deepEqual(lookups, []);
  const next = cards.nth(1).locator('.card-later');
  await burst(next);
  await next.and(page.getByRole('button', {name:'取消稍后再看'})).waitFor();
  await burst(next);
  await next.and(page.getByRole('button', {name:'加入稍后再看'})).waitFor();
  assert.deepEqual(lookups,[writes[4][1].bvid]);
  assert.deepEqual(writes[5], ['del',{aid:'5678',csrf:'fixture'}]);
  assert.equal(page.url(),'https://www.bilibili.com/');
  console.log('PASS add, undo, retry, repeated clicks, re-add, BV-only covers');
} finally { await ctx.close(); }
