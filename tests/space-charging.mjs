import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { installMocks } from './mocks.mjs';

// 空间页「全部 / 充电视频」筛选：原生空间「更多筛选 → 充电专属」用 arc/search 的 special_type=charging，
// 不带筛选时 list.slist 给出充电专属数量；数量为 0 时不显示筛选。
const ext = resolve(process.env.SMOKE_EXT || 'dist');
const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/space-charging');
mkdirSync(out, { recursive: true });
const videos = JSON.parse(readFileSync(new URL('./fixtures/pop.json', import.meta.url), 'utf8'));
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-space-charging-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  viewport: { width: 1440, height: 1000 }, locale: 'zh-CN',
});
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const charging = videos.slice(0, 4);
const requests = [], results = [], errors = [];
const page = context.pages()[0];
page.on('pageerror', error => errors.push(error.message));
const row = (v, paid) => ({ bvid: v.bvid, title: v.title, pic: v.pic, length: mmss(v.dur), author: '映间编辑部', mid: 2, play: v.play, video_review: 1, created: v.pub,
  elec_arc_badge: paid ? '充电专属' : '', is_charging_arc: paid });
try {
  await installMocks(context, async url => {
    const u = new URL(url);
    if (!u.pathname.includes('/arc/search')) return;
    const mid = u.searchParams.get('mid');
    const special = u.searchParams.get('special_type');
    const keyword = u.searchParams.get('keyword') || '';
    requests.push({ mid, special, keyword, order: u.searchParams.get('order') });
    if (mid === '3') return { code: 0, data: { list: { vlist: videos.slice(0, 3).map(v => row(v, false)), slist: [], tlist: {} }, page: { count: 3 } } };
    if (special === 'charging') {
      const list = charging.filter(v => v.title.includes(keyword));
      return { code: 0, data: { list: { vlist: list.map(v => row(v, true)), slist: [], tlist: {} }, page: { count: list.length } } };
    }
    return { code: 0, data: { list: { vlist: videos.slice(0, 12).map((v, i) => row(v, i < 4)), slist: [{ count: charging.length, name: '充电专属', special_type: 'charging' }], tlist: {} }, page: { count: 12 } } };
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': { intro: false, theme: 'dark' } }));
  const cards = page.locator('#margin-root .main > .grid .card:not(.sk)');
  const kind = page.locator('#margin-root .sp-kind');

  await page.goto('https://space.bilibili.com/2');
  await cards.nth(11).waitFor();
  await kind.waitFor({ state: 'visible' });
  assert.match(await kind.locator('[data-v=charging]').textContent(), /充电视频\s*4/);
  assert.equal(await kind.locator('[data-v=all]').getAttribute('aria-checked'), 'true');
  results.push('filter appears with charging count');

  await kind.locator('[data-v=charging]').click();
  await cards.nth(4).waitFor({ state: 'detached' });
  await cards.nth(3).waitFor();
  assert.equal(requests.at(-1).special, 'charging');
  assert.equal(await page.locator('#margin-root .main > .grid .card:not(.sk) .tag-charge').count(), 4);
  await page.screenshot({ path: join(out, 'charging.png') });
  results.push('charging filter requests special_type=charging and lists only charging videos');

  await page.locator('#margin-root .sp-sort:not(.sp-kind):not(.sp-layout) [data-v=click]').click();
  await page.waitForTimeout(300);
  assert.deepEqual([requests.at(-1).special, requests.at(-1).order], ['charging', 'click']);
  results.push('sort keeps the charging filter');

  const q = charging[1].title.slice(0, 4);
  await page.locator('#margin-root .sp-q-in').fill(q);
  await page.locator('#margin-root .sp-q-in').press('Enter');
  await page.waitForTimeout(500);
  assert.deepEqual([requests.at(-1).special, requests.at(-1).keyword], ['charging', q]);
  assert.equal(await cards.count(), charging.filter(v => v.title.includes(q)).length);
  results.push('search inside the charging filter stays server-side');

  await page.locator('#margin-root .sp-q-in').fill('');
  await page.locator('#margin-root .sp-q-in').press('Enter');
  await kind.locator('[data-v=all]').click();
  await cards.nth(11).waitFor();
  assert.equal(requests.at(-1).special, null);
  results.push('back to all videos');

  await page.locator('#margin-root .sp-bar [data-tab="dynamic"]').click();
  assert.equal(await kind.isHidden(), true);
  await page.locator('#margin-root .sp-bar [data-tab="video"]').click();
  await cards.first().waitFor();
  assert.equal(await kind.isVisible(), true);
  results.push('filter only shows on the video tab');

  for (const width of [1920, 1280, 1100]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.locator('#margin-root .sp-bar').evaluate(el => el.scrollWidth - el.clientWidth);
    assert(overflow < 2, `space toolbar overflow ${overflow}px at ${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  results.push('toolbar fits at 1100–1920px');

  await page.goto('https://space.bilibili.com/3');
  await cards.nth(2).waitFor();
  await page.waitForTimeout(200);
  assert.equal(await kind.isHidden(), true);
  results.push('hidden when the UP has no charging videos');
  assert.deepEqual(errors, []);
} finally {
  writeFileSync(join(out, 'results.json'), JSON.stringify({ results, requests, errors }, null, 2));
  await context.close();
}
console.log(JSON.stringify(results));
