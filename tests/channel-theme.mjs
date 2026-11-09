import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installMocks } from './mocks.mjs';

const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/channel-theme');
mkdirSync(out, { recursive: true });
const extension = resolve(process.env.SMOKE_EXT || 'dist'), results = [], errors = [];
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-channel-theme-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  viewport: { width: 1440, height: 900 }, locale: 'zh-CN',
});
try {
  await installMocks(context);
  await context.route('https://www.bilibili.com/c/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0}.feedchannel{background:var(--bg1)}.feedchannel-main{max-width:1200px;width:90%;margin:auto}
    .channel-name{font:600 28px system-ui}.channel-page__head{padding:20px 0}.channel-page__body{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:24px}
    .bili-cover-card__thumbnail{height:160px;border-radius:6px;overflow:hidden;background:#9297a0}.bili-cover-card__thumbnail img{width:100%;height:100%;object-fit:cover}
    .bili-video-card__title a{color:var(--text1);font:500 15px/22px system-ui}.bili-video-card__subtitle{font:12px system-ui;color:var(--text3)}
    .banner-carousel__footer{background:#905050;color:#fff}.bili-cover-card__stats{color:white}
  </style></head><body><div id="app"><div class="feedchannel"><main class="feedchannel-main"><div class="channel-page">
    <div class="channel-page__head"><div class="channel-name">鬼畜</div></div><div class="channel-page__body">${Array.from({ length: 8 }, (_, i) => `<div class="feed-card"><div class="bili-video-card video-card"><div class="bili-video-card__wrap">
      <div class="bili-video-card__cover"><a class="bili-cover-card" href="https://www.bilibili.com/video/BV14W4B6sET9/"><div class="bili-cover-card__thumbnail"><img src="https://i0.hdslb.com/bfs/test${i}.jpg"></div><div class="bili-cover-card__stats">01:30</div></a></div>
      <div class="bili-video-card__details"><div class="bili-video-card__title"><a href="https://www.bilibili.com/video/BV14W4B6sET9/">分区视频 ${i + 1}</a></div><div class="bili-video-card__subtitle"><a class="bili-video-card__author" href="https://space.bilibili.com/1">UP 主</a></div></div>
    </div></div></div>`).join('')}</div><div class="banner-carousel__footer"><div class="mask" style="background-color:rgb(154,140,137)"></div><a href="#carousel">原生轮播标题</a></div></div></main></div></div></body></html>` }));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  for (const theme of ['light', 'dark']) {
    await worker.evaluate(theme => chrome.storage.local.set({ 'margin:settings': { intro: false, theme, bg: { mode: 'off' } } }), theme);
    await page.goto('https://www.bilibili.com/c/kichiku/');
    await page.locator('#margin-watch-top .top').waitFor();
    const style = await page.evaluate(() => {
      const css = selector => getComputedStyle(document.querySelector(selector));
      return { radius: css('.bili-cover-card__thumbnail').borderRadius, title: css('.bili-video-card__title a').color,
        font: css('.channel-name').fontFamily, background: css('.feedchannel').backgroundColor,
        footer: css('.banner-carousel__footer').backgroundColor, mask: css('.banner-carousel__footer .mask').backgroundColor, coverStats: css('.bili-cover-card__stats').color,
        href: document.querySelector('.bili-video-card__title a').href };
    });
    results.push({ theme, style });
    assert.equal(style.radius, '12px'); assert.match(style.font, /Instrument Serif/);
    assert.equal(style.title, theme === 'dark' ? 'rgb(237, 237, 238)' : 'rgb(23, 24, 26)');
    assert.equal(style.background, 'rgba(0, 0, 0, 0)');
    assert.equal(style.footer, theme === 'dark' ? 'rgb(26, 26, 28)' : 'rgb(255, 255, 255)');
    assert.equal(style.mask, style.footer);
    assert.equal(style.coverStats, 'rgb(255, 255, 255)'); assert(style.href.endsWith('/BV14W4B6sET9/'));
    for (const width of [1920, 1100]) {
      await page.setViewportSize({ width, height: 900 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await page.screenshot({ path: join(out, `${theme}.png`) });
    console.log(`PASS channel ${theme}`);
  }
  await page.locator('.bili-video-card__title a').first().click();
  await page.waitForURL('**/video/BV14W4B6sET9/');
  await page.locator('html.margin-watch').waitFor();
  assert.deepEqual(errors, []);
} finally { writeFileSync(join(out, 'results.json'), JSON.stringify({ results, errors }, null, 2)); await context.close(); }
