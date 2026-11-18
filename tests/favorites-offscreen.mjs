import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installMocks } from './mocks.mjs';

const extension = resolve(process.env.SMOKE_EXT || 'dist');
const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/favorites-offscreen');
mkdirSync(out, { recursive: true });
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-fav-offscreen-')), {
  channel: 'chromium', headless: true, viewport: { width: 1440, height: 1000 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
const results = [], errors = [];
try {
  await installMocks(context, address => {
    if (address.includes('/fav/folder/created/list')) return { code: 0, data: { list: Array.from({ length: 50 }, (_, i) => ({
      id: 60000 + i, title: `收藏 ${i}`, media_count: 0, attr: 2, cover: '',
    })) } };
    if (address.includes('/fav/resource/list')) return { code: 0, data: { medias: [], has_more: false } };
    return null;
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page = context.pages()[0];
  page.on('pageerror', error => errors.push(error.message));
  const cdp = await context.newCDPSession(page), worlds = new Map();
  cdp.on('Runtime.executionContextCreated', ({ context }) => worlds.set(context.id, context));
  cdp.on('Runtime.executionContextsCleared', () => worlds.clear());
  await cdp.send('Runtime.enable');
  await cdp.send('Performance.enable');
  const origin = worker.url().split('/').slice(0, 3).join('/');
  const evaluate = async expression => {
    const world = [...worlds.values()].find(world => world.origin === origin);
    assert(world);
    const result = await cdp.send('Runtime.evaluate', { contextId: world.id, expression, returnByValue: true });
    assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(item => [item.name, item.value]));
  for (const reduceMotion of [false, true]) {
    await worker.evaluate(reduceMotion => chrome.storage.local.set({ 'margin:settings': {
      intro: false, theme: 'dark', bg: { mode: 'off' }, weather: false, footprint: false, reduceMotion,
    } }), reduceMotion);
    await page.goto('https://www.bilibili.com/');
    await page.locator('#margin-root .top').waitFor();
    await evaluate(`(() => {
      window.folderCounts = { allocations: 0, bytes: 0, frostRebuilds: 0 };
      const Bytes = Uint8ClampedArray;
      globalThis.Uint8ClampedArray = new Proxy(Bytes, { construct(target, args) {
        if (typeof args[0] === 'number' && args[0] > 10000) { folderCounts.allocations++; folderCounts.bytes += args[0]; }
        return Reflect.construct(target, args);
      } });
      const replace = Element.prototype.replaceChildren;
      Element.prototype.replaceChildren = function(...nodes) {
        if (this.classList.contains('gf-frost')) folderCounts.frostRebuilds++;
        return replace.apply(this, nodes);
      };
    })()`);
    const before = await metrics();
    await page.evaluate(() => dispatchEvent(new Event('margin:open-fav')));
    const dialog = page.getByRole('dialog', { name: '收藏夹', exact: true });
    await dialog.locator('.gf-root').nth(49).waitFor();
    await page.waitForTimeout(1600);
    const after = await metrics();
    const counts = await evaluate('folderCounts');
    results.push({ reduceMotion, ...counts, taskMs: (after.TaskDuration - before.TaskDuration) * 1000,
      layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000 });
    if (process.env.PERF_BASELINE !== '1') {
      assert(counts.allocations <= 15, `offscreen folders allocated ${counts.allocations} generated textures`);
      assert(counts.frostRebuilds <= 30, 'offscreen folders rebuilt blurred copies');
    }
    await dialog.locator('.gf-root').nth(49).scrollIntoViewIfNeeded();
    await dialog.locator('.gf-root').nth(49).locator('.gf-back canvas.gf-art[data-ready]').first().waitFor();
    await page.screenshot({ path: join(out, `scrolled-${reduceMotion}.png`) });
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(results));
} finally {
  writeFileSync(join(out, 'report.json'), JSON.stringify({ results, errors, scope: 'Isolated Chromium with 50 empty-cover folders; CPU work and allocations, not physical GPU FPS.' }, null, 2));
  await context.close();
}
