// Exercise thumbnail scheduling without compiling shaders on the test machine's GPU.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installMocks } from './mocks.mjs';

const ext = resolve(process.env.SMOKE_EXT || 'dist');
const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/settings-thumbnails');
mkdirSync(out, { recursive: true });
const results = [], errors = [];
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-thumbnails-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, viewport: { width: 1440, height: 1000 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
try {
  await installMocks(context);
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': {
    intro: false, theme: 'light', weather: false, footprint: false, bg: { mode: 'off' },
  } }));
  for (const mode of ['scroll-away-before-start', 'scroll-away-during-render', 'close-before-start']) {
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const cdp = await context.newCDPSession(page), worlds = [];
    cdp.on('Runtime.executionContextCreated', ({ context }) => worlds.push(context));
    await cdp.send('Runtime.enable');
    const result = { mode, ok: false };
    results.push(result);
    try {
      await page.goto('https://www.bilibili.com/', { waitUntil: 'domcontentloaded' });
      await page.locator('#margin-root .top').waitFor();
      const world = worlds.find(w => w.origin === worker.url().split('/').slice(0, 3).join('/'));
      assert(world, 'extension isolated world missing');
      const evaluate = async expression => {
        const response = await cdp.send('Runtime.evaluate', { contextId: world.id, expression, returnByValue: true });
        assert(!response.exceptionDetails, JSON.stringify(response.exceptionDetails));
        return response.result.value;
      };
      await evaluate(`(() => {
        window.thumbProbe = { calls: 0, hiddenAt: 0, visible: false, hideOnFirst: ${mode === 'scroll-away-during-render'} };
        const Observer = IntersectionObserver;
        window.IntersectionObserver = class extends Observer {
          constructor(callback, options) {
            super((entries, observer) => {
              callback(entries, observer);
              const swatches = entries.find(entry => entry.target.matches('.swatches'));
              if (swatches) {
                thumbProbe.visible = swatches.isIntersecting;
                if (!swatches.isIntersecting) thumbProbe.hiddenAt = thumbProbe.calls;
              }
            }, options);
          }
        };
        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(type, ...args) {
          if (type === 'webgl' && this.width === 160 && this.height === 120) {
            thumbProbe.calls++;
            if (thumbProbe.hideOnFirst && thumbProbe.calls === 1) {
              document.querySelector('#margin-root').shadowRoot.querySelector('.sheet[aria-label="设置"] .sheet-body').scrollTo({ top: 0, behavior: 'instant' });
            }
            return null;
          }
          return getContext.call(this, type, ...args);
        };
      })()`);
      await page.locator('#margin-root .top [aria-label="设置"]').click();
      await page.waitForTimeout(500);
      assert.equal(await evaluate('thumbProbe.calls'), 0, 'offscreen thumbnails started on panel opening');
      await page.locator('#margin-root .sheet[aria-label="设置"]').getByRole('tab', { name: '外观', exact: true }).click();
      await page.waitForTimeout(100);
      const swatches = page.locator('#margin-root .swatches');
      const showSwatches = () => swatches.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
      await showSwatches();
      await page.waitForTimeout(100);
      if (mode === 'scroll-away-before-start') {
        await page.locator('#margin-root .sheet[aria-label="设置"] .sheet-body').evaluate(el => el.scrollTo({ top: 0, behavior: 'instant' }));
      } else if (mode === 'close-before-start') await page.keyboard.press('Escape');
      await page.waitForTimeout(900);
      result.hiddenCalls = await evaluate('thumbProbe.calls');
      if (mode === 'close-before-start') assert.equal(await page.locator('#margin-root .stg-layer').getAttribute('data-open'), 'false');
      else assert.equal(await evaluate('thumbProbe.visible'), false);
      // Use the actual visibility notification, whose delivery can span multiple frames.
      result.callsAtHidden = await evaluate('thumbProbe.hiddenAt');
      assert.equal(result.hiddenCalls, result.callsAtHidden, 'thumbnail work continued after the hidden notification');
      if (mode === 'scroll-away-during-render') assert(result.hiddenCalls >= 1, 'thumbnail rendering did not start');
      else assert.equal(result.hiddenCalls, 0, 'hidden thumbnail work started');
      await page.waitForTimeout(500);
      assert.equal(await evaluate('thumbProbe.calls'), result.hiddenCalls, 'hidden thumbnail work did not stop');
      if (mode === 'close-before-start') await page.locator('#margin-root .top [aria-label="设置"]').click();
      await showSwatches();
      await page.waitForFunction(() => document.getElementById('margin-root').shadowRoot.querySelector('.swatches').dataset.thumbs === 'light', undefined, { polling: 50, timeout: 5000 });
      result.visibleCalls = await evaluate('thumbProbe.calls');
      assert(result.visibleCalls > result.hiddenCalls, 'visible thumbnails did not resume');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      await page.locator('#margin-root .top [aria-label="设置"]').click();
      await showSwatches();
      await page.waitForTimeout(800);
      assert.equal(await evaluate('thumbProbe.calls'), result.visibleCalls, 'completed thumbnails were rendered again');
      result.ok = true;
      console.log(`PASS thumbnails ${mode}`);
    } catch (error) { result.error = error.message; console.log(`FAIL thumbnails ${mode}: ${error.message}`); }
    finally { await page.close(); }
  }
} finally {
  writeFileSync(join(out, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  await context.close();
}
if (results.some(result => !result.ok) || errors.length) process.exitCode = 1;
