import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installMocks } from './mocks.mjs';

const extension = resolve(process.env.SMOKE_EXT || 'dist');
const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/preview-visibility');
mkdirSync(out, { recursive: true });
const wav = Buffer.alloc(44 + 16000 * 20 * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-preview-')), {
  channel: 'chromium', headless: true, viewport: { width: 1440, height: 1000 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
const results = [], errors = [];
let playRequests = 0;
try {
  await installMocks(context, address => {
    if (address.includes('/x/player/wbi/playurl')) {
      playRequests++;
      return { code: 0, data: { durl: [{ url: 'https://www.bilibili.com/preview.wav' }] } };
    }
    return null;
  });
  await context.route('https://www.bilibili.com/preview.wav', route => route.fulfill({ contentType: 'audio/wav', body: wav }));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': {
    intro: false, weather: false, footprint: false, bg: { mode: 'off' }, hoverPreview: true,
  } }));
  const page = context.pages()[0];
  page.on('pageerror', error => errors.push(error.message));
  const cdp = await context.newCDPSession(page), worlds = new Map();
  cdp.on('Runtime.executionContextCreated', ({ context }) => worlds.set(context.id, context));
  await cdp.send('Runtime.enable');
  const origin = worker.url().split('/').slice(0, 3).join('/');
  const evaluate = async expression => {
    const world = [...worlds.values()].find(world => world.origin === origin);
    const result = await cdp.send('Runtime.evaluate', { contextId: world.id, expression, returnByValue: true });
    assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const hidden = async value => evaluate(`previewHidden = ${value}; document.dispatchEvent(new Event('visibilitychange'))`);
  await page.goto('https://www.bilibili.com/');
  const covers = page.locator('#margin-root main .grid .cover');
  await covers.first().waitFor();
  await evaluate(`globalThis.previewHidden = false; Object.defineProperty(document, 'hidden', { configurable: true, get: () => previewHidden })`);
  await covers.first().hover();
  await page.waitForFunction(() => document.getElementById('margin-root').shadowRoot.querySelector('.pv')?.paused === false);
  await evaluate(`globalThis.previewVideo = document.getElementById('margin-root').shadowRoot.querySelector('.pv')`);
  await hidden(true);
  await page.waitForTimeout(400);
  const stopped = await evaluate('({ paused: previewVideo.paused, connected: previewVideo.isConnected, hasSource: previewVideo.hasAttribute("src") })');
  results.push({ name: 'playing preview releases its media when hidden', ...stopped });
  if (process.env.PERF_BASELINE !== '1') assert.deepEqual(stopped, { paused: true, connected: false, hasSource: false });
  await hidden(false);
  await page.mouse.move(5, 500);
  await covers.first().hover();
  await page.waitForFunction(() => document.getElementById('margin-root').shadowRoot.querySelector('.pv')?.paused === false);
  results.push({ name: 'preview can play again on hover', passed: true });
  await page.mouse.move(5, 500);
  await page.waitForTimeout(300);
  const before = playRequests;
  await covers.nth(1).hover();
  await page.waitForTimeout(150);
  await hidden(true);
  await page.waitForTimeout(600);
  results.push({ name: 'pending hover is canceled before requesting media', requests: playRequests - before });
  if (process.env.PERF_BASELINE !== '1') assert.equal(playRequests, before);
  await hidden(false);
  await page.mouse.move(5, 500);
  await covers.first().hover();
  await page.waitForFunction(() => document.getElementById('margin-root').shadowRoot.querySelector('.pv')?.paused === false);
  await evaluate(`previewVideo = document.getElementById('margin-root').shadowRoot.querySelector('.pv');
    document.getElementById('margin-root').shadowRoot.querySelector('.tab[data-tab="popular"]').click()`);
  await page.waitForTimeout(400);
  const switched = await evaluate('({ paused: previewVideo.paused, hasSource: previewVideo.hasAttribute("src") })');
  assert.deepEqual(switched, { paused: true, hasSource: false });
  results.push({ name: 'switching tabs stops cached card media', ...switched });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ results, errors }));
} finally {
  writeFileSync(join(out, 'report.json'), JSON.stringify({ results, errors, scope: 'Built extension, synthetic audio fixture, simulated visibility in extension isolated world.' }, null, 2));
  await context.close();
}
