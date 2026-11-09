import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { installMocks } from './mocks.mjs';

const extension = resolve(process.env.SMOKE_EXT || 'dist');
const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/triple-release');
mkdirSync(out, { recursive: true });
const results = [], errors = [];
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-triple-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  viewport: { width: 1440, height: 900 }, locale: 'zh-CN',
});
try {
  await installMocks(context);
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': { intro: false, theme: 'dark', bg: { mode: 'off' }, wide: false, autoWeb: false } }));
  for (const mode of ['click', 'hold-timeout', 'hold-success', 'effects-off', 'disable-hold', 'disable-wait', 'disable-burst']) {
    await worker.evaluate(async enabled => {
      const key = 'margin:settings', stored = await chrome.storage.local.get(key);
      await chrome.storage.local.set({ [key]: { ...stored[key], uiEffects: enabled } });
    }, mode !== 'effects-off');
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const result = { mode, ok: false };
    results.push(result);
    try {
      await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
        const bar = document.createElement('div'); bar.className = 'video-toolbar-left-main';
        bar.style.cssText = 'position:fixed;left:360px;top:420px;display:flex;z-index:1000';
        for (const name of ['like', 'coin', 'fav']) {
          const button = document.createElement('button'); button.className = `video-toolbar-left-item video-${name}`;
          const count = document.createElement('span'); count.className = 'video-toolbar-item-text'; count.textContent = name;
          button.append(count); bar.append(button);
        }
        document.body.append(bar);
        window.releaseProbe = [];
        for (const type of ['pointerup', 'mouseup', 'click']) bar.firstElementChild.addEventListener(type, event => {
          window.releaseProbe.push({ type, x: event.clientX, y: event.clientY, pointerId: event.pointerId, pointerType: event.pointerType, trusted: event.isTrusted });
          if (type === 'mouseup') {
            // A page handler positioning feedback at the release event must receive the original coordinates.
            const marker = document.createElement('i'); marker.id = 'release-feedback';
            marker.style.cssText = `position:fixed;left:${event.clientX}px;top:${event.clientY}px;width:12px;height:12px;background:cyan;z-index:10000`;
            document.body.append(marker);
          }
        });
      }));
      await page.goto('https://www.bilibili.com/video/BV1mdxN68E7F/');
      await page.locator('html.margin-triple').waitFor({ state: 'attached' });
      const button = page.locator('.video-like');
      const box = await button.boundingBox();
      const point = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      await page.waitForTimeout(mode === 'click' ? 40 : mode === 'disable-hold' ? 250 : 1700);
      const disable = async () => {
        await worker.evaluate(async () => {
          const key = 'margin:settings', stored = await chrome.storage.local.get(key);
          await chrome.storage.local.set({ [key]: { ...stored[key], uiEffects: false } });
        });
        await page.locator('html.margin-ui-still').waitFor({ state: 'attached' });
      };
      if (mode === 'disable-hold') await disable();
      await page.mouse.up();
      if (mode === 'disable-wait') await disable();
      if (mode === 'hold-success' || mode === 'disable-burst') await page.evaluate(() => {
        document.querySelector('.video-coin').classList.add('on');
        document.querySelector('.video-fav').classList.add('on');
      });
      await page.locator('#release-feedback').waitFor({ timeout: 3500 });
      if (mode === 'disable-burst') {
        await page.locator('.mt-tag').waitFor();
        await disable();
        await page.locator('.mt-tag,.mt-spark').first().waitFor({ state: 'detached' });
      }
      result.events = await page.evaluate(() => window.releaseProbe);
      result.point = point;
      const ups = result.events.filter(event => event.type !== 'click');
      assert.equal(ups.length, 2, 'release was lost or delivered twice');
      for (const event of ups) assert(Math.abs(event.x - point.x) <= 1 && Math.abs(event.y - point.y) <= 1, JSON.stringify({ event, point }));
      assert.equal(ups[0].pointerType, 'mouse');
      assert(ups[0].pointerId > 0, 'pointer identity was lost');
      const plainClick = ['click', 'effects-off', 'disable-hold'].includes(mode);
      assert.equal(result.events.filter(event => event.type === 'click').length, plainClick ? 1 : 0);
      if (mode === 'effects-off') assert.equal(await page.locator('.mt-ring,.mt-spark,.mt-tag').count(), 0, 'disabled controls create animation elements');
      result.ok = true;
      console.log(`PASS triple ${mode}`);
    } catch (error) {
      result.error = error.message;
      console.log(`FAIL triple ${mode}: ${error.message}`);
    } finally {
      await page.screenshot({ path: join(out, `${mode}.png`) });
      await page.close();
    }
  }
} finally {
  writeFileSync(join(out, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  await context.close();
}
if (results.some(result => !result.ok) || errors.length) process.exitCode = 1;
