import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installMocks, apiBody } from './mocks.mjs';

const ext = resolve(process.env.SMOKE_EXT || 'dist');
const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/home-workload');
mkdirSync(out, { recursive: true });
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-workload-')), {
  channel: 'chromium', headless: true, viewport: { width: 1440, height: 1000 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
let calls = 0, fresh = false;
const results = [], errors = [];
const baseline = process.env.PERF_BASELINE === '1';
try {
  await installMocks(context, url => {
    if (!url.includes('/feed/rcmd')) return null;
    calls++;
    const response = apiBody(url);
    response.data.item = response.data.item.slice(0, 6).map((video, index) => ({
      ...video, bvid: `BV${String((fresh ? calls : 0) * 100 + index).padStart(10, '0')}`,
    }));
    return response;
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': {
    intro: false, weather: false, footprint: false, bg: { mode: 'off' }, reduceMotion: true,
  } }));
  const page = context.pages()[0];
  page.on('pageerror', error => errors.push(error.message));
  const cdp = await context.newCDPSession(page), worlds = new Map();
  cdp.on('Runtime.executionContextCreated', ({ context }) => worlds.set(context.id, context));
  cdp.on('Runtime.executionContextsCleared', () => worlds.clear());
  await cdp.send('Runtime.enable');
  const origin = worker.url().split('/').slice(0, 3).join('/');
  const evaluate = async expression => {
    const world = [...worlds.values()].find(world => world.origin === origin);
    assert(world);
    const result = await cdp.send('Runtime.evaluate', { contextId: world.id, expression, returnByValue: true });
    assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const measure = async name => {
    const before = calls;
    await evaluate('workloadSkeletons = 0');
    await page.waitForTimeout(4800);
    const result = { name, requests: calls - before, skeletons: await evaluate('workloadSkeletons') };
    results.push(result); console.log(JSON.stringify(result));
    return result;
  };
  await page.goto('https://www.bilibili.com/');
  const cards = page.locator('#margin-root main .grid .card:not(.sk)');
  await cards.first().waitFor();
  await evaluate(`(() => {
    globalThis.workloadSkeletons = 0;
    const grid = document.getElementById('margin-root').shadowRoot.querySelector('main .grid');
    new MutationObserver(entries => {
      for (const entry of entries) for (const node of entry.addedNodes) {
        if (node instanceof Element && node.matches('.card.sk')) workloadSkeletons++;
      }
    }).observe(grid, { childList: true });
    globalThis.workloadHidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => workloadHidden });
  })()`);
  const repeated = await measure('repeated recommendations');
  if (!baseline) assert(repeated.requests <= 10 && repeated.skeletons <= 20);

  await page.evaluate(() => dispatchEvent(new Event('margin:open-fav')));
  const dialog = page.getByRole('dialog', { name: '收藏夹', exact: true });
  await dialog.waitFor();
  await page.waitForTimeout(500);
  const covered = await measure('favorites open');
  if (!baseline) assert.equal(covered.requests, 0);
  if (!baseline) assert.equal(covered.skeletons, 0);
  const beforeClose = await cards.count();
  fresh = true;
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.waitForFunction(count => document.getElementById('margin-root').shadowRoot.querySelectorAll('main .grid .card:not(.sk)').length > count, beforeClose, { timeout: 6000 });
  results.push({ name: 'closing favorites resumes recommendations', passed: true });

  fresh = false;
  await page.locator('#margin-root .app').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await evaluate('workloadHidden = true; document.dispatchEvent(new Event("visibilitychange"))');
  await page.waitForTimeout(500);
  const hidden = await measure('hidden document');
  if (!baseline) assert.equal(hidden.requests, 0);
  if (!baseline) assert.equal(hidden.skeletons, 0);
  const beforeReturn = await cards.count();
  fresh = true;
  await evaluate('workloadHidden = false; document.dispatchEvent(new Event("visibilitychange"))');
  await page.waitForFunction(count => document.getElementById('margin-root').shadowRoot.querySelectorAll('main .grid .card:not(.sk)').length > count, beforeReturn, { timeout: 6000 });
  results.push({ name: 'returning to the document resumes recommendations', passed: true });
  await page.screenshot({ path: join(out, 'resumed.png') });
  assert.deepEqual(errors, []);
} finally {
  writeFileSync(join(out, 'report.json'), JSON.stringify({ results, errors, scope: 'Built extension with duplicate fixtures and simulated document visibility in its isolated world.' }, null, 2));
  await context.close();
}
