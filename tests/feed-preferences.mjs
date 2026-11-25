import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { installMocks } from './mocks.mjs';

const ext = resolve(process.env.SMOKE_EXT || 'dist');
const context = await chromium.launchPersistentContext('', {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
try {
  const requests = [];
  const post = type => ({ id_str: type, type: 'DYNAMIC_TYPE_' + type, modules: {
    module_author: { mid: 1, name: '测试' }, module_dynamic: { desc: { text: type } },
  } });
  await installMocks(context, url => {
    if (!url.includes('/web-dynamic/v1/feed/all')) return;
    const params = new URL(url).searchParams;
    if (!params.has('offset')) return;
    requests.push([params.get('type'), params.get('offset')]);
    const next = params.get('offset') === 'next';
    return { code: 0, data: { items: (next ? ['WORD', 'DRAW', 'ARTICLE', 'AV', 'PGC'] : ['AV']).map(post),
      has_more: !next, offset: next ? '' : 'next' } };
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page = await context.newPage(); page.setDefaultTimeout(6500);
  for (const tab of ['following','classic','popular','unknown']) {
    await worker.evaluate(tab => chrome.storage.local.set({ 'margin:settings': { intro:false, homeDefaultTab:tab, weather:false, footprint:false, bg:{mode:'off'} } }), tab);
    await page.goto('https://www.bilibili.com/');
    await page.locator(`#margin-root .home-grid`).waitFor();
    await page.locator(`.bar .tab[data-tab="${tab === 'unknown' ? 'rcmd' : tab}"][aria-selected="true"]`).waitFor();
  }
  const card = page.locator('#margin-root .home-grid .card:not(.sk)').nth(14);
  await card.scrollIntoViewIfNeeded();
  await card.hover();
  const app = page.locator('#margin-root .app').first();
  const before = await app.evaluate(el => el.scrollTop);
  assert(before > 200);
  await card.getByRole('button', { name: '更多操作' }).click();
  await page.getByRole('menuitem', { name: /^不看「/ }).click();
  await page.getByText(/^已屏蔽「/).first().waitFor();
  await page.waitForFunction(() => {
    const root = document.querySelector('#margin-root').shadowRoot;
    const name = root.querySelector('.toast')?.textContent?.match(/已屏蔽「(.*?)」/)?.[1];
    return name && !Array.from(root.querySelectorAll('.home-grid .author-name')).some(el => el.textContent === name);
  });
  assert(Math.abs(await app.evaluate(el => el.scrollTop) - before) < 3, 'filtering moved the scroll position');
  requests.length = 0;
  await page.goto('https://t.bilibili.com/?tab=posts');
  await page.getByRole('tab', { name:'图文', selected:true }).waitFor();
  await page.getByRole('button', { name:'继续查找图文' }).click();
  const list = page.locator('.fd-list');
  for (const kind of ['WORD','DRAW','ARTICLE']) await list.getByText(kind, { exact:true }).first().waitFor();
  assert.equal(await list.getByText('AV', { exact:true }).count(), 0);
  assert.equal(await list.getByText('PGC', { exact:true }).count(), 0);
  assert.deepEqual(requests, [['all',''],['all','next']]);
  console.log('PASS default home tabs, invalid preference, block without scroll jump, mixed posts and pagination');
} finally { await context.close(); }
