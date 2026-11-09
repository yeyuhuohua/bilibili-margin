// Content-script integration in a real DOM with mocked chrome.storage/runtime.
// Useful where full extension loading is unavailable. This deliberately does not
// claim to test the service worker, extension isolation, permissions or live APIs.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { installMocks } from './mocks.mjs';

const ext = resolve(process.env.SMOKE_EXT || 'dist');
const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/content-performance');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'],
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark', locale: 'zh-CN', reducedMotion: 'no-preference' });
const errors = [], results = [];
try {
  await installMocks(ctx);
  await ctx.route('https://margin-assets.test/**', async route => {
    const file = resolve(ext, '.' + new URL(route.request().url()).pathname);
    if (!file.startsWith(ext + sep) || !existsSync(file)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ body: readFileSync(file), contentType: file.endsWith('.js') ? 'application/javascript' : file.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream', headers: { 'access-control-allow-origin': '*' } });
  });
  const manifest = JSON.parse(readFileSync(join(ext, 'manifest.json'), 'utf8'));
  const shim = (manifest) => {
    const values = { 'margin:settings': { theme: 'dark', intro: false, idDrag: true } };
    const listeners = new Set();
    const clone = v => v === undefined ? undefined : structuredClone(v);
    const changed = changes => { if (Object.keys(changes).length) queueMicrotask(() => { for (const fn of listeners) fn(changes, 'local'); }); };
    const local = {
      async get(keys) {
        if (keys == null) return clone(values);
        const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
        return Object.fromEntries(list.map(k => [k, clone(values[k] ?? (typeof keys === 'object' && !Array.isArray(keys) ? keys[k] : undefined))]));
      },
      async set(patch) {
        const changes = {};
        for (const [key, value] of Object.entries(patch)) {
          if (JSON.stringify(values[key]) === JSON.stringify(value)) continue;
          changes[key] = { oldValue: clone(values[key]), newValue: clone(value) }; values[key] = clone(value);
        }
        changed(changes);
      },
      async remove(keys) {
        const changes = {};
        for (const key of typeof keys === 'string' ? [keys] : keys) { if (key in values) { changes[key] = { oldValue: clone(values[key]) }; delete values[key]; } }
        changed(changes);
      },
    };
    window.chrome = { ...window.chrome,
      storage: { local, onChanged: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) } },
      runtime: { getURL: path => 'https://margin-assets.test/' + path, getManifest: () => manifest, sendMessage: async () => ({ ok: true }) },
    };
    sessionStorage.setItem('margin:intro-played', '1');
  };
  // Playwright init scripts run even earlier than document_start content scripts.
  // Match the extension's entry point: <html> exists, page body has not hydrated.
  await ctx.addInitScript({ content: `(${shim.toString()})(${JSON.stringify(manifest)});\n(() => {
    const startMargin = () => {\n${readFileSync(join(ext, 'content.js'), 'utf8')}\n};
    if (document.documentElement) startMargin();
    else { const observer = new MutationObserver(() => {
      if (document.documentElement) { observer.disconnect(); startMargin(); }
    }); observer.observe(document, { childList: true }); }
  })();` });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', message => {
    if (message.type() === 'error' && message.text().includes('[MARGIN]')) {
      errors.push(message.text()); console.error(message.text());
    }
  });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  const instrument = async () => page.evaluate(() => {
    window.contentPerf = { rects: {}, styleWrites: 0, attributeWrites: 0 };
    const rect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function() {
      const key = this.id || (typeof this.className === 'string' ? this.className : this.tagName) || this.tagName;
      contentPerf.rects[key] = (contentPerf.rects[key] || 0) + 1;
      return rect.call(this);
    };
    const style = CSSStyleDeclaration.prototype.setProperty;
    CSSStyleDeclaration.prototype.setProperty = function(...args) { contentPerf.styleWrites++; return style.apply(this, args); };
    const attr = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function(...args) { contentPerf.attributeWrites++; return attr.apply(this, args); };
  });
  const run = async (name, action) => {
    await page.evaluate(() => { window.contentPerf = { rects: {}, styleWrites: 0, attributeWrites: 0 }; });
    const before = await metrics();
    await action();
    const after = await metrics(), counts = await page.evaluate(() => contentPerf);
    const result = { name, ...counts, metrics: Object.fromEntries(['TaskDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount', 'RecalcStyleCount'].map(k => [k, after[k] - before[k]])) };
    results.push(result); console.log(JSON.stringify(result));
  };
  await page.goto('https://www.bilibili.com/video/BV1mdxN68E7F/', { waitUntil: 'domcontentloaded' });
  await page.locator('#margin-watch-top .top').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1500);
  await instrument();
  await run('watch-idle', () => page.waitForTimeout(1500));
  await run('watch-native-mutations', () => page.evaluate(() => new Promise(resolve => {
    const host = document.querySelector('#commentapp');
    const node = document.createElement('span'); host.append(node);
    let count = 0;
    const tick = () => { node.textContent = `native comment ${count++}`; if (count < 90) requestAnimationFrame(tick); else resolve(); };
    requestAnimationFrame(tick);
  })));
  assert(await page.locator('.bpx-player-container').count(), 'native player removed');
  await page.screenshot({ path: join(out, 'watch.png') });

  await page.goto('https://www.bilibili.com/', { waitUntil: 'domcontentloaded' });
  await page.locator('#margin-root .grid .card:not(.sk)').first().waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1000);
  await page.locator('#margin-root .user.in').hover();
  const card = page.locator('#margin-root .idcl-card');
  await card.waitFor();
  await page.waitForTimeout(1600);
  await instrument();
  await run('account-idle', () => page.waitForTimeout(1600));
  await run('account-tilt', async () => {
    const box = await card.boundingBox();
    for (let i = 0; i < 24; i++) { await page.mouse.move(box.x + box.width * (.3 + (i % 8) * .05), box.y + box.height * .35); await page.waitForTimeout(16); }
  });
  await page.screenshot({ path: join(out, 'home.png') });

  if (process.env.PERF_BASELINE !== '1') {
    // Exercise the changed motion lifecycle using trusted browser input. These
    // behavior checks are outside the comparable measurement windows above.
    const clickPart = async selector => {
      const box = await card.locator(selector).boundingBox();
      assert(box, `missing card surface: ${selector}`);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(800);
    };
    const flipAngle = () => card.locator('.idcl-flipper').evaluate(el => Number(/rotateY\(([-.\d]+)deg\)/.exec(el.style.transform)?.[1]));
    await clickPart('.idcl-name');
    assert(await flipAngle() > 140, 'account card did not flip to its back');
    await clickPart('.idcl-idnum');
    assert(Math.abs(await flipAngle()) < 20, 'account card did not flip back');
    const grip = await card.locator('.idcl-photo').boundingBox();
    const beforeDrag = await card.boundingBox();
    const x = grip.x + grip.width / 2, y = grip.y + grip.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 70, y + 30, { steps: 6 });
    await page.waitForTimeout(100);
    const duringDrag = await card.boundingBox();
    assert(Math.hypot(duringDrag.x - beforeDrag.x, duringDrag.y - beforeDrag.y) > 15, 'account card did not follow drag');
    await page.mouse.up();
    await page.waitForTimeout(300);
    assert(!/NaN|Infinity/.test(await card.getAttribute('style')), 'account physics produced a non-finite transform');
    await page.mouse.move(30, 900);
    await page.waitForTimeout(900);
    assert.equal(await card.isVisible(), false, 'account card did not close after leaving');
    const closedTransform = await card.getAttribute('style');
    await page.waitForTimeout(200);
    assert.equal(await card.getAttribute('style'), closedTransform, 'closed account card kept updating');
    await page.evaluate(async () => {
      const values = await chrome.storage.local.get('margin:settings');
      await chrome.storage.local.set({ 'margin:settings': { ...values['margin:settings'], idDrag: false } });
    });
    await page.locator('#margin-root .user.in').hover();
    await page.waitForTimeout(700);
    assert(await card.isVisible(), 'account card did not reopen');
    assert(await card.evaluate(el => el.closest('.idcl-stage').classList.contains('idcl-fixed')), 'fixed card mode did not take effect');
    results.push({ name: 'account-interactions', flip: true, drag: true, close: true, reopen: true, fixedMode: true });
  }
  assert.equal(errors.length, 0, errors.join('\n'));
} finally {
  writeFileSync(join(out, 'results.json'), JSON.stringify({ extension: ext, browser: await browser.version(), scope: 'real DOM + bundled content script, mocked chrome APIs and Bilibili; no extension isolation or real GPU FPS claim', results, errors }, null, 2));
  await browser.close();
}
