import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { installMocks } from './mocks.mjs';

const ext = resolve(process.env.SMOKE_EXT || 'dist');
const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/space-collection-order');
mkdirSync(out, { recursive: true });
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-collection-order-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, viewport: { width: 1440, height: 1000 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const checks = [], requests = [], errors = [];
let fail = false, hold = false, release;
try {
  await installMocks(context, async url => {
    const u = new URL(url), p = u.pathname, q = u.searchParams;
    if (p.endsWith('/seasons_series_list')) return { code: 0, data: { items_lists: { page: { total: 2 }, seasons_list: [{ meta: { season_id: 1, name: '测试合集', total: 35 } }], series_list: [{ meta: { series_id: 2, name: '测试系列', total: 35 } }] } } };
    if (p.endsWith('/seasons_archives_list') || p.endsWith('/series/archives')) {
      const kind = p.endsWith('/series/archives') ? 'series' : 'season';
      const reverse = kind === 'season' ? q.get('sort_reverse') === 'true' : q.get('sort') === 'asc';
      const page = Number(q.get(kind === 'season' ? 'page_num' : 'pn'));
      requests.push({ kind, reverse, page, sort: q.get('sort'), sort_reverse: q.get('sort_reverse') });
      if (hold) { hold = false; await new Promise(resolve => { release = resolve; }); }
      if (fail) { fail = false; return { code: -500, message: '测试排序失败' }; }
      const ids = Array.from({ length: 35 }, (_, i) => reverse ? i + 1 : 35 - i).slice((page - 1) * 30, page * 30);
      return { code: 0, data: { page: { total: 35 }, archives: ids.map(id => ({ aid: id, bvid: `BV${kind}${id}`, title: `${kind} 视频 ${id}`, pic: 'https://i0.hdslb.com/test.jpg', pubdate: 1600000000 + id, stat: { view: id } })) } };
    }
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': { intro: false, theme: 'dark', bg: { mode: 'off' }, weather: false, footprint: false } }));
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  const cards = page.locator('#margin-root .main > :is(.grid,.vlist) > .card');
  const sort = page.getByRole('radiogroup', { name: '合集视频排序', exact: true });
  for (const kind of ['series', 'season']) {
    await page.goto('https://space.bilibili.com/2?margin_tab=collections');
    await page.locator(`.sp-collection[data-kind="${kind}"] .title`).click();
    await cards.first().waitFor();
    assert.equal(await sort.count(), 1, 'collection needs an order control');
    assert.equal(await cards.first().locator('.title,.vr-title').textContent(), `${kind} 视频 35`);
    const mark = requests.length;
    await sort.getByRole('radio', { name: '倒序排序', exact: true }).click();
    await page.waitForFunction(kind => document.querySelector('#margin-root').shadowRoot.querySelector('.main > :is(.grid,.vlist) > .card .title')?.textContent === `${kind} 视频 1`, kind);
    await page.locator('.main > .sentinel').scrollIntoViewIfNeeded();
    await cards.nth(34).waitFor();
    assert.equal(await cards.count(), 35);
    assert.equal(await cards.last().locator('.title').textContent(), `${kind} 视频 35`);
    assert(requests.slice(mark).every(r => r.reverse));
    assert(requests.slice(mark).some(r => r.page === 2));
    checks.push(`${kind}: native default and reverse across pages, no client-only reversal`);
    await page.getByRole('radio', { name: '列表', exact: true }).click();
    await cards.first().locator('.vr-title').waitFor();
    assert.equal(await sort.getByRole('radio', { name: '倒序排序', exact: true }).getAttribute('aria-checked'), 'true');
    assert.equal(await cards.first().locator('.vr-title').textContent(), `${kind} 视频 1`);
    fail = true;
    await sort.getByRole('radio', { name: '默认排序', exact: true }).click();
    await page.getByText('加载失败：测试排序失败', { exact: true }).waitFor();
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await cards.first().locator('.vr-title').waitFor();
    assert.equal(await cards.first().locator('.vr-title').textContent(), `${kind} 视频 35`);
    checks.push(`${kind}: layout preserves order; retry preserves requested order`);
    await page.screenshot({ path: join(out, `${kind}.png`) });
    await page.getByRole('radio', { name: '网格', exact: true }).click();
    await cards.first().locator('.title').waitFor();
    hold = true;
    await sort.getByRole('radio', { name: '倒序排序', exact: true }).click();
    for (let i = 0; !release && i < 100; i++) await page.waitForTimeout(20);
    assert(release);
    await sort.getByRole('radio', { name: '默认排序', exact: true }).click();
    await cards.first().locator('.title').waitFor();
    release(); release = undefined;
    await page.waitForTimeout(200);
    assert.equal(await cards.first().locator('.title').textContent(), `${kind} 视频 35`);
    checks.push(`${kind}: late response cannot overwrite newer order`);
    const input = page.getByRole('searchbox', { name: '搜索合集内视频' });
    await input.fill('视频 35'); await input.press('Enter');
    await page.waitForFunction(() => document.querySelector('#margin-root').shadowRoot.querySelector('[aria-label="合集视频排序"]').hidden);
    await input.fill(''); await input.press('Enter');
    await sort.waitFor({ state: 'visible' });
    assert.equal(await sort.getByRole('radio', { name: '默认排序', exact: true }).getAttribute('aria-checked'), 'true');
    checks.push(`${kind}: search uses existing search order and restores browsing control on clear`);
  }
  await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': { intro: false, theme: 'light', bg: { mode: 'off' }, weather: false, footprint: false } }));
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.waitForTimeout(500);
  const bounds = await sort.evaluate(el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, width: innerWidth }; });
  assert(bounds.left >= 0 && bounds.right <= bounds.width);
  await page.screenshot({ path: join(out, 'light-1024.png') });
  checks.push('light theme and narrower desktop keep order control in bounds');
  assert.deepEqual(errors, []);
} finally {
  await context.close();
  writeFileSync(join(out, 'results.json'), JSON.stringify({ checks, requests, errors }, null, 2));
}
console.log(JSON.stringify({ checks }));
