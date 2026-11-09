// 推荐批次导航：验证切窗、左右翻批不发请求、换一批追加并跳转、关闭自动补页、
// 始终保留一轮预载、无刷新键时的末批加载，以及修改每批条数后重新切窗。
//   npm run build && node tests/feed-batches.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installMocks } from './mocks.mjs';

const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/feed-batches');
mkdirSync(out, { recursive: true });
const extension = resolve(process.env.SMOKE_EXT || 'dist'), results = [], errors = [];
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-feed-batches-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  viewport: { width: 1440, height: 900 }, locale: 'zh-CN',
});
const NOW = Math.floor(Date.now() / 1000);
let rcmdCalls = 0;
let requestDelay = 0;
/** 每次推荐请求返回 12 条，标题带全局序号：第 n 条 = (fresh_idx - 1) * 12 + i + 1 */
const page_ = async (url) => {
  if (!url.includes('/x/web-interface/wbi/index/top/feed/rcmd')) return null;
  rcmdCalls++;
  const round = Number(new URL(url).searchParams.get('fresh_idx') ?? 1);
  if (requestDelay) await new Promise(resolve => setTimeout(resolve, requestDelay));
  return { code: 0, data: { item: Array.from({ length: 12 }, (_, i) => {
    const n = (round - 1) * 12 + i + 1;
    return { goto: 'av', bvid: `BV${String(n).padStart(10, '0')}`, cid: n, title: `第 ${n} 条推荐`, pic: `https://i0.hdslb.com/bfs/x${n}.jpg`,
      duration: 300, pubdate: NOW, owner: { name: '批量 UP', mid: n, face: '' }, stat: { view: 1000, danmaku: 10 } };
  }) } };
};
try {
  await installMocks(context, page_);
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page = await context.newPage(); page.setDefaultTimeout(8000);
  page.on('pageerror', (e) => errors.push(e.message));
  const seed = (extra) => worker.evaluate((patch) => chrome.storage.local.set({ 'margin:settings': {
    intro: false, theme: 'light', bg: { mode: 'off' }, footprint: false, weather: false,
    batchNav: true, batchSize: 12, batchRefresh: true, ...patch,
  } }), extra);
  const R = "document.getElementById('margin-root').shadowRoot";
  const cards = () => page.evaluate(`(${R}).querySelectorAll('.grid .card:not(.sk)').length`);
  const firstTitle = () => page.evaluate(`(${R}).querySelector('.grid .card .title')?.textContent ?? ''`);
  const bar = (sel) => page.evaluate(`(() => { const e = (${R}).querySelector('${sel}'); return e ? { hidden: e.hidden, off: e.dataset.off, display: getComputedStyle(e).display } : null; })()`);
  const until = async (fn, ms = 5000) => {
    const t = Date.now();
    let last;
    // 刷新后 shadow root 还没挂上时求值会抛错，按未就绪继续等
    while (Date.now() - t < ms) {
      try { if (await fn()) return; } catch (e) { last = e; }
      await page.waitForTimeout(80);
    }
    throw last ?? new Error('timeout');
  };
  const passed = (name) => { results.push(name); console.log(`PASS ${name}`); };

  await seed({});
  await page.goto('https://www.bilibili.com/');
  await until(async () => (await cards()) === 12);
  assert.equal(await firstTitle(), '第 1 条推荐');
  assert.equal((await bar('.batch-bar'))?.hidden, false);
  assert.equal((await bar('.batch-btn:first-child'))?.off, 'true');
  assert.equal((await bar('.batch-btn:last-child'))?.off, 'false');
  assert.equal(await page.evaluate(`(${R}).querySelector('.bar-acts > .batch-bar') !== null`), true);
  assert.equal(await page.evaluate(`getComputedStyle((${R}).querySelector('.bar-acts > .refresh')).display`), 'none');
  passed('首批 12 条，导航条占据原换一批位置');

  const calls = rcmdCalls;
  await page.evaluate(`(${R}).querySelector('.batch-btn:last-child').click()`);
  await until(async () => (await firstTitle()) === '第 13 条推荐');
  assert.equal(await cards(), 12);
  assert.equal(rcmdCalls, calls, '翻到下一批不应发请求');
  await page.evaluate(`(${R}).querySelector('.app').scrollTo(0, 99999)`);
  await page.waitForTimeout(500);
  assert.equal(rcmdCalls, calls, '批次模式不应随滚动补页');
  const deepTop = await page.evaluate(`(${R}).querySelector('.app').scrollTop`);
  await page.evaluate(`(${R}).querySelector('.batch-btn:first-child').click()`);
  await until(async () => (await firstTitle()) === '第 1 条推荐');
  assert.equal(await page.evaluate(`(${R}).querySelector('.app').scrollTop`), deepTop, '翻批不应挪动滚动位置');
  passed('左右箭头零请求翻批，滚动不补页');

  await page.evaluate(`(${R}).querySelector('.batch-btn.go').click()`);
  await until(async () => (await firstTitle()) === '第 25 条推荐');
  assert.equal(rcmdCalls, calls + 2, '换一批只追加一页（两次推荐请求）');
  assert.equal(await cards(), 12);
  assert.ok(await page.evaluate(`(${R}).querySelector('.app').scrollTop`) <= deepTop, '刷新回到视频首行');
  passed('换一批追加一页并定位到新内容');

  await seed({ batchSize: 24 });
  await until(async () => (await cards()) === 24);
  assert.equal(await firstTitle(), '第 25 条推荐');
  assert.equal(rcmdCalls, calls + 2, '改每批条数不应重新请求');
  passed('修改每批条数围绕当前位置重新切窗');

  await seed({ batchSize: 24, batchRefresh: false });
  await page.reload();
  await until(async () => (await cards()) === 24);
  assert.equal((await bar('.batch-btn.go'))?.hidden, true);
  assert.equal((await bar('.batch-btn:last-child'))?.off, 'false');
  const hiddenCalls = rcmdCalls;
  await page.evaluate(`(${R}).querySelector('.app').scrollTo(0, 300)`);
  await page.waitForTimeout(200);
  await page.evaluate(`(${R}).querySelector('.batch-btn:last-child').click()`);
  await until(async () => (await firstTitle()) === '第 25 条推荐');
  assert.equal(await page.evaluate(`(${R}).querySelector('.app').scrollTop`), 300, '末批箭头加载后不应挪动滚动位置');
  assert.equal(rcmdCalls, hiddenCalls + 2, '无刷新键时末批右箭头负责加载');
  assert.equal((await bar('.batch-btn.go'))?.hidden, true);
  passed('无刷新键：末批右箭头加载下一批');

  const preCalls = rcmdCalls;
  await seed({ batchSize: 12, batchRefresh: true, batchPrefetch: true });
  // 旧页面收到设置变化也会补一轮；等它落地再刷新，避免它的请求混进新页面的计数
  await until(() => rcmdCalls === preCalls + 2);
  const reloadCalls = rcmdCalls;
  await page.reload();
  await until(async () => (await cards()) === 12);
  await until(() => rcmdCalls === reloadCalls + 4);
  assert.equal(await firstTitle(), '第 1 条推荐', '预载不应改变当前窗口');
  passed('预载开启：首屏加载后立即补一轮');

  // 预载已把队列推到 4 批；连点两次右箭头翻到第 3 批（预载内容），随即继续补下一轮
  // 缩短视口让页面有可滚动余量，验证预载开启时翻批同样不挪动位置
  await page.setViewportSize({ width: 1440, height: 520 });
  await page.waitForTimeout(300);
  await page.evaluate(`(${R}).querySelector('.app').scrollTo(0, 150)`);
  await page.waitForTimeout(100);
  const rapidCalls = rcmdCalls;
  await page.evaluate(`(() => { const b = (${R}).querySelector('.batch-btn:last-child'); b.click(); b.click(); })()`);
  await until(async () => (await firstTitle()) === '第 25 条推荐');
  assert.equal(await page.evaluate(`(${R}).querySelector('.app').scrollTop`), 150, '预载开启时翻批也不应挪动滚动位置');
  await until(() => rcmdCalls === rapidCalls + 2);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(200);
  assert.equal(await firstTitle(), '第 25 条推荐', '补页不应改变当前窗口');
  await page.evaluate(`(${R}).querySelector('.batch-btn:last-child').click()`);
  await until(async () => (await firstTitle()) === '第 37 条推荐');
  assert.equal(await cards(), 12);
  passed('连点右箭头翻到预载内容后继续补下一轮');

  // 每批 10 条时队列末尾会切出不满的一批，预载落地应重绘当前窗口
  const tenCalls = rcmdCalls;
  await seed({ batchSize: 10, batchPrefetch: true });
  await page.reload();
  await until(async () => (await cards()) === 10);
  await until(() => rcmdCalls === tenCalls + 4);
  const endCalls = rcmdCalls;
  await page.evaluate(`(() => { const b = (${R}).querySelector('.batch-btn:last-child'); for (let i = 0; i < 4; i++) b.click(); })()`);
  await until(async () => (await firstTitle()) === '第 41 条推荐');
  await until(async () => (await page.evaluate(`(${R}).querySelectorAll('.grid > .card.blank').length`)) === 0);
  assert.equal(await cards(), 10);
  await until(() => rcmdCalls >= endCalls + 2);
  passed('快速连点到不满的末批，预载后自动补满');

  await seed({ batchSize: 12, batchRefresh: true, batchPrefetch: false });
  await page.reload();
  await until(async () => (await cards()) === 12);
  const offCalls = rcmdCalls;
  await page.evaluate(`(${R}).querySelector('.batch-btn:last-child').click()`);
  await until(async () => (await firstTitle()) === '第 13 条推荐');
  await page.waitForTimeout(600);
  assert.equal(rcmdCalls, offCalls, '关闭预载时不应后台请求');
  await page.evaluate(`(${R}).querySelector('.batch-btn:last-child').click()`);
  await until(async () => (await firstTitle()) === '第 25 条推荐');
  assert.equal(rcmdCalls, offCalls + 2, '关闭预载时末批右箭头按需加载');
  passed('预载关闭：末批右箭头按需加载');

  await seed({ batchSize: 30, batchPrefetch: false });
  await page.reload();
  await until(async () => (await cards()) === 24);
  assert.equal(await page.evaluate(`(${R}).querySelectorAll('.grid > .card.blank').length`), 6);
  passed('本批不足预设条数时补空白占位');

  await seed({ batchSize: 12, batchPrefetch: false });
  await page.reload();
  await until(async () => (await cards()) === 12);
  requestDelay = 450;
  const beforePreload = rcmdCalls;
  await seed({ batchSize: 12, batchPrefetch: true });
  await until(() => rcmdCalls === beforePreload + 2);
  await page.evaluate(`(() => {
    const root = ${R};
    root.querySelector('.batch-btn.go').click();
    root.querySelector('.tab[data-tab="popular"]').click();
    root.querySelector('.tab[data-tab="rcmd"]').click();
  })()`);
  await page.waitForTimeout(1500);
  assert.equal(await firstTitle(), '第 1 条推荐', '旧刷新等待预载期间切换标签，返回后不能跳到新批次');
  requestDelay = 0;
  passed('切换标签使等待中的旧刷新失效');

  await seed({ batchSize: 12, batchPrefetch: false });
  await page.reload();
  await until(async () => (await cards()) === 12);
  await page.evaluate(`(${R}).querySelector('.app').scrollTo(0, 0)`);
  await page.evaluate(`(${R}).querySelector('.batch-btn.go').click()`);
  await until(async () => (await firstTitle()) === '第 25 条推荐');
  assert.equal(await page.evaluate(`(${R}).querySelector('.app').scrollTop`), 0);
  await page.evaluate(`(${R}).querySelector('.batch-btn:first-child').click()`);
  await until(async () => (await firstTitle()) === '第 13 条推荐');
  await page.evaluate(`(${R}).querySelector('.batch-btn:last-child').click()`);
  await until(async () => (await firstTitle()) === '第 25 条推荐');
  passed('顶部刷新保持顶部，上一批后能返回刚才的新批次');

  await page.screenshot({ path: join(out, 'batch-bar.png') });
  assert.deepEqual(errors, []);
} finally {
  writeFileSync(join(out, 'results.json'), JSON.stringify({ results, errors, rcmdCalls }, null, 2));
  await context.close();
}
