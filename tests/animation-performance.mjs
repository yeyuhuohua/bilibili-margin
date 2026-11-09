// Reproducible animation workload and behavior checks. Native rAF samples are
// reported separately from simulated high-refresh scheduler tests; neither is a
// promise about the user's physical display/GPU.
// PERF_SOURCE points at an untouched checkout for the same before/after harness.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'vite';
import { chromium } from 'playwright';

const source = resolve(process.env.PERF_SOURCE || '.');
const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/animation-performance');
const baseline = process.env.PERF_BASELINE === '1';
mkdirSync(out, { recursive: true });
const entry = join(out, 'animation-entry.ts');
writeFileSync(entry, [
  `export { playIntro } from ${JSON.stringify(join(source, 'src/content/ui/intro/intro.ts'))};`,
  `export { introActive } from ${JSON.stringify(join(source, 'src/content/ui/intro/gate.ts'))};`,
  `export { createScrollRuler } from ${JSON.stringify(join(source, 'src/content/ui/scroll-ruler.ts'))};`,
].join('\n'));
const bundle = await build({
  configFile: false, publicDir: false, logLevel: 'error',
  build: { write: false, minify: false, lib: { entry, name: 'animationTest', formats: ['iife'] } },
});
const code = (Array.isArray(bundle) ? bundle[0] : bundle).output.find(x => x.type === 'chunk').code;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  args: ['--no-sandbox'],
});
const results = { source, scope: 'isolated mocked page; browser CPU/layout measurements, not physical GPU FPS', ruler: [], intro: null, softwareFallback: null };
const errors = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion: 'no-preference' });
page.on('pageerror', e => errors.push(e.message));
await page.route('https://margin-performance.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head></head><body></body></html>' }));
const setup = async (css = '') => {
  await page.goto('https://margin-performance.test/');
  await page.addStyleTag({ content: `:root{--ink:#eee;--accent:#00aeec;--canvas:#111;--surface:#222;--mono:monospace;--ease-out:cubic-bezier(.2,.8,.2,1)}body{margin:0;background:#111}${css}` });
  await page.addScriptTag({ content: code });
};
const cdp = await page.context().newCDPSession(page);
await cdp.send('Performance.enable');
const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
try {
  results.browser = await browser.version();
  await setup(readFileSync(join(source, 'src/content/styles/07-overlays.css'), 'utf8'));
  await page.evaluate(() => {
    document.body.style.height = '5000px';
    document.body.append(animationTest.createScrollRuler());
  });
  await page.waitForTimeout(150);
  for (let round = 0; round < 3; round++) {
    await page.evaluate(() => { document.querySelector('.sr').dataset.on = 'false'; });
    await page.waitForTimeout(550);
    const before = await metrics();
    const frames = await page.evaluate(() => new Promise(resolve => {
      const samples = []; let start = 0, last = 0;
      document.querySelector('.sr').dataset.on = 'true';
      const tick = t => {
        if (!start) start = t;
        if (last) samples.push(t - last);
        last = t;
        if (t - start < 1200) { requestAnimationFrame(tick); return; }
        samples.sort((a, b) => a - b);
        resolve({ frames: samples.length, p50: samples[Math.floor(samples.length * .5)], p95: samples[Math.floor(samples.length * .95)], over25ms: samples.filter(n => n > 25).length });
      };
      requestAnimationFrame(tick);
    }));
    const after = await metrics();
    const delta = Object.fromEntries(['LayoutCount', 'LayoutDuration', 'RecalcStyleCount', 'RecalcStyleDuration', 'TaskDuration'].map(k => [k, after[k] - before[k]]));
    results.ruler.push({ round: round + 1, ...frames, metrics: delta });
    if (!baseline) assert(delta.LayoutCount <= 4, `ruler reveal caused repeated layout: ${delta.LayoutCount}`);
  }
  results.rulerGeometry = await page.evaluate(() => {
    const r = document.querySelector('.sr');
    const width = s => r.querySelector(s).getBoundingClientRect().width;
    return { minor: width('i:not(.major):not(.lit)'), major: width('i.major:not(.lit)'), active: width('i.lit'), trackHeight: r.querySelector('.sr-track').getBoundingClientRect().height };
  });
  for (const [key, width] of [['minor', 9], ['major', 15], ['active', 18]]) assert(Math.abs(results.rulerGeometry[key] - width) < .05, `${key} ruler length changed`);
  assert.equal(results.rulerGeometry.trackHeight, 251, 'ruler tick spacing changed');
  await page.locator('.sr').screenshot({ path: join(out, 'ruler.png') });

  await page.setViewportSize({ width: 420, height: 280 });
  await setup('.intro{position:fixed;inset:0}.intro canvas{position:absolute;inset:0;width:100%;height:100%}');
  await page.evaluate(() => {
    localStorage.setItem('margin:force-gl', '1');
    window.introCounts = { geometryReads: 0, draws: 0 };
    for (const name of ['clientWidth', 'clientHeight']) {
      const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, name);
      Object.defineProperty(Element.prototype, name, { configurable: true, get() {
        if (this instanceof HTMLCanvasElement && this.closest('.intro')) introCounts.geometryReads++;
        return descriptor.get.call(this);
      } });
    }
    const draw = WebGL2RenderingContext.prototype.drawArrays;
    WebGL2RenderingContext.prototype.drawArrays = function(...args) {
      if (this.canvas.closest('.intro')) introCounts.draws++;
      return draw.apply(this, args);
    };
    window.introFinished = animationTest.playIntro(document.body, 'dark');
  });
  await page.waitForFunction(() => introCounts.draws >= 3, null, { timeout: 10_000 });
  // Change the aspect ratio as well: stale 420x280 backing pixels must fail.
  await page.setViewportSize({ width: 480, height: 300 });
  await page.waitForTimeout(350);
  results.intro = await page.evaluate(() => {
    const c = document.querySelector('.intro canvas');
    return { ...introCounts, width: c?.width, height: c?.height, active: animationTest.introActive() };
  });
  assert(results.intro.active, 'intro should remain active before completion');
  assert(results.intro.width >= 480 * .59 && results.intro.width <= 480 * 1.51, 'intro backing width did not follow resize');
  assert(Math.abs(results.intro.width / results.intro.height - 1.6) < .02, 'intro backing size did not follow the new aspect ratio');
  if (!baseline) assert(results.intro.geometryReads <= 2, 'intro reads client dimensions every frame');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.intro'));
  assert.equal(await page.evaluate(() => animationTest.introActive()), false, 'skipping intro left background suspended');
  assert.equal(errors.length, 0, errors.join('\n'));

  // The visible no-WebGL fallback must finish and release its overlay without errors.
  await setup('.intro{position:fixed;inset:0}');
  await page.evaluate(async () => {
    localStorage.removeItem('margin:force-gl');
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(kind, ...args) { return kind === 'webgl2' ? null : get.call(this, kind, ...args); };
    await animationTest.playIntro(document.body, 'dark');
  });
  if (!baseline) await page.locator('.intro').waitFor({ state: 'detached', timeout: 2000 });
  else await page.waitForTimeout(700);
  results.softwareFallback = { errors: [...errors], overlayRemoved: await page.locator('.intro').count() === 0 };
  if (!baseline) {
    assert.equal(errors.length, 0, errors.join('\n'));
    assert(results.softwareFallback.overlayRemoved, 'software fallback left an overlay in the DOM');
  }
  console.log(JSON.stringify(results, null, 2));
} finally {
  writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2));
  await browser.close();
}
