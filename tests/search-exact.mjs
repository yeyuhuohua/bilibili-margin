import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { installMocks } from './mocks.mjs';

const out = resolve(process.env.SMOKE_OUT || 'delivery/search-tests');
mkdirSync(out, { recursive: true });
const ext = resolve(process.env.SMOKE_EXT || 'dist');
const target = 'JavaScript 闭包是什么？使用闭包的原因｜JS 教程';
const ids = ['BV1CoxY6YE4y', 'BV1111111111', 'BV1kuxM6bE2A'];
const card = (id, title) => `<div class="video-list-item col_3"><div class="bili-video-card"><a href="https://www.bilibili.com/video/${id}/"><div class="bili-video-card__image"><img src="https://i0.hdslb.com/bfs/archive/${id}.jpg"></div><h3 class="bili-video-card__info--tit">${title}</h3></a><a href="https://space.bilibili.com/2"><span class="bili-video-card__info--author">测试作者</span></a><span class="bili-video-card__stats__duration">10:00</span><span class="bili-video-card__stats--item">1.2万</span><button class="original-action">原生操作</button></div></div>`;
const fixture = () => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>.search-page-video{max-width:1300px;margin:auto}.video-list{display:flex}.video-list-item{width:30%}img{width:100%}</style></head><body><div id="app"><div class="search-content"><div class="search-conditions"><button id="native-latest">最新发布</button></div><div class="search-page-video"><div class="video-list">${card(ids[0], '其他教程与介绍')}${card(ids[1], 'JavaScript 闭包部分匹配')}${card(ids[2], target)}</div><div class="vui_pagenation"><button id="native-next">下一页</button></div></div></div></div><script>window.nativeClicks=0;document.querySelectorAll('.original-action').forEach(el=>el.addEventListener('click',()=>window.nativeClicks++));window.originalList=document.querySelector('.video-list');window.originalCards=[...window.originalList.children];</script></body></html>`;
const errors = [], results = [];
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-search-exact-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  viewport: { width: 1440, height: 1000 }, locale: 'zh-CN',
});
const check = (name, value) => { assert.ok(value, name); results.push(name); };
const viewIds = page => page.locator('#margin-search-exact-results > li').evaluateAll(nodes => nodes.map(n => n.dataset.bvid));
try {
  await installMocks(context);
  await context.route('https://search.bilibili.com/**', async route => {
    if (route.request().url().endsWith('/parser-delay.js')) {
      await new Promise(resolve => setTimeout(resolve, 1200));
      return route.fulfill({ contentType: 'text/javascript', body: '' });
    }
    const body = route.request().url().includes('cold=1')
      ? fixture().replace('</head>', '<script src="/parser-delay.js"></script></head>') : fixture();
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body });
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': { intro: false, wide: false, autoWeb: false, bg: { mode: 'off' }, theme: 'light' } }));
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && message.text().includes('[MARGIN] 搜索试用加载失败')) errors.push(message.text()); });
  const searchRequests = [];
  page.on('request', request => { if (/\/x\/web-interface\/(?:wbi\/)?search\/(?:type|all)/.test(request.url())) searchRequests.push(request.url()); });
  const url = 'https://search.bilibili.com/video?keyword=' + encodeURIComponent(target);
  await page.goto(url + '&cold=1', { waitUntil: 'domcontentloaded' });
  await page.locator('#margin-search-exact').waitFor({ timeout: 5000 });
  results.push('parser-blocked cold start mounts after body becomes available');
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('#margin-search-exact').waitFor();
  const toggle = page.locator('#margin-search-exact input');
  check('default off on a loaded extension', !await toggle.isChecked());
  check('no view and native visible while off', await page.locator('#margin-search-exact-results').isHidden() && await page.locator('.video-list').isVisible());
  await toggle.check();
  assert.deepEqual(await viewIds(page), [ids[2], ids[0], ids[1]]); results.push('exact target moves before native nonmatches');
  check('framework-owned list and nodes are unchanged', await page.evaluate(() => window.originalList === document.querySelector('.video-list') && window.originalCards.every((n,i) => n === window.originalList.children[i])));
  check('native list is inert and hidden only while view is active', await page.locator('.video-list').evaluate(el => el.inert && el.getAttribute('aria-hidden') === 'true' && getComputedStyle(el).display === 'none'));
  check('native pagination remains visible', await page.locator('#native-next').isVisible());
  check('authors are visible in enhanced view', await page.locator('#margin-search-exact-results .mx-author').first().innerText() === '测试作者');
  check('enhanced list has no nonfunctional native-action buttons', await page.locator('#margin-search-exact-results button').count() === 0);
  await page.locator('#margin-search-exact button').filter({ hasText: '恢复原版' }).click();
  check('restore returns original inert/aria state', await page.locator('.video-list').evaluate(el => !el.inert && !el.hasAttribute('aria-hidden') && !el.hasAttribute('data-margin-search-source')));
  check('restore retains keyboard focus on switch', await toggle.evaluate(el => document.activeElement === el));
  await page.locator('.original-action').first().click();
  check('original card listeners survive restoration', await page.evaluate(() => window.nativeClicks === 1));

  await toggle.check();
  await page.evaluate(() => { window.visibleCards = [...document.querySelector('#margin-search-exact-results').children]; document.querySelector('.bili-video-card').append(document.createElement('span')); });
  await page.mouse.move(250, 320); await page.waitForTimeout(250);
  check('irrelevant hover content never rebuilds projection', await page.evaluate(() => window.visibleCards.every((n,i) => n === document.querySelector('#margin-search-exact-results').children[i])));
  await page.evaluate(html => document.querySelector('.video-list').insertAdjacentHTML('beforeend', html), card('BV2222222222', '新增候选视频'));
  await page.locator('#margin-search-exact button').filter({ hasText: '更新排序' }).waitFor();
  check('late candidates do not silently reorder current view', (await viewIds(page)).length === 3);
  await page.locator('#margin-search-exact button').filter({ hasText: '更新排序' }).click();
  check('explicit update includes new candidate', (await viewIds(page)).length === 4);
  await page.evaluate(() => document.querySelectorAll('.bili-video-card')[2].setAttribute('data-margin-filtered', 'native'));
  await page.waitForTimeout(200);
  check('newly filtered target never remains visible', await page.locator('#margin-search-exact-results').isHidden());
  await page.locator('#margin-search-exact button').filter({ hasText: '更新排序' }).click();
  check('filtered target is not reintroduced', await page.locator('#margin-search-exact-results').isHidden());
  await page.evaluate(() => document.querySelectorAll('.bili-video-card')[2].removeAttribute('data-margin-filtered'));
  await page.waitForTimeout(200);
  check('removing a filter can activate an exact target', await page.locator('#margin-search-exact-results').isVisible());

  await page.evaluate(() => { history.pushState({}, '', location.href + '&order=pubdate'); dispatchEvent(new PopStateEvent('popstate')); });
  await page.waitForTimeout(200);
  check('native latest order pauses enhancement', await page.locator('#margin-search-exact-results').isHidden() && await toggle.isChecked());
  await page.evaluate(() => { history.pushState({}, '', location.pathname + '?keyword=JavaScript'); dispatchEvent(new PopStateEvent('popstate')); });
  await page.waitForTimeout(200);
  check('new ambiguous query cannot display stale enhanced results', await page.locator('#margin-search-exact-results').isHidden());
  await page.evaluate(query => { history.pushState({}, '', location.pathname + '?keyword=' + encodeURIComponent(query)); dispatchEvent(new PopStateEvent('popstate')); }, target);
  await page.waitForTimeout(200);
  check('exact query reactivation works without navigation reload', await page.locator('#margin-search-exact-results').isVisible());
  await page.evaluate(() => { const old = document.querySelector('.search-content'); const next = old.cloneNode(true); next.querySelector('#margin-search-exact')?.remove(); next.querySelector('#margin-search-exact-results')?.remove(); const list = next.querySelector('.video-list'); list.removeAttribute('data-margin-search-source'); list.removeAttribute('inert'); list.removeAttribute('aria-hidden'); old.replaceWith(next); });
  await page.waitForTimeout(250);
  check('entire native search subtree replacement is rediscovered', await page.locator('#margin-search-exact-results').isVisible() && await page.locator('#margin-search-exact').count() === 1);
  await page.screenshot({ path: join(out, 'light.png'), fullPage: true });
  await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': { intro: false, bg: { mode: 'off' }, theme: 'dark' } }));
  await page.waitForTimeout(200); await page.screenshot({ path: join(out, 'dark.png'), fullPage: true });
  check('preference saves only a boolean, not the query', (await worker.evaluate(() => chrome.storage.local.get('margin:search-exact-first')))['margin:search-exact-first'] === true);
  check('no extra video search requests', searchRequests.length === 0);
  const second = await context.newPage();
  await second.goto(url, { waitUntil: 'domcontentloaded' });
  await second.locator('#margin-search-exact-results').waitFor();
  check('explicit opt-in survives a new tab', await second.locator('#margin-search-exact input').isChecked());
  await second.close();
  await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': { enabled: false } }));
  await page.waitForTimeout(500);
  check('disabling the extension restores native search', await page.locator('#margin-search-exact').count() === 0 && await page.locator('[data-margin-search-source]').count() === 0);
  check('no uncaught extension/page errors', errors.length === 0);
} finally {
  writeFileSync(join(out, 'report.json'), JSON.stringify({ passed: results.length, results, errors, scope: 'Loaded full extension in isolated Chromium; native-shaped fixtures. Live native-page validation is recorded separately.' }, null, 2));
  await context.close();
}
console.log(JSON.stringify({ passed: results.length, errors }));
