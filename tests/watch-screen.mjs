import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { installMocks } from './mocks.mjs';

const extension = resolve(process.env.SMOKE_EXT || 'dist');
const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/watch-screen');
mkdirSync(out, { recursive: true });
const results = [], errors = [];
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-screen-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true,
  args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  viewport: { width: 1440, height: 900 }, locale: 'zh-CN',
});
try {
  await installMocks(context);
  await context.route('https://live.bilibili.com/12345', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html>
    <html><head><meta charset="utf-8"></head><body>
    <div class="live-room-app"><div class="app-content"><div class="app-body">
      <div id="player-ctnr"><div id="fullscreen-container" style="height:600px;background:#222"><video muted></video></div></div>
      <div id="aside-area-vm">弹幕列表</div>
    </div></div></div>
    <button id="native-full" style="position:fixed;right:16px;bottom:16px;z-index:2147483647">进入全屏</button>
    <script>document.getElementById('native-full').onclick=()=>document.getElementById('fullscreen-container').requestFullscreen();</script>
    </body></html>` }));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const seed = patch => worker.evaluate(patch => chrome.storage.local.set({ 'margin:settings': {
    intro: false, theme: 'dark', bg: { mode: 'off' }, wide: false, autoWeb: false, webScroll: false, ...patch,
  } }), patch);
  const check = async (name, run) => {
    if (process.env.ISSUES_ONLY && !name.startsWith(process.env.ISSUES_ONLY)) return;
    await seed({});
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && message.text().includes('[MARGIN]')) console.log(message.text()); });
    try {
      const evidence = await run(page);
      results.push({ name, ok: true, evidence });
      console.log(`PASS ${name}`);
    } catch (error) {
      results.push({ name, ok: false, error: error.message });
      console.log(`FAIL ${name}: ${error.message}`);
    } finally {
      await page.screenshot({ path: join(out, `${name}.png`) });
      await page.close();
    }
  };
  for (const mode of ['web', 'legacy', 'native']) await check(`76-live-${mode}`, async page => {
    await page.goto('https://live.bilibili.com/12345');
    const top = page.locator('#margin-watch-top');
    await top.locator('.top').waitFor();
    assert(await top.isVisible());
    for (let i = 0; i < 2; i++) {
      if (mode !== 'native') await page.evaluate(mode => {
        document.body.classList.add(mode === 'web' ? 'player-full-win' : 'fullscreen-fix', 'over-hidden');
      }, mode);
      else {
        await page.locator('#native-full').click();
        await page.waitForFunction(() => !!document.fullscreenElement);
      }
      await top.waitFor({ state: 'hidden', timeout: 2000 });
      if (mode !== 'native') await page.evaluate(() => document.body.classList.remove('player-full-win', 'fullscreen-fix', 'over-hidden'));
      else await page.evaluate(() => document.exitFullscreen());
      await top.waitFor({ state: 'visible', timeout: 2000 });
    }
    return { cycles: 2, restored: await top.isVisible() };
  });
  await check('76-live-web-native-roundtrip', async page => {
    await page.goto('https://live.bilibili.com/12345');
    const top = page.locator('#margin-watch-top');
    await top.locator('.top').waitFor();
    await page.evaluate(() => document.body.classList.add('player-full-win', 'over-hidden'));
    await top.waitFor({ state: 'hidden', timeout: 2000 });
    assert.equal(await page.evaluate(() => document.fullscreenElement), null);
    await page.locator('#native-full').click();
    await page.waitForFunction(() => !!document.fullscreenElement);
    await page.evaluate(() => document.exitFullscreen());
    await page.waitForFunction(() => !document.fullscreenElement);
    await page.waitForTimeout(150);
    assert(await top.isHidden(), 'returning to web fullscreen must keep the header hidden');
    await page.evaluate(() => document.body.classList.remove('player-full-win'));
    await top.waitFor({ state: 'visible', timeout: 2000 });
    assert(await page.evaluate(() => document.body.classList.contains('over-hidden')));
  });
  await check('76-live-delayed-body', async page => {
    await page.route('https://live.bilibili.com/slow-live.js', async route => {
      await new Promise(resolve => setTimeout(resolve, 1500));
      await route.fulfill({ contentType: 'application/javascript', body: '' });
    });
    await page.route('https://live.bilibili.com/12346', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html>
      <html><head><meta charset="utf-8"><script src="/slow-live.js"></script></head>
      <body class="player-full-win over-hidden"><div id="player-ctnr"><video muted></video></div></body></html>` }));
    await page.goto('https://live.bilibili.com/12346');
    const top = page.locator('#margin-watch-top');
    await top.locator('.top').waitFor({ state: 'attached', timeout: 2000 });
    await page.waitForFunction(() => document.querySelector('#margin-watch-top')?.hasAttribute('hidden'), undefined, { timeout: 2000 });
    assert(await page.locator('html.margin-live').count(), 'live initialization fell back after a startup error');
    await page.evaluate(() => document.body.classList.remove('player-full-win', 'over-hidden'));
    await top.waitFor({ state: 'visible' });
  });
  await check('76-web-scroll-native-fullscreen', async page => {
    await seed({ webScroll: true });
    await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
      const player = document.querySelector('.bpx-player-container');
      const wrap = document.createElement('div'); wrap.className = 'player-wrap';
      player.before(wrap); wrap.append(player);
      const button = document.createElement('button'); button.id = 'native-full'; button.textContent = '全屏';
      player.append(button); button.onclick = () => player.requestFullscreen();
      player.dataset.screen = 'web';
    }));
    await page.goto('https://www.bilibili.com/video/BV1mdxN68E7F/');
    await page.locator('html.margin-webscroll').waitFor({ state: 'attached' });
    await page.locator('#native-full').click();
    await page.waitForFunction(() => !!document.fullscreenElement && !document.documentElement.classList.contains('margin-webscroll'));
    await page.evaluate(() => document.exitFullscreen());
    await page.locator('html.margin-webscroll').waitFor({ state: 'attached', timeout: 2000 });
    assert(await page.locator('#margin-watch-top').isHidden());
    await page.locator('.bpx-player-container').evaluate(player => { player.dataset.screen = 'normal'; });
    await page.locator('#margin-watch-top').waitFor({ state: 'visible' });
    assert.equal(await page.locator('html.margin-webscroll').count(), 0);
  });
  await check('97-auto-wide-initial-check', async page => {
    await seed({ wide: true });
    await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
      const started = performance.now();
      document.querySelector('.bpx-player-ctrl-wide').addEventListener('click', () => { window.firstWideDelay = performance.now() - started; });
    }));
    await page.goto('https://www.bilibili.com/video/BV1mdxN68E7F/');
    await page.waitForFunction(() => window.firstWideDelay !== undefined);
    const delay = await page.evaluate(() => window.firstWideDelay);
    assert(delay < 700, `initial wide check waited ${Math.round(delay)}ms`);
    return { delay };
  });
  await check('97-auto-wide-hydration', async page => {
    await seed({ wide: true });
    await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
      const app = document.querySelector('#app'); app.setAttribute('data-server-rendered', 'true');
      window.hydrationClicks = [];
      document.querySelector('.bpx-player-ctrl-wide').addEventListener('click', () => window.hydrationClicks.push(app.hasAttribute('data-server-rendered')));
      setTimeout(() => app.removeAttribute('data-server-rendered'), 400);
    }));
    await page.goto('https://www.bilibili.com/video/BV1mdxN68E7F/');
    await page.waitForFunction(() => window.hydrationClicks.length > 0);
    assert.deepEqual(await page.evaluate(() => window.hydrationClicks), [false]);
  });
  for (const scenario of ['normal', 'delayed-layout', 'already-wide', 'user-scrolled', 'user-during', 'manual-exit', 'disabled']) await check(`83-auto-wide-${scenario}`, async page => {
    await seed({ wide: scenario !== 'disabled' });
    await page.addInitScript(scenario => document.addEventListener('DOMContentLoaded', () => {
      const player = document.querySelector('.bpx-player-container');
      const style = document.createElement('style');
      style.textContent = 'body{min-height:3000px!important}.video-container-v1{padding-top:180px!important}.bpx-player-container{height:650px!important;aspect-ratio:auto!important}';
      document.head.append(style);
      window.screenProbe = { player, video: player.querySelector('video'), clicks: 0 };
      if (scenario === 'already-wide') player.dataset.screen = 'wide';
      if (scenario === 'user-scrolled') scrollTo({ top: 500, behavior: 'instant' });
      document.querySelector('.bpx-player-ctrl-wide').addEventListener('click', () => {
        window.screenProbe.clicks++;
        if (scenario === 'delayed-layout') setTimeout(() => { style.textContent += '.bpx-player-container{height:740px!important}'; }, 100);
        if (scenario === 'user-during') setTimeout(() => scrollTo({ top: 500, behavior: 'instant' }), 60);
        if (scenario === 'manual-exit') setTimeout(() => { player.dataset.screen = 'normal'; }, 60);
      });
    }), scenario);
    await page.goto('https://www.bilibili.com/video/BV1mdxN68E7F/');
    await page.locator('#margin-watch-top .top').waitFor();
    await page.waitForTimeout(2200);
    const state = await page.evaluate(() => {
      const player = document.querySelector('.bpx-player-container'), r = player.getBoundingClientRect();
      return { y: scrollY, top: r.top, bottom: r.bottom, height: r.height, screen: player.dataset.screen,
        clicks: window.screenProbe.clicks, samePlayer: player === window.screenProbe.player,
        sameVideo: player.querySelector('video') === window.screenProbe.video };
    });
    assert(state.samePlayer && state.sameVideo, 'native media replaced');
    if (scenario === 'user-scrolled' || scenario === 'user-during') assert(Math.abs(state.y - 500) < 2, JSON.stringify(state));
    else if (scenario === 'manual-exit') { assert.equal(state.y, 0, JSON.stringify(state)); assert.equal(state.screen, 'normal'); }
    else if (scenario === 'disabled') assert.equal(state.y, 0, JSON.stringify(state));
    else {
      assert.equal(state.screen, 'wide');
      assert(state.y > 0 && state.top >= 64 && state.bottom <= 900, JSON.stringify(state));
      assert.equal(state.clicks, scenario === 'already-wide' ? 0 : 1);
    }
    await page.evaluate(() => { document.querySelector('.bpx-player-container').dataset.screen = 'normal'; scrollTo({ top: 750, behavior: 'instant' }); });
    await page.waitForTimeout(1100);
    assert.equal(await page.evaluate(() => scrollY), 750, 'automatic alignment repeated after manual exit');
    return state;
  });
} finally {
  writeFileSync(join(out, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  await context.close();
}
if (results.some(result => !result.ok) || errors.length) process.exitCode = 1;
