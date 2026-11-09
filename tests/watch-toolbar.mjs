import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installMocks } from './mocks.mjs';

const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/watch-toolbar');
mkdirSync(out, { recursive: true });
const extension = resolve(process.env.SMOKE_EXT || 'dist');
const results = [];
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-toolbar-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  viewport: { width: 1440, height: 900 }, locale: 'zh-CN',
});
try {
  await installMocks(context);
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': { intro: false, theme: 'dark', wide: false, bg: { mode: 'off' } } }));
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = '.video-toolbar-container{display:flex;align-items:center;justify-content:space-between}.video-toolbar-left,.video-toolbar-left-main,.video-toolbar-right{display:flex;align-items:center}.toolbar-left-item-wrap{position:relative}.video-toolbar-item-icon{width:36px;height:36px;margin-right:8px;flex-shrink:0}.toolbar-right-related-content{width:160px;flex:none}.video-toolbar-right{gap:12px}';
    document.head.append(style);
    const toolbar = document.createElement('div'); toolbar.className = 'video-toolbar-container';
    document.querySelector('.bpx-player-container').after(toolbar);
    toolbar.innerHTML = '<div class="video-toolbar-left"><div class="video-toolbar-left-main">' +
      ['点赞 12.8万', '投币 1.3万', '收藏 4.6万', '分享 2.3万'].map(text => '<div class="toolbar-left-item-wrap"><button class="video-toolbar-left-item"><svg class="video-toolbar-item-icon"></svg><span>' + text + '</span></button></div>').join('') +
      '</div></div><div class="video-toolbar-right"><button class="toolbar-right-related-content">4 个地点</button><button id="native-more">更多</button></div>';
    document.querySelector('#native-more').onclick = () => { window.moreClicked = true; };
  }));
  await page.goto('https://www.bilibili.com/video/BV1mdxN68E7F/');
  await page.locator('#margin-watch-top .top').waitFor();
  for (const mode of ['normal', 'wide']) for (const width of [440, 600, 820]) {
    const name = `${mode}-${width}`;
    try {
      await page.evaluate(({ mode, width }) => {
        const left = document.querySelector('.left-container');
        left.style.setProperty('width', `${width}px`, 'important');
        left.style.setProperty('max-width', `${width}px`, 'important');
        document.querySelector('.bpx-player-container').dataset.screen = mode;
      }, { mode, width });
      await page.locator('.video-toolbar-container').scrollIntoViewIfNeeded();
      await page.waitForTimeout(150);
      const geometry = await page.locator('.video-toolbar-container').evaluate(toolbar => {
        const card = toolbar.parentElement.getBoundingClientRect();
        return [...toolbar.querySelectorAll('button')].map(button => {
          const rect = button.getBoundingClientRect();
          return { text: button.textContent, left: rect.left - card.left, right: card.right - rect.right };
        });
      });
      assert(geometry.every(button => button.left >= 0 && button.right >= 0), JSON.stringify(geometry));
      await page.evaluate(() => window.moreClicked = false);
      await page.locator('#native-more').click({ timeout: 1500 });
      assert(await page.evaluate(() => window.moreClicked));
      results.push({ name, ok: true, geometry }); console.log(`PASS ${name}`);
      await page.screenshot({ path: join(out, `${name}.png`) });
    } catch (error) { results.push({ name, ok: false, error: error.message }); console.log(`FAIL ${name}: ${error.message}`); }
  }
  try {
    await page.evaluate(() => {
      scrollTo(0, 0);
      document.querySelector('.video-container-v1').style.display = 'flex';
      document.querySelector('.left-container').style.minHeight = '4000px';
      const right = document.querySelector('.right-container');
      right.style.height = '4000px';
      right.innerHTML = '<div class="right-container-inner scroll-sticky" style="position:sticky;top:0;height:500px"><div class="up-panel-container" style="height:180px">UP 主</div><div class="next-play" style="height:300px">接下来播放</div></div>';
    });
    await page.waitForTimeout(300);
    const position = () => page.locator('.next-play').evaluate(element => element.getBoundingClientRect().top + scrollY);
    const before = await position();
    await page.evaluate(() => scrollTo(0, 1300));
    await page.waitForTimeout(150);
    const after = await position();
    assert(Math.abs(after - before) <= 1, `recommendations jumped from ${before} to ${after}`);
    await page.evaluate(() => { document.querySelector('.bpx-player-container').dataset.screen = 'normal'; });
    await page.waitForTimeout(150);
    assert.equal(await page.locator('.right-container-inner').evaluate(node => getComputedStyle(node).position), 'sticky');
    results.push({ name: 'wide-recommendations-scroll', ok: true, before, after });
    console.log('PASS wide-recommendations-scroll');
  } catch (error) { results.push({ name: 'wide-recommendations-scroll', ok: false, error: error.message }); console.log(`FAIL wide-recommendations-scroll: ${error.message}`); }
} finally { writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2)); await context.close(); }
if (results.some(result => !result.ok)) process.exitCode = 1;
