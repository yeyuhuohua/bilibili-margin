import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { chromium } from 'playwright';

const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/preview-timing');
mkdirSync(out, { recursive: true });
const path = process.env.PREVIEW_SOURCE || 'src/content/ui/preview.ts';
const source = readFileSync(path, 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export function', 'function');
const script = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }), headless: true });
const page = await browser.newPage();
const results = [];
try {
  await page.setContent('<style>.pv,.pv-bar{position:absolute;inset:0;pointer-events:none}</style><main><a class="dy-vcover" data-bvid="BV1" style="display:flex;position:absolute;left:50px;top:50px;width:300px;height:150px"><span style="width:50%">left</span><span style="width:50%">right</span></a></main>');
  await page.evaluate(() => {
    window.previewRequests = [];
    window.cidRequests = [];
    window.pendingCids = [];
    window.holdCid = false;
    window.hoverEntered = 0;
    document.querySelector('main').addEventListener('mouseover', () => { window.hoverEntered ||= performance.now(); });
    HTMLMediaElement.prototype.play = () => Promise.resolve();
    Object.defineProperty(HTMLMediaElement.prototype, 'src', { set(value) { this.dataset.source = value; }, get() { return this.dataset.source || ''; } });
  });
  await page.addScriptTag({ content: `
    const cardData = new WeakMap();
    const h = (name, attributes) => { const el = document.createElement(name); for (const [key,value] of Object.entries(attributes)) el.setAttribute(key, value); return el; };
    const cidOf = () => { window.cidRequests.push(performance.now()); return window.holdCid ? new Promise(resolve => window.pendingCids.push(resolve)) : Promise.resolve(1); };
    const previewUrl = async () => { window.previewRequests.push(performance.now()); return 'https://preview.invalid/test.mp4'; };
    const invalidatePreview = () => {};
    ${script}
    attachPreview(document.querySelector('main'), () => true);
  ` });
  await page.mouse.move(80, 90);
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(100);
    await page.mouse.move(i % 2 ? 80 : 300, 90);
  }
  const requestTimes = await page.evaluate(() => window.previewRequests);
  const entered = await page.evaluate(() => window.hoverEntered);
  assert.equal(requestTimes.length, 1, 'moving inside a cover repeatedly postponed preview');
  results.push({ name: 'child-pointer-movement', delayMs: requestTimes[0] - entered });
  await page.mouse.move(450, 300);
  await page.waitForTimeout(300);
  await page.evaluate(() => { window.holdCid = true; });
  await page.mouse.move(80, 90);
  await page.waitForTimeout(550);
  await page.mouse.move(450, 300);
  await page.mouse.move(80, 90);
  await page.waitForTimeout(550);
  await page.evaluate(() => window.pendingCids[0](1));
  await page.waitForTimeout(30);
  assert.equal(await page.locator('video').count(), 0, 'stale hover request mounted a video');
  await page.evaluate(() => window.pendingCids[1](1));
  await page.locator('video').waitFor({ state: 'attached', timeout: 2000 });
  assert.equal(await page.locator('video').count(), 1);
  results.push({ name: 'stale-hover-request', passed: true });
} finally {
  const state = await page.evaluate(() => ({ requests: window.previewRequests, cids: window.cidRequests.length, pending: window.pendingCids.length, videos: document.querySelectorAll('video').length }));
  await page.screenshot({ path: out + '/fixture.png' });
  writeFileSync(out + '/results.json', JSON.stringify({ results, state, scope: 'Actual preview source with mocked metadata and media playback' }, null, 2));
  await browser.close();
}
console.log(JSON.stringify(results));
