import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { apiBody, installMocks } from './mocks.mjs';

const ext = resolve(process.env.SMOKE_EXT || 'dist');
const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/reported-issues');
const baseline = process.env.ISSUES_BASELINE === '1';
mkdirSync(out, { recursive: true });
const results = [], errors = [];
let override;
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-issues-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  viewport: { width: 1920, height: 1000 }, locale: 'zh-CN',
});
try {
  await installMocks(ctx, u => override?.(u));
  await ctx.addInitScript(() => sessionStorage.setItem('margin:intro-played', '1'));
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  const page = ctx.pages()[0];
  page.on('pageerror', e => errors.push(e.message));
  const seed = patch => sw.evaluate(async p => {
    const s = (await chrome.storage.local.get('margin:settings'))['margin:settings'] || {};
    await chrome.storage.local.set({ 'margin:settings': { ...s, ...p } });
  }, patch);
  await seed({ intro: false, weather: false, footprint: true, wide: false, autoWeb: false, theme: 'dark' });
  const check = async (name, run) => {
    if (process.env.ISSUES_ONLY && !name.startsWith(process.env.ISSUES_ONLY)) return;
    try { const evidence = await run(); results.push({ name, ok: true, evidence }); console.log(`PASS ${name}`); }
    catch (e) { results.push({ name, ok: false, error: e.message }); console.log(`FAIL ${name}: ${e.message}`); await page.screenshot({ path: join(out, `${name}-failed.png`) }); }
    override = undefined;
  };
  await check('105-existing-duration-control', async () => {
    await seed({ appFeed: false, filters: { keywords: [], ups: [], minViews: 0, minDuration: 0 } });
    await page.goto('https://www.bilibili.com/');
    await page.locator('#margin-root .card:not(.sk)').first().waitFor();
    const before = await page.locator('#margin-root .card:not(.sk)').count();
    await page.locator('#margin-root .hd-settings').click();
    await page.getByRole('button', { name: '播放量与时长', exact: true }).click();
    await page.getByRole('radio', { name: '10 分钟', exact: true }).click();
    await page.waitForFunction(() => {
      const durations = [...document.getElementById('margin-root').shadowRoot.querySelectorAll('.card:not(.sk) .dur')];
      return durations.length && durations.every(e => e.textContent.split(':').reduce((s, n) => s * 60 + Number(n), 0) >= 600);
    });
    const after = await page.locator('#margin-root .card:not(.sk)').count();
    assert(after < before);
    await page.getByRole('radio', { name: '不限', exact: true }).last().click();
    await page.locator('.sheet-layer[data-open="true"] .sheet-x').click();
    return { before, after, minimumSeconds: 600 };
  });
  await check('106-existing-header-visibility', async () => {
    await seed({ headHide: [] });
    await page.goto('https://www.bilibili.com/');
    await page.locator('#margin-root .hd-settings').click();
    await page.getByRole('button', { name: /顶栏入口/ }).click();
    const toggle = page.getByRole('switch', { name: '顶栏显示直播', exact: true });
    await toggle.click();
    await page.waitForFunction(() => document.getElementById('margin-root').shadowRoot.querySelector('.et-btn[aria-label="直播"]').hidden);
    await toggle.click();
    await page.waitForFunction(() => !document.getElementById('margin-root').shadowRoot.querySelector('.et-btn[aria-label="直播"]').hidden);
    await page.locator('.sheet-layer[data-open="true"] .sheet-x').click();
  });
  await check('103-space-html-response-recovery', async () => {
    let fail = true;
    const pattern = '**/x/space/wbi/arc/search?*';
    await ctx.route(pattern, async route => {
      if (!fail) return route.fallback();
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<!DOCTYPE html><html>temporary error</html>' });
    });
    try {
      await page.goto('https://space.bilibili.com/2/video');
      await page.getByText(/B 站接口返回了非 JSON 页面/).waitFor();
      fail = false;
      await page.getByRole('button', { name: '重试', exact: true }).click();
      await page.locator('#margin-root .card:not(.sk)').first().waitFor();
      assert.equal(await page.getByText(/Unexpected token/).count(), 0);
    } finally { await ctx.unroute(pattern); }
  });
  await check('99-dynamic-video-filter', async () => {
    await ctx.addCookies([{ name: 'bili_jct', value: 'offline-test-token', domain: '.bilibili.com', path: '/' }]);
    await seed({ dynamicVideoOnly: false });
    const fixture = apiBody('https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/all');
    const video = fixture.data.items.find(x => x.modules.module_dynamic.major?.archive);
    const word = fixture.data.items.find(x => !x.modules.module_dynamic.major?.archive);
    let holdAll = false, releaseAll;
    override = async u => {
      if (!u.includes('web-dynamic/v1/feed/all')) return;
      const videoOnly = new URL(u).searchParams.get('type') === 'video';
      if (!videoOnly && holdAll) { holdAll = false; await new Promise(resolve => { releaseAll = resolve; }); }
      return { code: 0, data: { ...fixture.data, items: videoOnly ? [video] : [video, word], has_more: false, offset: '' } };
    };
    await page.goto('https://www.bilibili.com/');
    await page.locator('#margin-root .et-btn[aria-label="动态"]').hover();
    const pop = page.locator('#margin-root .dp[aria-label="最新动态"]');
    await pop.locator('.dp-row').nth(1).waitFor();
    const toggle = pop.getByRole('switch', { name: '动态菜单仅显示视频' });
    assert.equal(await toggle.getAttribute('aria-checked'), 'false');
    await toggle.click();
    await page.waitForFunction(() => document.getElementById('margin-root').shadowRoot.querySelectorAll('.dp[aria-label="最新动态"] .dp-row').length === 1);
    const entry = pop.locator('.dp-entry').first();
    const cover = await entry.locator('.dp-cover').boundingBox();
    const button = await entry.locator('.card-later').boundingBox();
    assert(button.x >= cover.x && button.y >= cover.y && button.x + button.width <= cover.x + cover.width + 1 && button.y + button.height <= cover.y + cover.height + 1);
    await entry.locator('.card-later').click();
    await entry.locator('.card-later[data-state="ok"]').waitFor();
    holdAll = true;
    await toggle.click();
    await page.waitForTimeout(100);
    assert(releaseAll, 'delayed all-feed request did not start');
    await toggle.click();
    releaseAll();
    await page.waitForTimeout(300);
    assert.equal(await pop.locator('.dp-row').count(), 1, 'stale all-feed response replaced video filter');
    await page.reload();
    await page.locator('#margin-root .et-btn[aria-label="动态"]').hover();
    await pop.locator('.dp-row').waitFor();
    assert.equal(await toggle.getAttribute('aria-checked'), 'true');
    await page.screenshot({ path: join(out, 'dynamic-video-filter.png') });
    await seed({ dynamicVideoOnly: false });
  });
  await check('100-following-selected-avatar', async () => {
    const portal = apiBody('https://api.bilibili.com/x/polymer/web-dynamic/v1/portal');
    const sample = portal.data.up_list.items[0];
    portal.data.up_list.items = Array.from({ length: 32 }, (_, i) => ({ ...sample, mid: i + 1000, uname: `UP ${i + 1}`, has_update: false }));
    override = u => u.includes('/v1/portal') ? portal : undefined;
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('https://t.bilibili.com/');
    const row = page.locator('#margin-root .fd-ups-row');
    await row.locator('.fd-up').last().waitFor({ state: 'attached' });
    await row.evaluate(row => {
      const edge = row.getBoundingClientRect().right;
      const clipped = [...row.children].find(e => { const r = e.getBoundingClientRect(); return r.left < edge && r.right > edge; });
      if (!clipped) throw new Error('No partially clipped avatar in fixture');
      clipped.click();
    });
    await page.waitForTimeout(650);
    const geometry = await row.evaluate(row => {
      const selected = row.querySelector('[aria-pressed="true"]').getBoundingClientRect();
      const bounds = row.getBoundingClientRect();
      return { left: selected.left - bounds.left, right: bounds.right - selected.right, scrollLeft: row.scrollLeft };
    });
    assert(geometry.scrollLeft > 0 && geometry.left >= -1 && geometry.right >= -1, JSON.stringify(geometry));
    return geometry;
  });
  await check('107-home-tab-scroll', async () => {
    await seed({ appFeed: false, rerank: false });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('https://www.bilibili.com/');
    await page.locator('#margin-root .card:not(.sk)').first().waitFor();
    await page.waitForTimeout(400);
    const app = page.locator('#margin-root .app');
    await app.evaluate(e => { e.scrollTop = 600; });
    await page.waitForTimeout(500);
    const before = await app.evaluate(e => e.scrollTop);
    assert(before > 300, `fixture must be scrolled: ${before}`);
    await page.locator('#margin-root .tab[data-tab="popular"]').click();
    await page.waitForTimeout(700);
    const popular = await app.evaluate(e => e.scrollTop);
    assert(popular > 100, `new tab jumped back to page top: ${popular}`);
    await page.locator('#margin-root .tab[data-tab="rcmd"]').click();
    await page.waitForTimeout(700);
    const restored = await app.evaluate(e => e.scrollTop);
    assert(Math.abs(restored - before) < 2, `cached position ${before} restored as ${restored}`);
    await page.locator('#margin-root .tab[data-tab="popular"]').click();
    await page.locator('#margin-root .tab[data-tab="rcmd"]').click();
    await page.waitForTimeout(400);
    assert(Math.abs(await app.evaluate(e => e.scrollTop) - before) < 2, 'rapid switching lost saved scroll');
    await app.evaluate(e => { e.scrollTop = 0; });
    await page.waitForTimeout(300);
    assert.equal(await app.evaluate(e => e.scrollTop), 0);
    // 从已确认的顶部触发刷新，避免定位吸顶按钮时自动滚动改变测试场景。
    await page.locator('#margin-root .refresh:not(.back)').evaluate(button => button.click());
    await page.waitForTimeout(800);
    assert.equal(await app.evaluate(e => e.scrollTop), 0, 'refresh at top moved the page');
    return { before, popular, restored };
  });
  await check('108-history-episode-links', async () => {
    const fixture = apiBody('https://api.bilibili.com/x/web-interface/history/cursor');
    const item = fixture.data.list.find(x => x.history.business === 'archive');
    item.history.page = 4;
    item.uri = 'https://www.bilibili.com/video/BV1first?p=1';
    fixture.data.list = [item];
    override = async u => {
      if (!u.includes('/history/cursor') && !u.includes('/history/search')) return undefined;
      await new Promise(resolve => setTimeout(resolve, 500));
      return fixture;
    };
    await page.goto('https://www.bilibili.com/account/history');
    const link = page.locator('#margin-root a.hi-card[href]').first();
    await link.waitFor();
    const expected = new URL(await link.getAttribute('href'));
    assert.equal(expected.pathname, `/video/${item.history.bvid}`);
    assert.equal(expected.searchParams.get('p'), '4');
    const popup = page.waitForEvent('popup');
    await link.click();
    const target = await popup;
    assert.equal(new URL(target.url()).searchParams.get('p'), '4');
    await target.close();
    const searched = page.waitForResponse(response => response.url().includes('/history/search'));
    await page.locator('#margin-root .hi-input').fill('合集');
    await searched;
    await link.waitFor();
    assert.equal(new URL(await link.getAttribute('href')).searchParams.get('p'), '4');
    return { url: expected.href };
  });
  await check('69-footprint-full-width', async () => {
    await page.goto('https://www.bilibili.com/');
    await page.locator('#margin-root .fp-card').waitFor();
    for (const width of [2520, 1440, 1100]) {
      await page.setViewportSize({ width, height: 1000 });
      const gap = await page.locator('#margin-root .dash').evaluate(e => e.clientWidth - e.querySelector('.fp-card').getBoundingClientRect().width);
      assert(Math.abs(gap) < 2, `width ${width}: unused space ${gap}px`);
    }
    await seed({ weather: true, privacyExternal: true });
    await page.locator('#margin-root .wx').waitFor();
    await seed({ weather: false, footprint: false });
    await page.locator('#margin-root .dash').waitFor({ state: 'hidden' });
    await seed({ footprint: true });
    await page.locator('#margin-root .fp-card').waitFor();
    await page.locator('#margin-root .wx').waitFor({ state: 'detached' });
    assert(await page.locator('#margin-root .dash').evaluate(e => Math.abs(e.clientWidth - e.firstElementChild.getBoundingClientRect().width) < 2));
    await page.screenshot({ path: join(out, 'footprint.png') });
  });
  await check('70-settings-position', async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const url of ['https://www.bilibili.com/', 'https://www.bilibili.com/video/BV1mdxN68E7F/', 'https://space.bilibili.com/2/video', 'https://t.bilibili.com/', 'https://message.bilibili.com/', 'https://search.bilibili.com/all?keyword=test']) {
      await page.goto(url); await page.locator('.top').waitFor();
      const button = page.locator('.top .acts > .hd-settings');
      assert.equal(await button.count(), 1, url);
      assert.equal(await page.locator('.top .et [title="设置"]').count(), 0);
      await button.click();
      await page.locator('.sheet-layer[data-open="true"]').waitFor();
    }
  });
  await check('66-wide-title-width', async () => {
    await page.goto('https://www.bilibili.com/video/BV1mdxN68E7F/');
    await page.locator('#margin-watch-top .top').waitFor();
    // Native two-column layout: wide player overflows the left column.
    await page.addStyleTag({ content: '.video-container-v1{width:90vw;margin:auto;display:flex;gap:30px}.left-container{width:calc(100% - 350px);flex:none}.right-container{width:320px}.bpx-player-container[data-screen="wide"]{width:90vw!important}' });
    await page.locator('.bpx-player-ctrl-wide').click();
    for (const width of [1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 }); await page.waitForTimeout(250);
      const sizes = await page.evaluate(() => ({ title: document.querySelector('.video-info-container').getBoundingClientRect().width, player: document.querySelector('.bpx-player-container').getBoundingClientRect().width }));
      assert(Math.abs(sizes.title - sizes.player) < 2, JSON.stringify(sizes));
    }
    await page.screenshot({ path: join(out, 'wide.png') });
    await page.locator('.bpx-player-container').evaluate(e => e.dataset.screen = 'normal');
    await page.waitForTimeout(250);
    assert(await page.evaluate(() => Math.abs(document.querySelector('.video-info-container').getBoundingClientRect().width - document.querySelector('.left-container').getBoundingClientRect().width) < 2));
  });
  await check('58-auto-wide-native-spacer', async () => {
    await seed({ wide: true });
    const watch = await ctx.newPage();
    try {
      await watch.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style');
        style.textContent = '.video-container-v1{position:relative;min-height:2600px}.left-container{width:900px}.right-container{position:absolute;top:96px;right:0;width:350px}.up-panel-container{height:130px!important}.margin-wide #danmukuBox{margin-top:714px}.bpx-player-container{height:686px!important}';
        document.head.append(style);
        const side = document.querySelector('.right-container');
        const inner = document.createElement('div'); inner.className = 'right-container-inner scroll-sticky';
        inner.append(...side.childNodes); side.append(inner);
        const up = document.createElement('div'); up.className = 'up-panel-container'; up.textContent = 'UP 主卡片'; inner.prepend(up);
      }));
      await watch.goto('https://www.bilibili.com/video/BV1mdxN68E7F/');
      await watch.locator('html.margin-wide').waitFor();
      await watch.waitForTimeout(500);
      const geometry = await watch.evaluate(() => {
        const player = document.querySelector('.bpx-player-container').getBoundingClientRect();
        const up = document.querySelector('.up-panel-container').getBoundingClientRect();
        const recommendation = document.querySelector('.recommend-list-v1').getBoundingClientRect();
        return { upGap: up.top - player.bottom, recommendationGap: recommendation.top - up.bottom };
      });
      await watch.screenshot({ path: join(out, 'auto-wide-native-spacer.png') });
      assert(Math.abs(geometry.upGap - 16) < 3, JSON.stringify(geometry));
      assert(geometry.recommendationGap >= 0 && geometry.recommendationGap < 80, JSON.stringify(geometry));
      await watch.locator('.bpx-player-container').evaluate(e => e.dataset.screen = 'normal');
      await watch.locator('html.margin-wide').waitFor({ state: 'detached' });
      await watch.waitForTimeout(1200);
      assert.equal(await watch.locator('.bpx-player-container').getAttribute('data-screen'), 'normal');
      assert.equal(await watch.evaluate(() => document.documentElement.style.getPropertyValue('--m-wide-pad')), '');
      return geometry;
    } finally { await watch.close(); await seed({ wide: false }); }
  });
  await check('58-wide-inner-offset', async () => {
    await page.goto('https://www.bilibili.com/video/BV1mdxN68E7F/');
    await page.locator('#margin-watch-top .top').waitFor();
    await page.addStyleTag({ content: '.video-container-v1{position:relative;min-height:2400px}.left-container{width:900px}.right-container{position:absolute;top:96px;right:0;width:350px}.right-container-inner{padding-top:500px}.bpx-player-container{height:686px!important}' });
    await page.evaluate(() => {
      const side = document.querySelector('.right-container');
      const inner = document.createElement('div'); inner.className = 'right-container-inner';
      const panel = document.createElement('div'); panel.className = 'up-panel-container'; panel.textContent = '晚挂载卡片';
      inner.append(panel, ...side.childNodes); side.append(inner);
    });
    await page.locator('.bpx-player-ctrl-wide').click();
    await page.waitForTimeout(500);
    const gap = () => page.evaluate(() => document.querySelector('.up-panel-container').getBoundingClientRect().top - document.querySelector('.bpx-player-container').getBoundingClientRect().bottom);
    assert(Math.abs((await gap()) - 16) < 3, `native inner offset counted twice: gap=${await gap()}`);
    await page.locator('.right-container-inner').evaluate(e => e.style.paddingTop = '300px');
    await page.waitForTimeout(500);
    assert(Math.abs((await gap()) - 16) < 3, `late inner spacing: gap=${await gap()}`);
    await page.evaluate(() => scrollTo(0, 300)); await page.waitForTimeout(250);
    assert(Math.abs((await gap()) - 16) < 3, `scroll gap=${await gap()}`);
    await page.locator('.up-panel-container').evaluate(e => e.style.display = 'none');
    await page.waitForTimeout(500);
    const hiddenAuthorGap = await page.evaluate(() => document.querySelector('#danmukuBox').getBoundingClientRect().top - document.querySelector('.bpx-player-container').getBoundingClientRect().bottom);
    assert(Math.abs(hiddenAuthorGap - 16) < 3, `hidden author gap=${hiddenAuthorGap}`);
  });
  await check('58-wide-author-scroll', async () => {
    await page.setViewportSize({ width: 1440, height: 808 });
    await page.goto('https://www.bilibili.com/video/BV1mdxN68E7F/');
    await page.locator('#margin-watch-top .top').waitFor();
    // Native sticky columns share a row, while the wide player spans both columns.
    await page.addStyleTag({ content: 'body{margin:0}.video-container-v1{display:flex;align-items:flex-start;width:90vw;margin:auto;gap:30px;min-height:2600px}.left-container{width:calc(100% - 380px);flex:none}.video-container-v1 .left-container.scroll-sticky{position:sticky;z-index:1}.right-container{position:relative;width:350px;flex:none}.bpx-player-container{height:686px!important}.bpx-player-container[data-screen="wide"]{width:90vw!important}.up-panel-container{height:130px!important}' });
    await page.evaluate(() => {
      const left = document.querySelector('.left-container');
      left.classList.add('scroll-sticky'); left.style.top = '0px';
      const panel = document.createElement('div'); panel.className = 'up-panel-container';
      const name = document.createElement('a'); name.href = 'https://space.bilibili.com/1'; name.textContent = 'UP 主';
      panel.append(name); document.querySelector('.right-container').prepend(panel);
      document.querySelector('.bpx-player-container').dataset.screen = 'wide';
    });
    await page.locator('html.margin-wide').waitFor(); await page.waitForTimeout(500);
    const geometry = () => page.evaluate(() => {
      const panel = document.querySelector('.up-panel-container'), up = panel.getBoundingClientRect();
      const player = document.querySelector('.bpx-player-container').getBoundingClientRect();
      const hit = document.elementFromPoint(up.x + up.width / 2, up.y + up.height / 2);
      return { gap: up.top - player.bottom, upTop: up.top, playerBottom: player.bottom, hit: panel.contains(hit) };
    });
    assert(Math.abs((await geometry()).gap - 16) < 3);
    // Bilibili rewrites this inset during scrolling. The player must not cover the author card.
    await page.evaluate(() => {
      document.querySelector('.left-container').style.top = '-358px';
      scrollTo(0, 650);
    });
    await page.waitForTimeout(250);
    const scrolled = await geometry();
    await page.screenshot({ path: join(out, 'wide-author-scroll.png') });
    assert(Math.abs(scrolled.gap - 16) < 3 && scrolled.hit, JSON.stringify(scrolled));
    for (const screen of ['normal', 'web', 'full']) {
      await page.locator('.bpx-player-container').evaluate((el, value) => el.dataset.screen = value, screen);
      await page.locator('html.margin-wide').waitFor({ state: 'detached' });
      const style = await page.locator('.left-container').evaluate(el => ({ position: getComputedStyle(el).position, top: getComputedStyle(el).top }));
      assert.equal(style.position, 'sticky', `${screen}: wide positioning override leaked`);
      assert.equal(style.top, '-358px', `${screen}: native inset was overwritten`);
    }
    await page.evaluate(() => {
      scrollTo(0, 0);
      document.querySelector('.bpx-player-container').dataset.screen = 'wide';
    });
    await page.locator('html.margin-wide').waitFor(); await page.waitForTimeout(250);
    assert(Math.abs((await geometry()).gap - 16) < 3);
    await page.evaluate(() => scrollTo(0, 650)); await page.waitForTimeout(250);
    const reopened = await geometry();
    assert(Math.abs(reopened.gap - 16) < 3 && reopened.hit, JSON.stringify(reopened));
    return { scrolled, reopened };
  });
  await check('58-wide-mini-layout', async () => {
    await page.setViewportSize({ width: 1440, height: 808 });
    await page.goto('https://www.bilibili.com/video/BV1mdxN68E7F/');
    await page.locator('#margin-watch-top .top').waitFor();
    await page.addStyleTag({ content: 'body{margin:0}.video-container-v1{display:flex;align-items:flex-start;width:90vw;margin:auto;gap:30px;min-height:3000px}.left-container{width:calc(100% - 380px);flex:none}.right-container{position:relative;width:350px;flex:none}.up-panel-container{min-height:130px}#danmukuBox{height:44px}.video-container-v1[data-layout="wide"] #danmukuBox{margin-top:714px}.video-pod{height:180px}' });
    await page.evaluate(() => {
      const player = document.querySelector('.bpx-player-container');
      const wrap = document.createElement('div'); wrap.id = 'playerWrap'; wrap.className = 'player-wrap'; wrap.style.height = '686px';
      player.before(wrap); wrap.append(player);
      const panel = document.createElement('div'); panel.className = 'up-panel-container'; panel.textContent = 'UP 主卡片';
      const pod = document.createElement('div'); pod.className = 'video-pod'; pod.textContent = '合集';
      document.querySelector('.right-container').prepend(panel);
      document.querySelector('#danmukuBox').after(pod);
    });
    const setScreen = async screen => {
      await page.evaluate(value => {
        const player = document.querySelector('.bpx-player-container');
        player.dataset.screen = value;
        player.style.cssText = value === 'mini'
          ? 'position:fixed;right:16px;bottom:16px;width:320px;height:180px;background:#000;z-index:10'
          : `position:relative;width:${value === 'wide' ? '90vw' : '100%'};height:686px;background:#000`;
        // Native wide document layout and its spacer survive the switch to a floating player.
        if (value !== 'mini') document.querySelector('.video-container-v1').dataset.layout = value;
      }, screen);
      await page.waitForTimeout(300);
    };
    const geometry = () => page.evaluate(() => {
      const de = document.documentElement, panel = document.querySelector('.up-panel-container');
      const up = panel.getBoundingClientRect(), wrap = document.querySelector('#playerWrap').getBoundingClientRect();
      const hit = document.elementFromPoint(up.x + up.width / 2, up.y + up.height / 2);
      return {
        wide: de.classList.contains('margin-wide'), pad: de.style.getPropertyValue('--m-wide-pad'), width: de.style.getPropertyValue('--m-wide-width'),
        titleWidth: document.querySelector('.video-info-container').getBoundingClientRect().width,
        wrapWidth: wrap.width, wrapBottom: wrap.bottom + scrollY, authorTop: up.top + scrollY,
        danmakuTop: document.querySelector('#danmukuBox').getBoundingClientRect().top + scrollY,
        podTop: document.querySelector('.video-pod').getBoundingClientRect().top + scrollY, hit: panel.contains(hit),
      };
    });
    await setScreen('wide');
    const before = await geometry();
    assert(before.wide && before.pad && before.width);
    assert(before.wrapWidth < before.titleWidth, 'placeholder must stay narrower than the wide player');
    assert(Math.abs(before.authorTop - before.wrapBottom - 16) < 3);
    await page.evaluate(y => scrollTo(0, y), before.wrapBottom - 12);
    await setScreen('mini');
    const stable = async label => {
      const current = await geometry();
      assert(current.wide && current.hit, `${label}: ${JSON.stringify(current)}`);
      assert.equal(current.pad, before.pad, `${label}: sidebar padding changed`);
      assert.equal(current.width, before.width, `${label}: title width measured the floating player`);
      for (const key of ['titleWidth', 'authorTop', 'danmakuTop', 'podTop']) {
        assert(Math.abs(current[key] - before[key]) < 2, `${label}: ${key} changed from ${before[key]} to ${current[key]}`);
      }
      return current;
    };
    await page.screenshot({ path: join(out, 'wide-mini-layout.png') });
    const mini = await stable('wide to mini');
    await page.setViewportSize({ width: 1460, height: 808 });
    await page.locator('.video-pod').evaluate(el => el.append(document.createElement('span')));
    await page.waitForTimeout(300);
    await stable('mini resize and sidebar mutation');
    await page.setViewportSize({ width: 1440, height: 808 });
    await setScreen('wide');
    await stable('mini to wide');
    for (const screen of ['normal', 'web', 'full']) {
      await setScreen('wide'); await setScreen(screen);
      const current = await geometry();
      assert(!current.wide && current.pad === '' && current.width === '', `${screen}: wide layout was retained`);
    }
    await setScreen('normal'); await setScreen('mini');
    const normalMini = await geometry();
    assert(!normalMini.wide && normalMini.pad === '' && normalMini.width === '', 'normal to mini acquired wide layout');
    return { before, mini, normalMini };
  });
  await check('11-classic-loading-sticky-stability', async () => {
    override = async u => {
      if (!u.includes('/arc/search')) return;
      await new Promise(r => setTimeout(r, 4500));
      const b = apiBody(u); b.data.list.vlist.forEach(v => v.created = 1600000000); return b;
    };
    const runs = [];
    for (const prefs of [{ zoom: 100, homeHide: [] }, { zoom: 120, homeHide: ['date'] }]) {
      await seed({ weather: false, ...prefs });
      await page.setViewportSize({ width: 2520, height: 1000 });
      await page.goto('https://www.bilibili.com/');
      await page.locator('#margin-root .tab[data-tab="classic"]').click();
      await page.locator('#margin-root .home-grid .sk').first().waitFor();
      const samples = await page.locator('#margin-root .app').evaluate(async app => {
        const bar = app.querySelector('.bar'), mark = app.querySelector('.bar-mark');
        const data = [];
        // Place the viewport bottom close to the sticky threshold, as on a tall screen with a short skeleton grid.
        const target = mark.getBoundingClientRect().top + app.scrollTop - 72 + 15;
        app.style.height = `${app.scrollHeight - target}px`;
        app.scrollTop = app.scrollHeight;
        for (let i = 0; i < 90; i++) {
          await new Promise(r => requestAnimationFrame(r));
          data.push({ stuck: bar.classList.contains('stuck'), top: app.scrollTop, height: bar.getBoundingClientRect().height });
        }
        return data;
      });
      const flips = samples.reduce((n, s, i) => n + (i && s.stuck !== samples[i - 1].stuck ? 1 : 0), 0);
      writeFileSync(join(out, `sticky-samples-${prefs.zoom}.json`), JSON.stringify(samples));
      assert(flips <= 1, `${flips} sticky transitions without further scrolling`);
      runs.push({ ...prefs, flips });
    }
    await seed({ zoom: 100, homeHide: [] });
    return runs;
  });
  await check('67-collections-series-navigation', async () => {
    const requests = [];
    let failPageTwo = true, delay = false, empty = false;
    const video = (i, kind) => ({ aid: i, bvid: `BVcollection${kind}${i}`, title: `${kind} 视频 ${i}`, pic: 'https://i0.hdslb.com/test.jpg', duration: 123, pubdate: 1600000000, stat: { view: 456 } });
    override = async raw => {
      const u = new URL(raw), p = u.pathname, q = u.searchParams;
      if (p.endsWith('/seasons_series_list')) {
        requests.push({ kind: 'index', page: Number(q.get('page_num')) });
        const index = Number(q.get('page_num'));
        const data = { page: { total: empty ? 0 : 3 }, seasons_list: [], series_list: [] };
        if (!empty) {
          data.seasons_list = [{ meta: { season_id: index, name: `测试合集 ${index}`, total: 3, cover: '' }, archives: [] }];
          if (index === 1) data.series_list = [{ meta: { series_id: 20, name: '测试系列', total: 2 }, archives: [video(1, 'series')] }];
        }
        return { code: 0, data: { items_lists: data } };
      }
      if (p.endsWith('/seasons_archives_list') || p.endsWith('/series/archives')) {
        const kind = p.endsWith('/series/archives') ? 'series' : 'season';
        const num = Number(q.get(kind === 'series' ? 'pn' : 'page_num'));
        requests.push({ kind, page: num });
        if (delay) await new Promise(r => setTimeout(r, 1200));
        if (kind === 'season' && num === 2 && failPageTwo) { failPageTwo = false; return { code: -500, message: '测试分页失败' }; }
        return { code: 0, data: { page: { total: kind === 'series' ? 2 : 3 }, archives: [video(num, kind)] } };
      }
    };
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('https://space.bilibili.com/2/video');
    await page.locator('#margin-root .tab[data-tab="collections"]').click();
    await page.waitForFunction(() => document.getElementById('margin-root').shadowRoot.querySelectorAll('.sp-collection').length === 3);
    assert.equal(await page.locator('#margin-root .sp-q:visible').count(), 0);
    assert.equal(await page.locator('#margin-root .sp-collection[data-kind="series"] img').count(), 1);
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(out, 'collections.png') });
    await page.locator('#margin-root .sp-collection[data-kind="season"] .cover').first().click();
    await page.locator('#margin-root .status button').waitFor();
    await page.waitForTimeout(250);
    assert.deepEqual(requests.filter(r => r.kind === 'season').map(r => r.page), [1, 2]);
    await page.locator('#margin-root .status button').click();
    await page.waitForFunction(() => document.getElementById('margin-root').shadowRoot.querySelectorAll('.grid .card:not(.sk)').length === 3);
    assert.deepEqual(requests.filter(r => r.kind === 'season').map(r => r.page), [1, 2, 2, 3]);
    assert.equal(await page.locator('#margin-root .grid .card .cover').first().getAttribute('href'), 'https://www.bilibili.com/video/BVcollectionseason1');
    await page.locator('#margin-root .sp-collection-head button').click();
    await page.locator('#margin-root .sp-collection[data-kind="series"] .cover').click();
    await page.waitForFunction(() => document.getElementById('margin-root').shadowRoot.querySelectorAll('.grid .card:not(.sk)').length === 2);
    assert.deepEqual(requests.filter(r => r.kind === 'series').map(r => r.page), [1, 2]);
    await page.locator('#margin-root .sp-layout button').filter({ hasText: '列表' }).click();
    await page.locator('#margin-root .vrow:not(.sk)').first().waitFor();
    await page.screenshot({ path: join(out, 'series.png') });
    await page.locator('#margin-root .sp-collection-head button').click();
    delay = true;
    await page.locator('#margin-root .sp-collection[data-kind="season"] .cover').first().click();
    await page.locator('#margin-root .tab[data-tab="dynamic"]').click();
    await page.locator('#margin-root .dy:not(.sk)').first().waitFor();
    await page.waitForTimeout(1400);
    assert.equal(await page.locator('#margin-root .sp-collection-head:visible').count(), 0);
    assert.equal(await page.locator('#margin-root .dy-list .card').count(), 0);
    empty = true;
    await page.goto('https://space.bilibili.com/2?margin_tab=collections');
    await page.locator('#margin-root .status').filter({ hasText: '还没有合集或系列' }).waitFor();
    assert.equal(await page.locator('#margin-root .tab[data-tab="collections"][aria-selected="true"]').count(), 1);
    return { requests };
  });
  await check('71-space-live-badge', async () => {
    let releaseLive;
    const liveResponse = new Promise(resolve => { releaseLive = resolve; });
    override = u => u.includes('/Room/getRoomInfoOld') ? liveResponse : undefined;
    await page.goto('https://space.bilibili.com/50329118');
    await page.locator('#margin-root .sp-face').waitFor();
    assert.equal(await page.locator('#margin-root .sp-live').count(), 0);
    releaseLive({ code: 0, data: { liveStatus: 1, roomStatus: 1, roomid: 7734200, title: '测试直播' } });
    const badge = page.locator('#margin-root .sp-live');
    await badge.waitFor({ timeout: 4000 });
    assert.equal(await badge.textContent(), '直播中');
    assert.equal(await badge.getAttribute('href'), 'https://live.bilibili.com/7734200');
    const [room] = await Promise.all([page.waitForEvent('popup'), badge.click()]);
    await room.waitForLoadState('domcontentloaded');
    assert.equal(room.url(), 'https://live.bilibili.com/7734200');
    await room.close();
    for (const width of [1440, 900]) {
      await page.setViewportSize({ width, height: 1000 });
      await seed({ theme: width === 900 ? 'light' : 'dark' });
      await page.screenshot({ path: join(out, `space-live-${width}.png`) });
      const face = await page.locator('#margin-root .sp-face').boundingBox();
      const live = await badge.boundingBox();
      assert(Math.abs(face.x + face.width / 2 - live.x - live.width / 2) < 2);
    }
    for (const reply of [{ code: 0, data: { liveStatus: 0, roomStatus: 1, roomid: 7734200 } }, { code: -500, message: '暂时不可用' }]) {
      override = u => u.includes('/Room/getRoomInfoOld') ? reply : undefined;
      await page.reload(); await page.locator('#margin-root .sp-face').waitFor();
      await page.waitForTimeout(400);
      assert.equal(await page.locator('#margin-root .sp-live').count(), 0);
      assert(await page.locator('#margin-root .sp-follow').isVisible());
    }
    await seed({ theme: 'dark' });
  });
  await check('72-following-strip-buttons', async () => {
    const portal = apiBody('https://api.bilibili.com/x/polymer/web-dynamic/v1/portal');
    const sample = portal.data.up_list.items[0];
    portal.data.up_list.items = Array.from({ length: 32 }, (_, i) => ({ ...sample, mid: i + 1000, uname: `UP ${i + 1}`, has_update: false }));
    override = u => {
      if (u.includes('/v1/portal')) return portal;
      if (u.includes('/followings/search')) return { code: 0, data: { list: [sample] } };
    };
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('https://t.bilibili.com/');
    const row = page.locator('#margin-root .fd-ups-row');
    await row.locator('.fd-up').first().waitFor();
    const prev = page.getByRole('button', { name: '向左滚动关注列表', exact: true });
    const next = page.getByRole('button', { name: '向右滚动关注列表', exact: true });
    await next.waitFor({ timeout: 4000 });
    // Avatar nodes mount before the scheduled overflow measurement enables navigation.
    await page.waitForFunction(() => {
      const root = document.getElementById('margin-root').shadowRoot;
      return !root.querySelector('[aria-label="向右滚动关注列表"]').disabled;
    });
    const assertArrowAlignment = async () => {
      const offsets = await page.evaluate(() => {
        const root = document.getElementById('margin-root').shadowRoot;
        const faces = [root.querySelector('.fd-ups > .fd-up .fd-up-all'), root.querySelector('.fd-ups-row .fd-up-face')];
        return faces.flatMap(face => [...root.querySelectorAll('.fd-ups-scroll')].map(button => {
          const f = face.getBoundingClientRect(), b = button.getBoundingClientRect();
          return b.y + b.height / 2 - f.y - f.height / 2;
        }));
      });
      assert(offsets.every(offset => Math.abs(offset) < 1), `arrow/avatar vertical centers: ${offsets.join(', ')}`);
    };
    await assertArrowAlignment();
    assert(await prev.isDisabled()); assert(await next.isEnabled());
    await next.click(); await page.waitForTimeout(600);
    assert(await row.evaluate(e => e.scrollLeft > 100));
    await prev.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(600);
    assert(await row.evaluate(e => e.scrollLeft < 1));
    assert(await prev.isDisabled());
    await row.evaluate(e => e.scrollLeft = e.scrollWidth); await page.waitForTimeout(100);
    assert(await next.isDisabled()); assert(await prev.isEnabled());
    await page.screenshot({ path: join(out, 'following-strip.png') });
    await seed({ reduceMotion: true });
    await prev.click();
    assert(await row.evaluate(e => e.scrollLeft < e.scrollWidth - e.clientWidth - 100));
    await page.getByRole('searchbox', { name: '在关注里搜 UP 主' }).fill('UP');
    await page.waitForFunction(() => document.getElementById('margin-root').shadowRoot.querySelectorAll('.fd-ups-row .fd-up').length === 1);
    assert(await prev.isDisabled()); assert(await next.isDisabled());
    await page.getByRole('searchbox', { name: '在关注里搜 UP 主' }).fill('');
    await page.waitForFunction(() => document.getElementById('margin-root').shadowRoot.querySelectorAll('.fd-ups-row .fd-up').length === 32);
    await page.setViewportSize({ width: 900, height: 1000 }); await page.waitForTimeout(100);
    await assertArrowAlignment();
    assert(await prev.isDisabled()); assert(await next.isEnabled());
    await row.locator('.fd-up').first().click();
    assert.equal(await row.locator('.fd-up').first().getAttribute('aria-pressed'), 'true');
    await seed({ reduceMotion: false });
  });
  const shandong = { name: '珠海', latitude: 35.87124, longitude: 119.99638, admin1: '山东省', admin2: '青岛市', country: '中国' };
  const guangdong = { name: '珠海市', latitude: 22.27694, longitude: 113.56778, admin1: '广东省', admin2: '珠海市', country: '中国' };
  const cities = u => ({ results: new URL(u).searchParams.get('name') === '珠海市' ? [guangdong] : [shandong] });
  await check('73-weather-city-candidates', async () => {
    const forecasts = [];
    override = u => {
      if (u.includes('geocoding-api.open-meteo.com')) return cities(u);
      if (u.includes('api.open-meteo.com')) forecasts.push(new URL(u).searchParams.get('latitude'));
    };
    await seed({ weather: true, privacyExternal: true, footprint: true, reduceMotion: true });
    await page.goto('https://www.bilibili.com/');
    // Legacy same-name location must remain editable, with no automatic migration.
    await page.evaluate(() => {
      localStorage.setItem('margin:weather-loc', JSON.stringify({ name: '珠海', lat: 35.87124, lon: 119.99638, manual: true }));
      localStorage.removeItem('margin:weather-cache');
    });
    await page.reload();
    const city = page.locator('.wx-city');
    await city.waitFor();
    assert.equal(await city.textContent(), '珠海');
    await city.click();
    await page.locator('.wx input').fill('珠海');
    await page.locator('.wx input').press('Enter');
    const choice = page.locator('.wx [role="option"]').filter({ hasText: '广东省' });
    await choice.waitFor({ timeout: 2500 });
    assert.equal(await page.locator('.wx [role="option"]').count(), 2);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('margin:weather-loc')).lat), 35.87124);
    for (const [width, theme] of [[1440, 'dark'], [900, 'light']]) {
      await page.setViewportSize({ width, height: 1000 });
      await seed({ theme });
      await page.screenshot({ path: join(out, `weather-city-${theme}.png`) });
      const box = await choice.boundingBox();
      assert(box && box.x >= 0 && box.x + box.width <= width && box.height > 24);
    }
    const before = forecasts.length;
    await choice.focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('margin-root').shadowRoot.querySelector('.wx-city')?.textContent === '珠海市');
    const selected = await page.evaluate(() => JSON.parse(localStorage.getItem('margin:weather-loc')));
    assert.equal(selected.lat, guangdong.latitude);
    assert(selected.region.includes('广东省'));
    assert.deepEqual(forecasts.slice(before), [String(guangdong.latitude)]);
    await city.click();
    await page.locator('.wx input').press('Escape');
    assert.equal(await page.locator('.wx input').count(), 0);
    assert(await city.evaluate(e => e.getRootNode().activeElement === e));
  });
  await check('73-settings-city-search-races', async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('https://www.bilibili.com/');
    await page.locator('.top .acts > .hd-settings').click();
    await page.locator('.sheet-layer .sd-head').filter({ hasText: '天气城市与卡片信息' }).click();
    const input = page.locator('.sheet-layer').getByRole('searchbox', { name: '天气城市', exact: true });
    const options = page.locator('.sheet-layer .city-list [role="option"]');
    override = u => u.includes('geocoding-api.open-meteo.com') ? cities(u) : undefined;
    await input.fill('珠海'); await input.press('Enter');
    await options.filter({ hasText: '广东省' }).waitFor({ timeout: 2500 });
    await options.filter({ hasText: '山东省' }).click();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('margin:weather-loc')).lat), shandong.latitude);
    // Clearing, editing during debounce, and returning to automatic location invalidate in-flight searches.
    for (const action of ['clear', 'edit', 'auto']) {
      const pending = [];
      override = u => u.includes('geocoding-api.open-meteo.com') ? new Promise(resolve => pending.push(resolve)) : undefined;
      await input.fill('慢查询'); await input.press('Enter');
      for (let i = 0; pending.length < 2 && i < 40; i++) await page.waitForTimeout(25);
      assert.equal(pending.length, 2);
      if (action === 'auto') await page.locator('.sheet-layer .city-auto').click();
      else await input.fill(action === 'clear' ? '' : '新城市');
      pending.forEach(resolve => resolve({ results: [{ ...shandong, name: '过期城市' }] }));
      await page.waitForTimeout(80);
      assert.equal(await options.filter({ hasText: '过期城市' }).count(), 0);
      await input.fill('');
    }
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('margin:weather-loc'))?.manual !== true);
    const failure = route => route.fulfill({ status: 503, body: 'Unavailable' });
    await ctx.route('https://geocoding-api.open-meteo.com/**', failure);
    try {
      await input.fill('网络失败'); await input.press('Enter');
      await page.locator('.sheet-layer .city-list').getByText('搜索失败，请重试').waitFor({ timeout: 2500 });
    } finally { await ctx.unroute('https://geocoding-api.open-meteo.com/**', failure); }
    override = u => u.includes('geocoding-api.open-meteo.com') ? { results: [] } : undefined;
    await input.fill('无结果'); await input.press('Enter');
    await page.locator('.sheet-layer .city-list').getByText('没有找到这个城市').waitFor({ timeout: 2500 });
  });
  await check('76-live-fullscreen-topbar', async () => {
    const live = await ctx.newPage();
    try {
      await live.setViewportSize({ width: 1440, height: 900 });
      await live.goto('https://live.bilibili.com/12345');
      const top = live.locator('#margin-watch-top');
      await top.locator('.top').waitFor();
      assert.equal(await live.locator('html.margin-live').count(), 1);
      assert(await top.isVisible(), '普通浏览时顶栏应该在');
      // ① 直播间的「网页模式」给 body 加 player-full-win（播放器没有 data-screen）：
      //    收起，退出后恢复。进/退时 playerScreen() 一直是 normal，这一步同时覆盖「状态不变也要重算」。
      await live.evaluate(() => document.body.classList.add('player-full-win', 'over-hidden'));
      await top.waitFor({ state: 'hidden', timeout: 2000 });
      await live.evaluate(() => document.body.classList.remove('player-full-win', 'over-hidden'));
      await top.waitFor({ state: 'visible', timeout: 2000 });
      // ② B 站的「全屏」走真的 Fullscreen API。内容脚本在隔离世界，主世界伪造 fullscreenElement
      //    骗不到它，所以用可信点击请浏览器自己进全屏；无头环境不支持时只跳过这一段。
      const evidence = { nativeFullscreen: 'unsupported' };
      await live.click('#native-full');
      if (await live.evaluate(() => !!document.fullscreenElement)) {
        evidence.nativeFullscreen = 'checked';
        await top.waitFor({ state: 'hidden', timeout: 2000 });
        await live.evaluate(() => document.exitFullscreen());
        await top.waitFor({ state: 'visible', timeout: 2000 });
      }
      await live.screenshot({ path: join(out, 'live-fullscreen-topbar.png') });
      return evidence;
    } finally { await live.close(); }
  });
  await check('113-space-collection-search', async () => {
    const mid = 2;
    const col = [
      { aid: 1, bvid: 'BVcol1', title: '【从零开始的 AI 学习】什么是 AI', pic: 'https://i0.hdslb.com/test.jpg', duration: 100, pubdate: 1700000300, stat: { view: 30 } },
      { aid: 2, bvid: 'BVcol2', title: '【从零开始的AI学习】提示词', pic: 'https://i0.hdslb.com/test.jpg', duration: 100, pubdate: 1700000200, stat: { view: 20 } },
      { aid: 3, bvid: 'BVcol3', title: '【从零开始的AI学习】Agent', pic: 'https://i0.hdslb.com/test.jpg', duration: 100, pubdate: 1700000100, stat: { view: 10 } },
    ];
    override = raw => {
      const u = new URL(raw), p = u.pathname, q = u.searchParams;
      if (p.endsWith('/x/web-interface/nav')) return { code: -101, data: { isLogin: false, wbi_img: { img_url: 'https://i0.hdslb.com/bfs/wbi/aaaa.png', sub_url: 'https://i0.hdslb.com/bfs/wbi/bbbb.png' } } };
      if (p.endsWith('/seasons_series_list')) return { code: 0, data: { items_lists: { page: { total: 1 }, seasons_list: [{ meta: { season_id: 7, name: '【从零开始的 AI 学习】', total: 3, cover: '' } }], series_list: [] } } };
      if (p.endsWith('/seasons_archives_list')) return { code: 0, data: { page: { total: 3 }, archives: col } };
      if (p.endsWith('/arc/search')) {
        // 复刻真实行为：带空格的关键词只命中标题里也带空格的那一条，剩下 2 条只能靠合集补搜
        const kw = q.get('keyword') || '';
        const vlist = kw === '从零开始的 AI 学习'
          ? [{ bvid: 'BVcol1', title: col[0].title, pic: '', length: '01:40', author: 'UP', mid, play: 30, video_review: 0, created: 1700000300 }]
          : [];
        return { code: 0, data: { page: { count: vlist.length }, list: { vlist } } };
      }
    };
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('https://space.bilibili.com/2');
    await page.locator('#margin-root .tab[data-tab="video"]').waitFor();
    const input = page.locator('#margin-root .sp-q-in');
    await input.fill('从零开始的 AI 学习');
    await input.press('Enter');
    const hit = page.locator('#margin-root .sp-search-hit');
    await hit.waitFor({ timeout: 4000 });
    assert.match(await hit.textContent(), /从零开始的 AI 学习/);
    await page.waitForFunction(() => document.getElementById('margin-root').shadowRoot.querySelectorAll('.main > :is(.grid,.vlist) > .card').length === 3);
    assert.equal(await page.locator('#margin-root .main > .status').textContent(), '共 3 个视频（含合集）');
    // 入口进合集：搜索框保留，用来在合集内筛选
    await hit.click();
    await page.locator('#margin-root .sp-collection-head h2').waitFor();
    assert.equal(await page.locator('#margin-root .sp-q:visible').count(), 1);
    assert.match(await page.locator('#margin-root .sp-q-in').getAttribute('placeholder'), /合集/);
    await page.waitForFunction(() => document.getElementById('margin-root').shadowRoot.querySelectorAll('.main > :is(.grid,.vlist) > .card').length === 3);
    await input.fill('提示词');
    await input.press('Enter');
    await page.waitForFunction(() => document.getElementById('margin-root').shadowRoot.querySelectorAll('.main > :is(.grid,.vlist) > .card').length === 1);
    assert.equal(await page.locator('#margin-root .main > .status').textContent(), '共 1 个视频');
    await input.fill('');
    await input.press('Enter');
    await page.waitForFunction(() => document.getElementById('margin-root').shadowRoot.querySelectorAll('.main > :is(.grid,.vlist) > .card').length === 3);
  });
  await check('113-space-search-later-pages', async () => {
    override = raw => {
      const u = new URL(raw), path = u.pathname;
      if (path.endsWith('/seasons_series_list')) return { code: 0, data: { items_lists: { page: { total: 1 }, seasons_list: [{ meta: { season_id: 9, name: '课程合集', total: 120 } }], series_list: [] } } };
      if (path.endsWith('/seasons_archives_list')) {
        const page = Number(u.searchParams.get('page_num'));
        return { code: 0, data: { page: { total: 120 }, archives: Array.from({ length: 30 }, (_, i) => ({ bvid: `BVpage${page}item${i}`, title: page === 4 && i === 29 ? '目标视频' : '其他内容', duration: 120, stat: { view: 10 } })) } };
      }
      if (path.endsWith('/arc/search')) return { code: 0, data: { page: { count: 1 }, list: { vlist: [{ bvid: 'BVdirect', title: '目标投稿', pic: '', length: '02:00', mid: 2, created: 10 }] } } };
    };
    await page.goto('https://space.bilibili.com/2');
    const input = page.locator('#margin-root .sp-q-in');
    await input.fill('目标'); await input.press('Enter');
    const more = page.locator('#margin-root .sp-search-more');
    await more.waitFor();
    for (let i = 0; i < 3; i++) {
      await more.click();
      await page.locator('#margin-root .main > :is(.grid,.vlist) > .sk').waitFor({ state: 'detached' });
      if (i < 2) await more.waitFor();
    }
    await more.waitFor({ state: 'detached' });
    assert.equal(await page.locator('#margin-root .main > :is(.grid,.vlist) > .card').count(), 2);
    assert.match(await page.locator('#margin-root .main > .status').textContent(), /共 2 个视频/);
    assert.ok(await page.locator('#margin-root .main').getByText('目标视频', { exact: true }).count());
  });
  assert.deepEqual(errors, []);
} finally {
  writeFileSync(join(out, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  await ctx.close();
}
if (!baseline && results.some(r => !r.ok)) process.exitCode = 1;
