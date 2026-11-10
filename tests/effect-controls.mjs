import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { installMocks } from './mocks.mjs';

const extension = resolve(process.env.SMOKE_EXT || 'dist');
const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/effect-controls');
mkdirSync(out, { recursive: true });
const results = [], errors = [];
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-effects-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, args: ['--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', ...(process.env.SMOKE_SOFTWARE_GL ? ['--use-angle=swiftshader'] : []), `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', reducedMotion: 'no-preference',
});
try {
  await installMocks(context);
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const patch = async value => worker.evaluate(async value => {
    const key = 'margin:settings', stored = await chrome.storage.local.get(key);
    await chrome.storage.local.set({ [key]: { ...stored[key], ...value } });
  }, value);
  for (const [name, url, host] of [
    ['home', 'https://www.bilibili.com/', '#margin-root'],
    ['watch', 'https://www.bilibili.com/video/BV1mdxN68E7F/', '#margin-watch-top'],
    ['search', 'https://search.bilibili.com/all?keyword=test', '#margin-watch-top'],
  ]) {
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await patch({ searchStyle: 'new', theme: 'dark', intro: false, uiEffects: true, glass: 'soft', reduceMotion: false, bg: { mode: 'fixed', shader: 'silk', intensity: .6 } });
    const result = { name, ok: false };
    results.push(result);
    try {
      const cdp = await context.newCDPSession(page), worlds = new Map();
      cdp.on('Runtime.executionContextCreated', ({ context }) => worlds.set(context.id, context));
      cdp.on('Runtime.executionContextDestroyed', ({ executionContextId }) => worlds.delete(executionContextId));
      cdp.on('Runtime.executionContextsCleared', () => worlds.clear());
      await cdp.send('Runtime.enable');
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.locator(`${host} .top [aria-label="设置"]`).click();
      await page.locator(`${host} .sheet[aria-label="设置"]`).getByRole('tab', { name: '外观', exact: true }).click();
      const effects = page.locator(`${host} [role="switch"][aria-label="控件动效"]`);
      await effects.waitFor({ timeout: 6000 });
      assert.equal(await effects.getAttribute('aria-checked'), 'true');
      const origin = worker.url().split('/').slice(0, 3).join('/');
      const evaluate = async expression => {
        const world = [...worlds.values()].find(world => world.origin === origin);
        assert(world, 'extension world missing');
        const value = await cdp.send('Runtime.evaluate', { contextId: world.id, expression, returnByValue: true });
        assert(!value.exceptionDetails, JSON.stringify(value.exceptionDetails));
        return value.result.value;
      };
      await evaluate(`window.effectDraws = 0; (() => {
        const draw = WebGLRenderingContext.prototype.drawArrays;
        WebGLRenderingContext.prototype.drawArrays = function(...args) {
          if (this.canvas.parentElement?.classList.contains('bg')) effectDraws++;
          return draw.apply(this, args);
        };
      })()`);
      const background = page.locator(name === 'home' ? '#margin-root .bg' : '#margin-bg .bg');
      result.softwareRenderer = await background.evaluate(bg => bg.hasAttribute('data-soft'));
      await page.waitForTimeout(500);
      await evaluate('effectDraws = 0');
      await page.waitForTimeout(400);
      result.baselineDraws = await evaluate('effectDraws');
      assert.equal(result.baselineDraws > 0, !result.softwareRenderer, 'unexpected initial background rendering policy');
      await effects.click();
      await page.locator(`${host} .app.margin-ui-still`).waitFor({ state: 'attached' });
      await page.locator(`${host} [role="radio"]`).filter({ hasText: '简洁平面' }).click();
      await page.locator(`${host} .app[data-glass="flat"]`).waitFor({ state: 'attached' });
      for (const theme of ['light', 'dark']) {
        await patch({ theme });
        await page.locator(`${host} .app[data-theme="${theme}"]`).waitFor({ state: 'attached' });
        const styles = await page.locator(`${host} .app`).evaluate(app => {
          const elements = ['.search', '.et', '.sheet'];
          return elements.map(selector => {
            const el = app.querySelector(selector), style = getComputedStyle(el);
            return { selector, backdrop: style.backdropFilter, transition: style.transitionDuration, background: style.backgroundColor };
          });
        });
        assert(styles.every(style => style.backdrop === 'none'), JSON.stringify(styles));
        assert(styles.every(style => style.transition.split(',').every(value => parseFloat(value) <= .001)), JSON.stringify(styles));
        await page.screenshot({ path: join(out, `${name}-${theme}.png`) });
      }
      // Closing settings makes the background visible on every supported entry point.
      await page.locator(`${host} .sheet[aria-label="设置"] .sheet-x`).click();
      await page.waitForTimeout(200);
      await evaluate('effectDraws = 0');
      await page.waitForTimeout(700);
      result.movingDraws = await evaluate('effectDraws');
      assert.equal(result.movingDraws > 0, !result.softwareRenderer, 'control preference changed the background rendering policy');
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('margin-reduce')), false);
      assert.equal(await background.getAttribute('data-mode'), 'fixed');
      await patch({ bg: { mode: 'off' } });
      await page.waitForFunction(() => {
        const host = document.getElementById('margin-bg') || document.getElementById('margin-root');
        return host.shadowRoot.querySelector('.bg').dataset.mode === 'off';
      });
      await evaluate('effectDraws = 0');
      await page.setViewportSize({ width: 1440, height: 980 });
      await page.waitForTimeout(400);
      assert.equal(await evaluate('effectDraws'), 0, 'disabled background keeps rendering');
      await patch({ uiEffects: true, glass: 'soft' });
      await page.locator(`${host} .app[data-glass="soft"]:not(.margin-ui-still)`).waitFor({ state: 'attached' });
      assert.match(await page.locator(`${host} .et`).evaluate(el => getComputedStyle(el).backdropFilter), /blur/);
      await patch({ uiEffects: false, glass: 'flat' });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator(`${host} .app[data-glass="flat"].margin-ui-still`).waitFor({ state: 'attached' });
      if (name === 'watch') {
        const duration = await page.locator('.bpx-player-container').evaluate(player => {
          const danmaku = document.createElement('span');
          danmaku.style.animation = 'test-scroll 6s linear infinite';
          player.append(danmaku);
          return getComputedStyle(danmaku).animationDuration;
        });
        assert.equal(duration, '6s', 'control preference affects native player animation');
      }
      result.ok = true;
      console.log(`PASS ${name}: effect controls, flat themes, background independence and persistence`);
    } catch (error) {
      result.error = error.stack;
      console.error(`FAIL ${name}: ${error.message}`);
    } finally { await page.close(); }
  }
} finally {
  writeFileSync(join(out, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  await context.close();
}
if (results.some(result => !result.ok) || errors.length) process.exitCode = 1;
