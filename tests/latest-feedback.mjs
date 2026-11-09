import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installMocks } from './mocks.mjs';

const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/latest-feedback');
mkdirSync(out, { recursive: true });
const extension = resolve(process.env.SMOKE_EXT || 'dist');
const results = [];
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-feedback-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  viewport: { width: 1440, height: 900 }, locale: 'zh-CN',
});
try {
  await installMocks(context, async url => {
    if (!url.includes('/web-dynamic/v1/feed/')) return null;
    return { code: 0, data: { items: [{ id_str: '900001', type: 'DYNAMIC_TYPE_WORD',
      basic: { comment_type: 17, comment_id_str: '900001' },
      modules: { module_author: { mid: 2, name: '作者' }, module_dynamic: {
        desc: { text: '律师也要黑屏处理啦，大家及时缓存。' },
        additional: { type: 'ADDITIONAL_TYPE_UGC', ugc: { title: '附加视频', cover: 'https://i0.hdslb.com/cover.jpg',
          jump_url: '//www.bilibili.com/video/BV1mdxN68E7F/', stat: { play: '2193.6万', danmaku: '39.6万' } } },
      } },
    }], has_more: false, offset: '' } };
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page = await context.newPage();
  const check = async (name, run) => {
    try { const evidence = await run(); results.push({ name, ok: true, evidence }); console.log(`PASS ${name}`); }
    catch (error) { results.push({ name, ok: false, error: error.message }); console.log(`FAIL ${name}: ${error.message}`); }
  };
  for (const [name, url, host] of [
    ['home', 'https://www.bilibili.com/', '#margin-root'],
    ['space', 'https://space.bilibili.com/2', '#margin-root'],
    ['watch', 'https://www.bilibili.com/video/BV1mdxN68E7F/', '#margin-watch-top'],
  ]) {
    await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': { intro: false, theme: 'light', bg: { mode: 'off' } } }));
    await page.goto(url);
    await page.locator(`${host} .ts`).waitFor();
    await page.mouse.move(0, 850);
    await page.waitForTimeout(400);
    await check(`95-theme-centered-${name}`, async () => {
      const geometry = await page.locator(`${host} .ts`).evaluate(button => {
        const track = button.querySelector('.ts-c').getBoundingClientRect();
        const sun = button.querySelector('.ts-sm').getBoundingClientRect();
        return { top: sun.top - track.top, bottom: track.bottom - sun.bottom, right: track.right - sun.right };
      });
      assert(Math.abs(geometry.top - geometry.bottom) < 1, JSON.stringify(geometry));
      assert(Math.abs(geometry.right - geometry.top) < 1, JSON.stringify(geometry));
      return geometry;
    });
    if (name !== 'watch') await check(`93-cover-tooltip-${name}`, async () => {
      const cover = page.locator(`${host} .card .cover`).first();
      await cover.waitFor();
      assert.equal(await cover.getAttribute('title'), null, 'cover title creates a browser tooltip over the preview');
      assert(await cover.getAttribute('aria-label'), 'cover link must retain an accessible name');
    });
    if (name === 'home') await check('93-preview-block-icon', async () => {
      const cover = page.locator(`${host} .card .cover`).first();
      await cover.hover();
      await cover.evaluate(node => node.classList.add('playing'));
      const button = cover.locator('.card-block');
      assert.equal(await button.locator('span').isVisible(), false);
      assert(await button.getAttribute('aria-label'));
      assert((await button.boundingBox()).width <= 29);
      await cover.evaluate(node => node.classList.remove('playing'));
      assert(await button.locator('span').isVisible());
    });
    if (name === 'watch') for (const theme of ['light', 'dark']) await check(`96-native-picture-popup-${theme}`, async () => {
      await worker.evaluate(theme => chrome.storage.local.set({ 'margin:settings': { intro: false, theme, bg: { mode: 'off' } } }), theme);
      await page.locator(`html[data-margin-theme="${theme}"]`).waitFor({ state: 'attached' });
      await page.evaluate(() => {
        // Native comment popup uses a body-level bili-popup with an inline z-index above 2000.
        const popup = document.createElement('bili-popup');
        popup.style.cssText = 'position:fixed;inset:0;z-index:2001;display:block';
        const root = popup.attachShadow({ mode: 'open' });
        root.innerHTML = '<style>:host{background:#0008}.panel{position:absolute;right:80px;top:10px;width:600px;height:600px;background:#222;color:white}button{position:absolute;right:12px;top:12px;width:36px;height:36px}</style><section class="panel"><button aria-label="关闭图片">×</button><bili-comment-preview-renderer>评论图片详情</bili-comment-preview-renderer></section>';
        root.querySelector('button').onclick = () => popup.remove();
        document.body.append(popup);
      });
      try {
        const close = page.getByRole('button', { name: '关闭图片' });
        await page.screenshot({ path: join(out, `96-${theme}.png`) });
        await close.click({ timeout: 1500 });
        assert.equal(await page.locator('bili-popup').count(), 0);
      } finally { await page.locator('bili-popup').evaluateAll(nodes => nodes.forEach(node => node.remove())); }
    });
  }
  for (const [name, url] of [['feed', 'https://t.bilibili.com/'], ['space', 'https://space.bilibili.com/2/dynamic']]) await check(`93-attached-video-${name}`, async () => {
    await page.goto(url);
    const card = page.locator('.dy').filter({ hasText: '律师也要黑屏处理啦' }).first();
    await card.waitFor();
    const link = card.locator('.dy-article');
    await link.waitFor({ timeout: 1500 });
    assert.equal(await link.getAttribute('href'), 'https://www.bilibili.com/video/BV1mdxN68E7F/');
    assert((await link.innerText()).includes('2193.6万播放'));
    assert.equal(await card.getAttribute('data-href'), 'https://www.bilibili.com/opus/900001');
    await page.screenshot({ path: join(out, `93-${name}.png`) });
  });
  await check('93-opus-video-statistics', async () => {
    await page.route('https://www.bilibili.com/opus/900001', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html><head><meta charset="utf-8"><style>
      .opus-module-content{width:500px}.bili-dyn-card-ugc__detail__stat{display:flex;font-size:12px;line-height:16px;margin-top:4px}
      .bili-dyn-card-video__stat__item{align-items:center;display:flex;margin-right:8px;width:80px}
      .bili-dyn-card-video__stat__item svg{height:16px;margin-right:4px;width:16px}
      </style></head><body><div id="app"><article class="opus-detail"><div class="opus-module-content"><p>正文</p><div class="bili-dyn-card-ugc"><div class="bili-dyn-card-ugc__detail__stat">
      <div class="bili-dyn-card-video__stat__item"><svg></svg><span>2193.6万</span></div><div class="bili-dyn-card-video__stat__item danmaku"><svg></svg><span>39.6万</span></div>
      </div></div></div></article></div></body></html>` }));
    await page.goto('https://www.bilibili.com/opus/900001');
    await page.locator('html.margin-detail').waitFor({ state: 'attached' });
    await page.locator('#margin-watch-top .top').waitFor();
    assert.equal(await page.locator('.bili-dyn-card-video__stat__item span').first().textContent(), '2193.6万');
    const statistics = await page.locator('.bili-dyn-card-video__stat__item span').evaluateAll(nodes => nodes.map(node => {
      const range = document.createRange(); range.selectNodeContents(node);
      return { lines: range.getClientRects().length, height: node.getBoundingClientRect().height, font: getComputedStyle(node).fontSize };
    }));
    assert(statistics.every(stat => stat.lines === 1 && stat.height <= 20), JSON.stringify(statistics));
    await page.screenshot({ path: join(out, '93-statistics.png') });
    return statistics;
  });
} finally {
  writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2));
  await context.close();
}
if (results.some(result => !result.ok)) process.exitCode = 1;
