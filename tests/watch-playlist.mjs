import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { installMocks } from './mocks.mjs';

const extension = resolve(process.env.SMOKE_EXT || 'dist');
const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/watch-playlist');
mkdirSync(out, { recursive: true });
const results = [], errors = [];
// The list route uses playlist-container--left/right, confirmed in Bilibili's
// native playlist bundle. Player, toolbar, tags and UP panel are shared components.
const fixture = list => {
  const row = list ? 'playlist-container' : 'video-container-v1';
  const left = list ? 'playlist-container--left' : 'left-container';
  const right = list ? 'playlist-container--right' : 'right-container';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0}.${row}{display:flex;align-items:flex-start;width:90vw;margin:auto;gap:30px;min-height:2600px}
    .${left}{position:relative;width:calc(100% - 380px);flex:none}.${right}{width:350px;flex:none}
    #playerWrap,.bpx-player-container{height:500px}.bpx-player-container{background:#000}
    .bpx-player-container[data-screen=wide]{width:90vw}
    .bpx-player-container[data-screen=mini]{position:fixed;right:16px;bottom:16px;width:320px;height:180px}
    .up-panel-container{box-sizing:border-box;min-height:150px}
    .video-toolbar-container{height:56px;box-sizing:border-box}.video-desc-container{height:64px;box-sizing:border-box}
    .video-tag-container .tag-panel{height:38px;overflow:hidden}.tag{float:left;margin:0 12px 8px 0}
    .tag-link{display:inline-flex;height:28px;line-height:28px;background:#666;padding:0 12px;border-radius:14px}
    #danmukuBox{height:44px}.native-wide #danmukuBox{margin-top:520px}.action-list-container{height:320px}
    #commentapp{height:1600px}
  </style></head><body><div id="app"><div class="${row}"><div class="${left}">
    <div class="video-info-container"><h1 class="video-title">列表播放布局回归</h1></div>
    <div id="playerWrap" class="player-wrap"><div class="bpx-player-container" data-screen="normal"><video muted></video>
      <button class="bpx-player-ctrl-wide">宽屏</button></div></div>
    <div class="video-toolbar-container">点赞　投币　收藏　分享</div>
    <div class="video-desc-container">原生简介</div>
    <div class="video-tag-container"><div class="tag-panel">${Array.from({ length: 18 }, (_, i) => `<div class="tag"><a class="tag-link" href="#tag-${i}">视频标签 ${i + 1}</a></div>`).join('')}</div></div>
    <div id="commentapp"></div></div><div class="${right}"><div class="up-panel-container">UP 主卡片</div>
    <div id="danmukuBox">弹幕列表</div><div class="action-list-container">播放列表</div></div></div></div><script>
    window.nativeNodes = [document.querySelector('video'), document.querySelector('.bpx-player-container'), document.querySelector('.video-tag-container')];
    document.querySelector('.bpx-player-ctrl-wide').onclick = () => {
      document.querySelector('.bpx-player-container').dataset.screen = 'wide';
      document.querySelector('.${row}').classList.add('native-wide');
    };
  </script></body></html>`;
};
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-playlist-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  viewport: { width: 1440, height: 900 }, locale: 'zh-CN',
});
try {
  await installMocks(context);
  await context.route('https://www.bilibili.com/**', route => {
    if (route.request().resourceType() !== 'document') return route.fallback();
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture(new URL(route.request().url()).pathname.startsWith('/list/')) });
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': { intro: false, theme: 'dark', wide: false, autoWeb: false, bg: { mode: 'off' } } }));
  for (const [name, path] of [['video', '/video/BV14W4B6sET9/'], ['watchlater', '/list/watchlater?bvid=BV14W4B6sET9'], ['favorite-list', '/list/ml123?bvid=BV14W4B6sET9']]) {
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const result = { name, ok: false, geometry: [] }; results.push(result);
    const geometry = () => page.evaluate(() => {
      const rect = selector => {
        const node = document.querySelector(selector), r = node?.getBoundingClientRect();
        return r ? { top: r.top + scrollY, bottom: r.bottom + scrollY, left: r.left, right: r.right } : null;
      };
      return { player: rect('#playerWrap'), author: rect('.up-panel-container'), toolbar: rect('.video-toolbar-container'), tags: rect('.video-tag-container'), card: rect('.m-wcard'),
        list: rect('.action-list-container'), wide: document.documentElement.classList.contains('margin-wide'),
        identities: window.nativeNodes.every(node => node.isConnected), inset: getComputedStyle(document.querySelector('.video-tag-container')).paddingLeft };
    });
    try {
      await page.goto(`https://www.bilibili.com${path}`);
      await page.locator('#margin-watch-top .top').waitFor();
      await page.waitForTimeout(350);
      const normal = await geometry(); result.geometry.push({ mode: 'normal', ...normal });
      assert(Math.abs(normal.author.top - normal.player.top) < 2, `normal author alignment ${JSON.stringify(normal)}`);
      assert(normal.card && Math.abs(normal.card.top - normal.player.top) < 2, 'normal card missing');
      assert(Math.abs(normal.toolbar.top - normal.player.bottom) < 2, 'normal surface separated');
      await page.locator('.bpx-player-ctrl-wide').click();
      await page.locator('html.margin-wide').waitFor(); await page.waitForTimeout(250);
      const wide = await geometry(); result.geometry.push({ mode: 'wide', ...wide });
      assert(Math.abs(wide.toolbar.top - wide.player.bottom - 16) < 2, `wide player/card gap ${JSON.stringify(wide)}`);
      assert(Math.abs(wide.author.top - wide.toolbar.top) < 2, `wide card tops ${JSON.stringify(wide)}`);
      assert(Math.abs(wide.card.top - wide.toolbar.top) < 2);
      assert(Math.abs(wide.card.bottom - wide.tags.bottom) < 2);
      assert.equal(wide.inset, '20px');
      await page.locator('.tag-panel').evaluate(node => node.style.height = 'auto');
      await page.waitForTimeout(150);
      const expanded = await geometry();
      assert(expanded.tags.bottom > wide.tags.bottom + 20);
      assert(Math.abs(expanded.card.bottom - expanded.tags.bottom) < 2, 'expanded tags escaped card');
      await page.screenshot({ path: join(out, `${name}-wide.png`) });
      await page.evaluate(() => { scrollTo(0, 550); document.querySelector('.bpx-player-container').dataset.screen = 'mini'; });
      await page.waitForTimeout(200);
      const mini = await geometry(); result.geometry.push({ mode: 'mini', ...mini });
      for (const key of ['author', 'card', 'list']) assert(Math.abs(mini[key].top - expanded[key].top) < 2, `mini moved ${key}`);
      await page.evaluate(() => { scrollTo(0, 0); document.querySelector('.bpx-player-container').dataset.screen = 'wide'; document.body.style.zoom = '.8'; });
      await page.waitForTimeout(200);
      const zoomed = await geometry(); result.geometry.push({ mode: 'zoomed', ...zoomed });
      assert(Math.abs(zoomed.author.top - zoomed.toolbar.top) < 2, 'zoomed alignment');
      assert(Math.abs(zoomed.toolbar.top - zoomed.player.bottom - 12.8) < 2, 'zoomed wide gap');
      await page.evaluate(() => { document.body.style.zoom = ''; document.querySelector('.bpx-player-container').dataset.screen = 'normal'; });
      await page.waitForTimeout(200);
      const restored = await geometry();
      assert(restored.identities && !restored.wide);
      assert(Math.abs(restored.author.top - restored.player.top) < 2);
      assert(Math.abs(restored.toolbar.top - restored.player.bottom) < 2, 'wide gap leaked into normal mode');
      await page.locator('.bpx-player-ctrl-wide').click();
      await page.waitForTimeout(200);
      const repeated = await geometry();
      assert(Math.abs(repeated.toolbar.top - repeated.player.bottom - 16) < 2, 'wide gap accumulated');
      assert(Math.abs(repeated.author.top - repeated.toolbar.top) < 2, 'repeated wide alignment');
      result.ok = true; console.log(`PASS ${name}`);
    } catch (error) { result.error = error.message; console.log(`FAIL ${name}: ${error.message}`); }
    finally { await page.screenshot({ path: join(out, `${name}-final.png`) }); await page.close(); }
  }
} finally { await context.close(); }
writeFileSync(join(out, 'results.json'), JSON.stringify({ results, errors }, null, 2));
assert(results.every(result => result.ok) && errors.length === 0, 'watch/list regression failed');
