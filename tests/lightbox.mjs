import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { installMocks } from './mocks.mjs';

const ext = resolve(process.env.SMOKE_EXT || 'dist');
const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/lightbox');
mkdirSync(out, { recursive: true });
const results = [], errors = [];
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-lightbox-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  viewport: { width: 1280, height: 800 }, locale: 'zh-CN',
});
try {
  await installMocks(context);
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': { intro: false, theme: 'dark', bg: { mode: 'off' } } }));
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://t.bilibili.com/', { waitUntil: 'domcontentloaded' });
  const picture = page.locator('#margin-root .dy-pics a').first();
  await picture.waitFor();
  const viewer = page.locator('#margin-root .lb');
  const scrollTop = () => page.locator('#margin-root .app').evaluate(element => element.scrollTop);
  const open = async () => { await picture.click(); await viewer.locator('[aria-label="关闭"]').waitFor(); await page.waitForTimeout(250); };
  const close = async () => { await page.keyboard.press('Escape'); await viewer.waitFor({ state: 'detached' }); };
  const check = async (name, run) => {
    const result = { name, ok: false };
    results.push(result);
    try { await run(result); result.ok = true; console.log(`PASS ${name}`); }
    catch (error) { result.error = error.message; console.log(`FAIL ${name}: ${error.message}`); }
    finally { if (await viewer.count()) await close(); }
  };
  await check('wheel-stays-in-viewer', async result => {
    await open();
    result.before = await scrollTop();
    await page.mouse.move(640, 380);
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(350);
    result.after = await scrollTop();
    await page.screenshot({ path: join(out, 'open.png') });
    assert.equal(result.after, result.before, 'background page scrolls while the image viewer is open');
  });
  await check('focus-stays-in-viewer-and-returns', async result => {
    await open();
    result.initial = await viewer.evaluate(element => element.contains(element.getRootNode().activeElement));
    const first = viewer.locator('a[href],button').first();
    const last = viewer.locator('a[href],button').last();
    await first.focus();
    await page.keyboard.press('Shift+Tab');
    result.reverse = await last.evaluate(element => element === element.getRootNode().activeElement);
    await page.keyboard.press('Tab');
    result.forward = await first.evaluate(element => element === element.getRootNode().activeElement);
    await close();
    result.returned = await picture.evaluate(element => element === element.getRootNode().activeElement);
    assert(result.initial && result.reverse && result.forward && result.returned, JSON.stringify(result));
  });
  await check('closing-restores-existing-scroll-style', async result => {
    await picture.scrollIntoViewIfNeeded();
    await page.evaluate(() => document.documentElement.style.setProperty('overflow', 'clip', 'important'));
    try {
      await open();
      await close();
      result.style = await page.evaluate(() => ({ value: document.documentElement.style.getPropertyValue('overflow'), priority: document.documentElement.style.getPropertyPriority('overflow') }));
      assert.deepEqual(result.style, { value: 'clip', priority: 'important' });
    } finally { await page.evaluate(() => document.documentElement.style.removeProperty('overflow')); }
  });
  await check('image-navigation-and-reopening', async result => {
    await open();
    await page.keyboard.press('ArrowRight');
    assert.equal(await viewer.locator('.lb-count').textContent(), '2 / 3');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await viewer.locator('.lb-count').textContent(), '1 / 3');
    await viewer.locator('.lb-th').last().click();
    assert.equal(await viewer.locator('.lb-count').textContent(), '3 / 3');
    result.original = await viewer.locator('.lb-raw').getAttribute('href');
    assert(result.original.startsWith('https://'));
    await close();
    await open();
    assert.equal(await viewer.locator('.lb-count').textContent(), '1 / 3');
    await close();
    const before = await scrollTop();
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(300);
    assert(await scrollTop() > before, 'page scrolling stays locked after closing');
  });
} finally {
  writeFileSync(join(out, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  await context.close();
}
if (results.some(result => !result.ok) || errors.length) process.exitCode = 1;
