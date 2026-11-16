import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { installMocks } from './mocks.mjs';

const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/recommendation-feedback');
mkdirSync(out, { recursive: true });
const extension = resolve(process.env.SMOKE_EXT || 'dist');
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-feed-feedback-')), {
  channel: 'chromium', headless: true, viewport: { width: 1440, height: 1000 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
const requests = [], results = [], errors = [];
let concurrent = 0, maximumConcurrent = 0;
try {
  await installMocks(context, async address => {
    const url = new URL(address);
    if (!url.pathname.endsWith('/feed/rcmd')) return null;
    const params = Object.fromEntries(url.searchParams);
    requests.push(params);
    maximumConcurrent = Math.max(maximumConcurrent, ++concurrent);
    await new Promise(resolve => setTimeout(resolve, 80));
    concurrent--;
    const round = Number(params.fresh_idx);
    return { code: 0, data: { item: Array.from({ length: Number(params.ps) }, (_, i) => {
      const id = round * 12 + i + 1;
      return { goto: 'av', id, bvid: `BV${String(id).padStart(10, '0')}`, title: `推荐 ${id}`, pic: 'https://i0.hdslb.com/test.jpg', owner: { mid: id + 100, name: id === 1 ? 'Blocked' : `作者 ${id}` }, stat: { view: 1000, danmaku: 5 }, duration: 300 };
    }) } };
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': {
    intro: false, theme: 'dark', bg: { mode: 'off' }, footprint: false, weather: false,
    batchNav: true, batchSize: 12, batchPrefetch: false, appFeed: false, rerank: false,
    filters: { ups: ['Blocked'] },
  } }));
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://www.bilibili.com/');
  const root = page.locator('#margin-root');
  await root.locator('.home-grid .card:not(.sk) .title').first().waitFor();
  await page.waitForTimeout(500);
  assert.equal(requests[0].fresh_type, '0');
  assert.equal(requests[0].fresh_idx, '0');
  assert.equal(requests[0].fetch_row, '1');
  assert.equal(requests[0].ps, '10');
  assert.equal(requests[1].fresh_type, '4');
  assert.equal(requests[1].fresh_idx, '1');
  assert.equal(requests[1].fetch_row, '4');
  assert(requests[1].last_showlist.includes('av_n_1'));
  assert.equal(maximumConcurrent, 1);
  results.push('initial and continuation requests carry sequential native scene parameters');
  assert.equal(await root.locator('.home-grid .title').filter({ hasText: /^推荐 1$/ }).count(), 0);
  const first = root.locator('.home-grid .title').first();
  await first.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  const id = Number((await first.textContent()).replace('推荐 ', ''));
  await root.locator('.home-grid').evaluate(grid => {
    grid.addEventListener('click', event => event.preventDefault());
    grid.addEventListener('auxclick', event => event.preventDefault());
  });
  await first.click();
  await first.dispatchEvent('auxclick', { button: 1, bubbles: true, cancelable: true });
  await root.locator('.home-grid .author').first().click();
  await root.getByRole('button', { name: '换一批', exact: true }).filter({ visible: true }).click();
  await page.waitForFunction(() => [...document.querySelector('#margin-root').shadowRoot.querySelectorAll('.home-grid .title')].some(el => el.textContent === '推荐 25'));
  assert.equal(requests[2].fresh_type, '5');
  assert.equal(requests[2].fetch_row, '1');
  assert.equal(requests[2].fresh_idx, '2');
  const exposure = requests[2].last_showlist.split(/[;,]/);
  assert(exposure.includes(`av_${id}`));
  assert(exposure.includes('av_n_1'));
  assert(!exposure.includes('av_1'));
  assert(exposure.includes('av_n_24'));
  assert.equal(requests[2].last_clicklist, `av_${id},av_${id}`);
  results.push('visible recommendation clicks are recorded while filtered and unrendered cards remain unexposed');
  const count = requests.length;
  await root.getByRole('button', { name: '上一批', exact: true }).filter({ visible: true }).click();
  await page.waitForTimeout(300);
  assert.equal(requests.length, count);
  results.push('cached batch navigation does not reset request counters or send requests');
  await page.reload();
  await root.locator('.home-grid .title').first().waitFor();
  assert.equal(requests[count].fresh_idx, '0');
  assert.equal(requests[count].last_showlist, '');
  assert.equal(requests[count].last_clicklist, '');
  results.push('reloading the page starts a fresh in-memory feedback session');
  assert.deepEqual(errors, []);
  console.log(`PASS ${results.length} recommendation feedback groups`);
} finally {
  writeFileSync(join(out, 'report.json'), JSON.stringify({ results, errors, requests, maximumConcurrent }, null, 2));
  await context.close();
}
