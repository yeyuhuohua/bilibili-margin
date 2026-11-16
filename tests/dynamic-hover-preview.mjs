import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installMocks } from './mocks.mjs';

const extension = resolve(process.env.SMOKE_EXT || 'dist');
const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/dynamic-hover-preview');
mkdirSync(out, { recursive: true });
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-dynamic-preview-')), {
  channel: 'chromium', headless: true, viewport: { width: 1440, height: 1000 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
const results = [], errors = [], requests = [];
let fail = false, delayed = false;
const items = Array.from({ length: 5 }, (_, index) => ({
  id_str: String(900001 + index), type: index === 0 ? 'DYNAMIC_TYPE_AV' : 'DYNAMIC_TYPE_DRAW',
  modules: {
    module_author: { mid: 1, name: '预览作者', face: 'https://i0.hdslb.com/face.jpg', pub_ts: 1700000000 },
    module_stat: {},
    module_dynamic: {
      desc: { text: `详情正文 ${index + 1}` },
      major: index === 0
        ? { archive: { bvid: 'BV1demo00001', title: '视频详情', cover: 'https://i0.hdslb.com/video.jpg', stat: {} } }
        : index === 2
          ? { article: { title: '专栏详情', desc: '正文链接', jump_url: 'https://www.bilibili.com/read/cv12345', covers: [] } }
          : { opus: { title: `图文 ${index + 1}`, summary: { text: `详情正文 ${index + 1}` }, pics: [{ url: 'https://i0.hdslb.com/picture.jpg' }] } },
    },
  },
}));
try {
  await installMocks(context, async address => {
    const url = new URL(address);
    if (url.pathname.endsWith('/feed/all')) return { code: 0, data: { items, has_more: false, offset: '' } };
    if (!url.pathname.endsWith('/web-dynamic/v1/detail')) return null;
    const id = url.searchParams.get('id');
    requests.push(id);
    if (delayed && id === '900004') await new Promise(resolve => setTimeout(resolve, 900));
    if (fail && id === '900005') return { code: -500, message: '测试失败' };
    return { code: 0, data: { item: items.find(item => item.id_str === id) } };
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': {
    intro: false, theme: 'dark', bg: { mode: 'off' }, weather: false, footprint: false,
  } }));
  const page = context.pages()[0];
  page.setDefaultTimeout(8000);
  page.on('pageerror', error => errors.push(error.message));
  for (const [name, url, host] of [
    ['home', 'https://www.bilibili.com/', '#margin-root'],
    ['watch', 'https://www.bilibili.com/video/BV1mdxN68E7F/', '#margin-watch-top'],
  ]) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(url);
    const root = page.locator(host);
    const trigger = root.locator('.et-btn[aria-label="动态"]');
    const pop = root.locator('.dp[aria-label="最新动态"]');
    const detail = pop.locator('.dp-detail');
    const rows = pop.locator('.dp-dynamic');
    const openRow = async index => {
      await trigger.hover();
      await rows.nth(index).hover();
      await detail.waitFor({ state: 'visible' });
    };
    const follow = async (link, expected) => {
      const opened = page.waitForEvent('popup');
      await link.click();
      const target = await opened;
      await target.waitForURL(expected);
      await target.close();
    };
    await trigger.hover();
    const before = requests.length;
    await rows.first().hover();
    await page.waitForTimeout(100);
    await page.mouse.move(10, 900);
    await page.waitForTimeout(600);
    assert.equal(requests.length, before);
    assert.equal(await detail.isVisible(), false);
    results.push(`${name}: brief pointer passes do not fetch details`);

    await openRow(0);
    await detail.locator('.dy-video').waitFor();
    await detail.hover();
    await page.waitForTimeout(300);
    assert.equal(await detail.isVisible(), true);
    await follow(detail.locator('.dy-video'), 'https://www.bilibili.com/video/BV1demo00001');
    await page.keyboard.press('Escape');
    assert.equal(await detail.isVisible(), false);
    const cachedRequests = requests.length;
    await openRow(0);
    await detail.locator('.dy-video').waitFor();
    assert.equal(requests.length, cachedRequests);
    results.push(`${name}: video navigation, cross-panel hover, Escape and short detail cache`);
    await page.keyboard.press('Escape');

    await openRow(1);
    await follow(detail.locator('.dy-pics a'), 'https://www.bilibili.com/opus/900002');
    assert.equal(await root.locator('.lightbox').count(), 0);
    await page.keyboard.press('Escape');
    await openRow(2);
    await follow(detail.locator('.dy-article'), 'https://www.bilibili.com/read/cv12345');
    results.push(`${name}: images open dynamic pages and other content links remain usable`);
    await page.keyboard.press('Escape');

    delayed = true;
    await openRow(3);
    await page.waitForFunction(() => document.querySelector('#margin-root, #margin-watch-top').shadowRoot.querySelector('.dp-detail-scroll[aria-busy="true"]'));
    await rows.nth(1).hover();
    await page.waitForTimeout(1600);
    assert.match(await detail.textContent(), /图文 2/);
    assert.doesNotMatch(await detail.textContent(), /图文 4/);
    delayed = false;
    results.push(`${name}: an old slow response cannot overwrite the current detail`);
    await page.keyboard.press('Escape');

    fail = true;
    await openRow(4);
    await detail.getByRole('button', { name: '重新获取' }).waitFor();
    fail = false;
    await detail.getByRole('button', { name: '重新获取' }).click();
    await detail.locator('.dy-title').waitFor();
    assert.match(await detail.textContent(), /图文 5/);
    results.push(`${name}: failed detail requests can be retried`);
    await page.keyboard.press('Escape');

    await page.setViewportSize({ width: 720, height: 850 });
    await openRow(1);
    const bounds = await detail.boundingBox();
    assert(bounds.x >= 0 && bounds.x + bounds.width <= 721);
    await page.screenshot({ path: join(out, `${name}-narrow.png`) });
    await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': {
      intro: false, theme: 'light', bg: { mode: 'off' }, weather: false, footprint: false,
    } }));
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(out, `${name}-light.png`) });
    assert.equal(await detail.isVisible(), true);
    results.push(`${name}: the detail fits a narrow desktop window and remains visible after theme changes`);
    await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': {
      intro: false, theme: 'dark', bg: { mode: 'off' }, weather: false, footprint: false,
    } }));
  }
  assert.deepEqual(errors, []);
  console.log(`PASS ${results.length} dynamic preview groups`);
} finally {
  writeFileSync(join(out, 'report.json'), JSON.stringify({ results, errors, requests }, null, 2));
  await context.close();
}
