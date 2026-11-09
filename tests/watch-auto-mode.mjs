import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { installMocks } from './mocks.mjs';

const extension = resolve(process.env.SMOKE_EXT || 'dist');
const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/watch-auto-mode');
mkdirSync(out, { recursive: true });
const results = [], errors = [];
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-auto-mode-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true,
  args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  viewport: { width: 1440, height: 900 }, locale: 'zh-CN',
});
try {
  await installMocks(context);
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': {
    intro: false, autoWeb: true, wide: true, webScroll: false, bg: { mode: 'off' },
  } }));
  for (const initial of ['normal', 'wide', 'mini', 'web', 'full']) {
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const result = { initial, ok: false };
    results.push(result);
    try {
      await page.addInitScript(initial => {
        document.addEventListener('DOMContentLoaded', () => {
          const player = document.querySelector('.bpx-player-container');
          const video = player.querySelector('video');
          window.autoModeProbe = { player, video, clicks: [] };
          player.dataset.screen = initial;
          // Actual metadata must be ready in the extension's isolated world too.
          const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
          const paint = canvas.getContext('2d');
          video.srcObject = canvas.captureStream(4);
          video.play();
          window.setInterval(() => { paint.fillStyle = '#222'; paint.fillRect(0, 0, 640, 360); }, 200);
          document.addEventListener('click', event => {
            const button = event.target.closest?.('.bpx-player-ctrl-wide, .bpx-player-ctrl-web');
            if (button) window.autoModeProbe.clicks.push(button.className);
          }, true);
        }, { once: true });
      }, initial);
      await page.goto('https://www.bilibili.com/video/BV1mdxN68E7F/', { waitUntil: 'domcontentloaded' });
      await page.locator('#margin-watch-top .top').waitFor({ state: 'attached' });
      await page.waitForFunction(() => document.querySelector('video').readyState >= 1);
      await page.waitForTimeout(1100);
      const state = () => page.evaluate(() => ({
        screen: document.querySelector('.bpx-player-container').dataset.screen,
        clicks: [...window.autoModeProbe.clicks],
        player: window.autoModeProbe.player === document.querySelector('.bpx-player-container'),
        video: window.autoModeProbe.video === document.querySelector('video'),
        source: !!document.querySelector('video').srcObject,
      }));
      result.automatic = await state();
      const shouldEnterWeb = initial === 'normal' || initial === 'wide';
      assert.equal(result.automatic.screen, shouldEnterWeb ? 'web' : initial);
      assert.deepEqual(result.automatic.clicks, shouldEnterWeb ? ['bpx-player-ctrl-web'] : []);
      assert(result.automatic.player && result.automatic.video && result.automatic.source, 'native media was replaced');
      // A user leaving the automatic mode must retain control for this video.
      for (const manual of ['normal', 'wide']) {
        await page.locator('.bpx-player-container').evaluate((player, mode) => { player.dataset.screen = mode; }, manual);
        await page.waitForTimeout(1000);
        const current = await state();
        result[`manual${manual}`] = current;
        assert.equal(current.screen, manual, 'automatic mode was reapplied after manual exit');
        assert.deepEqual(current.clicks, result.automatic.clicks);
        assert(current.player && current.video && current.source, 'native media changed during manual mode switch');
      }
      result.ok = true;
      console.log(`PASS auto-web from ${initial}`);
    } catch (error) {
      result.error = error.message;
      console.log(`FAIL auto-web from ${initial}: ${error.message}`);
    } finally {
      await page.screenshot({ path: join(out, `from-${initial}.png`) });
      await page.close();
    }
  }
} finally {
  writeFileSync(join(out, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  await context.close();
}
if (results.some(result => !result.ok) || errors.length) process.exitCode = 1;
