import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installMocks } from './mocks.mjs';

const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/channel-carousel');
mkdirSync(out, { recursive: true });
const extension = resolve(process.env.SMOKE_EXT || 'dist'), results = [], errors = [];
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-channel-carousel-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  viewport: { width: 1440, height: 900 }, locale: 'zh-CN',
});
try {
  await installMocks(context);
  await context.route('https://www.bilibili.com/c/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0}.channel-page{padding:110px 60px 0}.head-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:20px}.channel-carousel{grid-column:span 2;height:240px}.card{height:240px;background:#999;border-radius:12px}
  </style></head><body><div id="app"><main class="channel-page"><div class="head-cards"><div class="banner-carousel channel-carousel"><div class="vui_carousel"><div class="vui_carousel__slides">
    ${[4, 0, 1, 2, 3, 4, 0].map(i => `<div class="vui_carousel__slide"><div class="banner-carousel__item" data-index="${i}"><a class="cover-wrap" href="https://www.bilibili.com/video/BV1mcc${i}/" target="_blank"><img src="https://i0.hdslb.com/cover-${i}.jpg" alt="推荐视频 ${i}"></a></div></div>`).join('')}
    </div></div></div><div class="card">分区内容</div><div class="card">分区内容</div></div></main></div></body></html>` }));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const settings = patch => worker.evaluate(async patch => {
    const current = (await chrome.storage.local.get('margin:settings'))['margin:settings'] ?? {};
    await chrome.storage.local.set({ 'margin:settings': { ...current, ...patch } });
  }, patch);
  const page = await context.newPage(); page.setDefaultTimeout(8000); page.on('pageerror', error => errors.push(error.message));
  const passed = name => { results.push(name); console.log(`PASS ${name}`); };
  for (const theme of ['light', 'dark']) {
    await settings({ intro: false, theme, reduceMotion: false, bg: { mode: 'off' } });
    await page.goto('https://www.bilibili.com/c/kichiku/');
    const carousel = page.locator('.m-channel-carousel'); await carousel.waitFor();
    assert.equal(await carousel.locator('.mcc-panel').count(), 5);
    assert.equal(await page.locator('.channel-carousel').isVisible(), false);
    assert.equal(await carousel.getByRole('link', { name: '打开推荐视频 0' }).getAttribute('href'), 'https://www.bilibili.com/video/BV1mcc0/');
    assert.match(await carousel.locator('.mcc-panel').first().evaluate(el => getComputedStyle(el, '::after').backgroundImage), /linear-gradient/);
    await carousel.getByRole('button', { name: '展开推荐视频 2' }).click();
    assert.equal(await carousel.locator('.mcc-caption').textContent(), '推荐视频 2');
    for (let i = 0; i < 12; i++) await carousel.getByRole('button', { name: '下一张', exact: true }).click();
    assert.equal(await carousel.locator('.mcc-caption').textContent(), '推荐视频 4');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await carousel.locator('.mcc-caption').textContent(), '推荐视频 3');
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(out, `${theme}.png`) });
    passed(`${theme} native data, transparent gradient, slats and rapid keyboard switching`);
    await settings({ reduceMotion: true });
    await page.waitForFunction(() => document.documentElement.classList.contains('margin-reduce'));
    assert(await carousel.locator('.mcc-panel').first().evaluate(el => parseFloat(getComputedStyle(el).transitionDuration) <= .001));
    for (const width of [1100, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(100);
      const box = await carousel.boundingBox(); assert(box.width > 350); assert(box.height >= 180);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    passed(`${theme} live reduced-motion setting and resized layout`);
    await page.evaluate(() => {
      const original = document.querySelector('.channel-carousel');
      original.querySelectorAll('.banner-carousel__item').forEach(item => { if (item.dataset.index !== '1') item.remove(); });
      const img = original.querySelector('img'); img.alt = '新的分区推荐';
    });
    await carousel.getByRole('link', { name: '打开新的分区推荐' }).waitFor();
    assert.equal(await carousel.locator('.mcc-panel').count(), 1);
    assert.equal(await carousel.getByRole('button', { name: '下一张', exact: true }).isVisible(), false);
    assert.equal(await carousel.locator('.mcc-dots').isVisible(), false);
    const popupEvent = page.waitForEvent('popup');
    await carousel.getByRole('link', { name: '打开新的分区推荐' }).click();
    const popup = await popupEvent; await popup.waitForLoadState();
    assert.equal(popup.url(), 'https://www.bilibili.com/video/BV1mcc1/'); await popup.close();
    const handle = await page.locator('.channel-carousel').elementHandle();
    await page.evaluate(() => document.querySelector('.channel-carousel').remove());
    await carousel.waitFor({ state: 'detached' });
    await page.locator('.head-cards').evaluate((el, original) => el.prepend(original), handle);
    await carousel.getByRole('link', { name: '打开新的分区推荐' }).waitFor();
    assert.equal(await page.locator('.m-channel-carousel').count(), 1);
    passed(`${theme} native data replacement, single-slide navigation and remount`);
  }
  await page.goto('https://www.bilibili.com/c/kichiku/?margin=off');
  assert.equal(await page.locator('.m-channel-carousel').count(), 0);
  assert.equal(await page.locator('.channel-carousel').isVisible(), true);
  assert.deepEqual(errors, []);
} finally { writeFileSync(join(out, 'results.json'), JSON.stringify({ results, errors }, null, 2)); await context.close(); }
