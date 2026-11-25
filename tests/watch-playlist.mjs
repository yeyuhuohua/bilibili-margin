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
// Two extreme cuts in the mock player and its wallpaper. Read the composited
// pixels, not the panel's CSS: a child may be transparent over a solid parent.
async function frameDeltas(page, probes) {
  const points = {};
  const { width, height } = page.viewportSize();
  for (const [name, [selector, x, y]] of Object.entries(probes)) {
    const box = await page.locator(selector).first().boundingBox();
    assert(box?.width && box.height, `${name}: missing visible ${selector}`);
    const px = Math.floor(box.x + x * box.width), py = Math.floor(box.y + y * box.height);
    assert(px >= 0 && px < width && py >= 0 && py < height, `${name}: sample outside the screenshot`);
    points[name] = [px, py];
  }
  const frames = [];
  for (const color of ['black', 'white']) {
    await page.evaluate(color => {
      for (const node of [document.body, document.querySelector('.bpx-player-container')])
        node.style.setProperty('background', color, 'important');
    }, color);
    const image = await page.screenshot();
    frames.push(await page.evaluate(async ({ image, points }) => {
      const img = new Image(); img.src = `data:image/png;base64,${image}`; await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
      return Object.fromEntries(Object.entries(points).map(([k, xy]) => [k, [...ctx.getImageData(...xy, 1, 1).data].slice(0, 3)]));
    }, { image: image.toString('base64'), points }));
  }
  return Object.fromEntries(Object.keys(points).map(k => [k, Math.max(...frames[0][k].map((v, i) => Math.abs(v - frames[1][k][i])))]));
}
// The list route uses playlist-container--left/right, confirmed in Bilibili's
// native playlist bundle. Player, toolbar, tags and UP panel are shared components.
const fixture = list => {
  const row = list ? 'playlist-container' : 'video-container-v1';
  const left = list ? 'playlist-container--left' : 'left-container';
  const right = list ? 'playlist-container--right' : 'right-container';
  const rec = title => `<div class="video-page-card-small"><div class="card-box"><div class="pic-box"></div><div class="info"><a href="#recommendation" class="title">${title}</a><div class="upname">UP 主</div></div></div></div>`;
  const sidebar = `<div class="up-panel-container">UP 主卡片</div><div id="danmukuBox"><div class="danmaku-wrap"><div class="bui-collapse-wrap"><div class="bui-collapse-header">弹幕列表</div></div></div></div>` + (list
    ? '<div class="action-list-container">播放列表</div>'
    : `<div class="rcmd-tab"><div class="recommend-list-v1"><div class="next-play"><div class="rec-title">接下来播放</div>${rec('摄影入门')}</div><div class="rec-list">${rec('光影与构图')}</div></div></div>`);
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
    .video-page-card-small .pic-box{width:120px;height:70px}.video-page-card-small .info{flex:1;min-width:0;padding-left:12px}
    #commentapp{height:1600px}
  </style></head><body><div id="app"><div class="${row}"><div class="${left}">
    <div class="video-info-container"><h1 class="video-title">列表播放布局回归</h1></div>
    <div id="playerWrap" class="player-wrap"><div class="bpx-player-container" data-screen="normal"><video muted></video>
      <button class="bpx-player-ctrl-wide">宽屏</button></div></div>
    <div class="video-toolbar-container">点赞　投币　收藏　分享</div>
    <div class="video-desc-container">原生简介</div>
    <div class="video-tag-container"><div class="tag-panel">${Array.from({ length: 18 }, (_, i) => `<div class="tag"><a class="tag-link" href="#tag-${i}">视频标签 ${i + 1}</a></div>`).join('')}</div></div>
    <div id="commentapp"></div></div><div class="${right}">${list ? sidebar : `<div class="right-container-inner">${sidebar}</div>`}</div></div></div><script>
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
  await installMocks(context, url => url.startsWith('https://s.search.bilibili.com/main/suggest?')
    ? { code: 0, result: { tag: [{ value: '摄影入门', name: '<em>摄影</em>入门' }] } } : null);
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
    const geometry = () => page.evaluate(listSelector => {
      const rect = selector => {
        const node = document.querySelector(selector), r = node?.getBoundingClientRect();
        return r ? { top: r.top + scrollY, bottom: r.bottom + scrollY, left: r.left, right: r.right } : null;
      };
      return { player: rect('#playerWrap'), author: rect('.up-panel-container'), toolbar: rect('.video-toolbar-container'), tags: rect('.video-tag-container'), card: rect('.m-wcard'),
        list: rect(listSelector), wide: document.documentElement.classList.contains('margin-wide'),
        identities: window.nativeNodes.every(node => node.isConnected), inset: getComputedStyle(document.querySelector('.video-tag-container')).paddingLeft };
    }, name === 'video' ? '.recommend-list-v1' : '.action-list-container');
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
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  for (const theme of ['light', 'dark']) for (const glass of ['soft', 'liquid', 'flat']) {
    // Omit the setting for soft so this covers the actual default.
    await worker.evaluate(prefs => chrome.storage.local.set({ 'margin:settings': prefs }), {
      intro: false, wide: false, autoWeb: false, bg: { mode: 'off' }, theme, ...(glass === 'soft' ? {} : { glass }),
    });
    await page.goto('https://www.bilibili.com/video/BV14W4B6sET9/');
    await page.locator(`#margin-watch-top .app[data-theme="${theme}"][data-glass="${glass}"]`).waitFor();
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog', { name: '搜索与命令' });
    const input = dialog.getByRole('combobox'), list = dialog.getByRole('listbox', { name: '搜索' });
    await input.fill('摄影');
    await list.getByRole('option').nth(1).waitFor();
    await input.press('ArrowDown');
    assert.equal(await list.getByRole('option').nth(1).getAttribute('aria-selected'), 'true');
    await dialog.evaluate(async el => { await Promise.all(el.getAnimations({ subtree: true }).map(a => a.finished)); });
    const palette = await frameDeltas(page, {
      search: ['.cp-list', .75, .70], selected: ['.cp-list [aria-selected="true"]', .75, .5],
      commands: ['.cp-side', .14, .75], outside: ['#playerWrap', .08, .60],
    });
    const name = `palette-${theme}-${glass}`, ok = Math.max(palette.search, palette.selected, palette.commands) <= 8 && palette.outside >= 64;
    results.push({ name, ok, palette }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(palette)}`);
    await input.press('Tab');
    assert(await dialog.getByRole('listbox', { name: '命令' }).getByRole('option', { selected: true }).isVisible());
    await input.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    const sidebar = await frameDeltas(page, {
      next: ['.next-play .info', .85, .55], recommended: ['.rec-list .info', .85, .55],
      author: ['.up-panel-container', .6, .5], danmaku: ['#danmukuBox .bui-collapse-header', .65, .6],
      gap: ['#danmukuBox', .65, 1.16], player: ['#playerWrap', .08, .60],
    });
    const stable = Math.max(sidebar.next, sidebar.recommended, sidebar.author, sidebar.danmaku) <= 8
      && Math.min(sidebar.gap, sidebar.player) >= 200;
    results.push({ name: `sidebar-${theme}-${glass}`, ok: stable, sidebar });
    console.log(`${stable ? 'PASS' : 'FAIL'} sidebar-${theme}-${glass} ${JSON.stringify(sidebar)}`);
  }
} finally { await context.close(); }
writeFileSync(join(out, 'results.json'), JSON.stringify({ extension, results, errors }, null, 2));
assert(results.every(result => result.ok) && errors.length === 0, 'watch/list regression failed');
