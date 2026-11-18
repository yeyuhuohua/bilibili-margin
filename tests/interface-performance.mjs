import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installMocks, apiBody } from './mocks.mjs';

const ext = resolve(process.env.SMOKE_EXT || 'dist');
const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/interface-performance');
const rate = Number(process.env.PERF_CPU || 6);
mkdirSync(out, { recursive: true });
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-interface-')), {
  channel: 'chromium', headless: true, viewport: { width: 1440, height: 1000 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const results = [], errors = [];
const baseline = process.env.PERF_BASELINE === '1';
try {
  await installMocks(context, url => {
    if (!url.includes('/feed/rcmd') && !url.includes('/x/web-interface/popular')) return null;
    const response = apiBody(url), popular = url.includes('/popular');
    const samples = popular ? response.data.list : response.data.item;
    const videos = Array.from({ length: 120 }, (_, i) => ({
      ...samples[i % samples.length], bvid: `BV${String((popular ? 200 : 0) + i).padStart(10, '0')}`,
      is_ad: false,
    }));
    if (popular) response.data.list = videos;
    else response.data.item = videos;
    return response;
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': {
    intro: false, weather: false, footprint: false, bg: { mode: 'off' }, theme: 'dark',
  } }));
  const page = context.pages()[0];
  page.on('pageerror', error => errors.push(error.message));
  const cdp = await context.newCDPSession(page), worlds = new Map();
  const origin = worker.url().split('/').slice(0, 3).join('/');
  let instrumentStartup;
  cdp.on('Runtime.executionContextCreated', ({ context }) => {
    worlds.set(context.id, context);
    if (context.origin !== origin) return;
    instrumentStartup = cdp.send('Runtime.evaluate', { contextId: context.id, expression: `(() => {
      globalThis.startupHeatmapNodes = 0; globalThis.interfaceCardsCreated = 0;
      const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'className');
      Object.defineProperty(Element.prototype, 'className', { ...descriptor, set(value) {
        if (typeof value === 'string' && value.startsWith('fp-')) startupHeatmapNodes++;
        if (typeof value === 'string' && /^card(?: |$)/.test(value) && !value.split(' ').includes('sk')) interfaceCardsCreated++;
        descriptor.set.call(this, value);
      } });
    })()` });
  });
  cdp.on('Runtime.executionContextsCleared', () => worlds.clear());
  await cdp.send('Runtime.enable');
  await cdp.send('Performance.enable');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  const evaluate = async expression => {
    const world = [...worlds.values()].find(world => world.origin === origin);
    assert(world);
    const result = await cdp.send('Runtime.evaluate', { contextId: world.id, expression, returnByValue: true, awaitPromise: true });
    assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  const measure = async (name, selector) => {
    if (process.env.PERF_TRACE && name === 'settings-open-1') {
      await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline', transferMode: 'ReturnAsStream' });
    }
    const before = await metrics();
    const event = await evaluate(`new Promise(resolve => {
      interfaceCreated = 0; interfaceMutations = 0; interfaceCardsCreated = 0;
      const start = performance.now();
      const button = document.getElementById('margin-root').shadowRoot.querySelector(${JSON.stringify(selector)});
      button.click();
      const handlerMs = performance.now() - start;
      requestAnimationFrame(() => requestAnimationFrame(() => resolve({ handlerMs, frameMs: performance.now() - start, created: interfaceCreated, cardsCreated: interfaceCardsCreated, mutations: interfaceMutations })));
    })`);
    const after = await metrics();
    const result = { name, ...event, metrics: Object.fromEntries(['TaskDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount'].map(key => [key, after[key] - before[key]])) };
    results.push(result); console.log(JSON.stringify(result));
    if (process.env.PERF_TRACE && name === 'settings-open-1') {
      const completed = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
      await cdp.send('Tracing.end');
      const { stream } = await completed;
      let data = '', chunk;
      do { chunk = await cdp.send('IO.read', { handle: stream }); data += chunk.data; } while (!chunk.eof);
      await cdp.send('IO.close', { handle: stream });
      writeFileSync(join(out, 'settings-trace.json'), data);
    }
    await page.waitForTimeout(650);
    return result;
  };
  await page.goto('https://www.bilibili.com/', { waitUntil: 'domcontentloaded' });
  await page.locator('#margin-root main .grid .card:not(.sk)').nth(119).waitFor({ state: 'attached' });
  await page.waitForTimeout(1500);
  await instrumentStartup;
  const heatmapNodes = await evaluate('startupHeatmapNodes');
  results.push({ name: 'disabled-heatmap-startup', created: heatmapNodes });
  if (!baseline) assert.equal(heatmapNodes, 0, 'disabled heatmap was built during startup');
  await evaluate(`(() => {
    globalThis.interfaceCreated = 0; globalThis.interfaceMutations = 0;
    const create = Document.prototype.createElement;
    Document.prototype.createElement = function(...args) { interfaceCreated++; return create.apply(this, args); };
    new MutationObserver(records => { interfaceMutations += records.length; }).observe(document.getElementById('margin-root').shadowRoot, { subtree: true, childList: true, attributes: true });
  })()`);
  for (let i = 0; i < 3; i++) {
    await measure(`settings-open-${i}`, '.top [aria-label="设置"]');
    await measure(`settings-appearance-${i}`, '#stg-tab-appearance');
    await measure(`settings-home-${i}`, '#stg-tab-home');
    await measure(`settings-overview-${i}`, '#stg-tab-overview');
    await measure(`settings-close-${i}`, '.stg .sheet-x');
  }
  await measure('popular-first', '.tab[data-tab="popular"]');
  await page.locator('#margin-root main .grid .card .cover').first().waitFor();
  for (let i = 0; i < 3; i++) {
    const recommend = await measure(`recommend-return-${i}`, '.tab[data-tab="rcmd"]');
    const popular = await measure(`popular-return-${i}`, '.tab[data-tab="popular"]');
    if (!baseline) {
      assert.equal(recommend.cardsCreated, 0, 'returning to recommendations rebuilt cached cards');
      assert.equal(popular.cardsCreated, 0, 'returning to popular rebuilt cached cards');
    }
  }
  await page.evaluate(() => { document.cookie = 'bili_jct=fixture;path=/'; });
  const firstCard = page.locator('#margin-root main .grid .card').first();
  await firstCard.locator('.card-later').evaluate(button => button.click());
  await firstCard.locator('.card-later[data-state="ok"]').waitFor({ state: 'attached' });
  await page.locator('#margin-root .tab[data-tab="rcmd"]').click();
  await page.locator('#margin-root .tab[data-tab="popular"]').click();
  await page.waitForFunction(() => !document.getElementById('margin-root').shadowRoot.querySelector('main .grid .card-later[data-state="ok"]'));
  results.push({ name: 'completed watch-later actions refresh on returning to a cached tab', passed: true });
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await page.locator('#margin-root .top [aria-label="设置"]').click();
  const search = settings.getByRole('searchbox', { name: '搜索设置' });
  await search.fill('播放器圆角');
  await settings.getByRole('switch', { name: '播放器圆角' }).waitFor();
  await search.fill('');
  await settings.getByRole('tab', { name: '总览', exact: true }).click();
  await page.keyboard.press('Tab');
  assert(await settings.evaluate(el => el.contains(el.getRootNode().activeElement)), 'focus escaped settings');
  await settings.getByRole('button', { name: '关闭', exact: true }).click();
  const update = async patch => worker.evaluate(async patch => {
    const data = await chrome.storage.local.get('margin:settings');
    await chrome.storage.local.set({ 'margin:settings': { ...data['margin:settings'], ...patch } });
  }, patch);
  await update({ homeHide: ['danmaku'], footprint: true });
  await page.locator('#margin-root .fp-card').waitFor();
  await page.waitForFunction(() => !document.getElementById('margin-root').shadowRoot.querySelector('main .grid [aria-label$="弹幕"]'));
  await page.locator('#margin-root .tab[data-tab="rcmd"]').click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#margin-root main .grid [aria-label$="弹幕"]').count(), 0, 'cached tab ignored card display settings');
  await page.locator('#margin-root .top [aria-label="设置"]').click();
  await settings.getByRole('tab', { name: '首页', exact: true }).click();
  assert.equal(await settings.getByRole('switch', { name: '足迹热力图', exact: true }).getAttribute('aria-checked'), 'true');
  await settings.getByRole('button', { name: '关闭', exact: true }).click();
  await update({ homeHide: [], footprint: false });
  await page.locator('#margin-root .fp-card').waitFor({ state: 'detached' });
  await page.locator('#margin-root main .grid [aria-label$="弹幕"]').first().waitFor();
  results.push({ name: 'search, focus, hidden settings synchronization, lazy heatmap and cached card invalidation', passed: true });
  await measure('favorites-first', '.top [aria-label="收藏"]');
  await page.getByRole('dialog', { name: '收藏夹', exact: true }).waitFor();
  await page.screenshot({ path: join(out, 'favorites.png') });
  assert.deepEqual(errors, []);
} finally {
  writeFileSync(join(out, 'report.json'), JSON.stringify({ ext, rate, scope: 'CPU-throttled Chromium with 120 fixture cards, backgrounds disabled to isolate UI CPU/layout work. Timings exclude external network latency.', results, errors }, null, 2));
  await context.close();
}
