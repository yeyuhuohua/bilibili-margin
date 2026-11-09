import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installMocks } from './mocks.mjs';
import { build } from 'vite';

const extension = resolve(process.env.SMOKE_EXT || 'dist');
const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/sun-moon');
mkdirSync(out, { recursive: true });
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-sun-moon-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, viewport: { width: 1440, height: 1000 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
const results = [], errors = [];
try {
  await installMocks(context);
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const seed = patch => worker.evaluate(async patch => {
    const saved = (await chrome.storage.local.get('margin:settings'))['margin:settings'];
    await chrome.storage.local.set({ 'margin:settings': { ...saved, ...patch } });
  }, patch);
  const page = context.pages()[0];
  page.on('pageerror', error => errors.push(error.message));
  for (const [name, url, host] of [
    ['home', 'https://www.bilibili.com/', '#margin-root'],
    ['watch', 'https://www.bilibili.com/video/BV1mdxN68E7F/', '#margin-watch-top'],
    ['space', 'https://space.bilibili.com/2', '#margin-root'],
  ]) {
    await seed({ theme: 'dark', intro: false, reduceMotion: false, uiEffects: true, bg: { mode: 'off' } });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const button = page.locator(`${host} .ts`);
    await button.waitFor();
    async function settled(theme) {
      await page.waitForFunction(({ host, theme }) => {
        const button = document.querySelector(host)?.shadowRoot?.querySelector('.ts');
        return button?.dataset.state === theme && button.dataset.progress === (theme === 'dark' ? '0.0000' : '1.0000') && !button.classList.contains('moving');
      }, { host, theme });
      assert.equal(await button.getAttribute('aria-checked'), String(theme === 'dark'));
    }
    await settled('dark');
    const initial = await button.evaluate(button => {
      const thumb = button.querySelector('.ts-sm');
      const r = thumb.getBoundingClientRect();
      const canvas = thumb.querySelector('canvas');
      const alpha = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      return { width: r.width, height: r.height, radius: getComputedStyle(thumb).borderTopLeftRadius, visible: alpha.some((value, i) => i % 4 === 3 && value > 0) };
    });
    assert.ok(initial.visible);
    assert.equal(initial.radius, '50%');
    assert.ok(Math.abs(initial.width - initial.height) < .1);
    for (const theme of ['light', 'dark']) {
      for (const glass of ['liquid', 'soft', 'flat']) {
        await seed({ theme, glass });
        await settled(theme);
        await page.waitForFunction(({ host, glass }) => {
          const app = document.querySelector(host)?.shadowRoot?.querySelector('.app');
          const track = app?.querySelector('.ts-c');
          if (!track || app.dataset.glass !== glass) return false;
          const filter = getComputedStyle(track).backdropFilter;
          return glass === 'liquid' ? filter.includes('url(') : glass === 'flat' ? filter === 'none' : filter.includes('blur(16px)');
        }, { host, glass });
        await page.waitForTimeout(450);
        const material = await button.evaluate(button => {
          const read = el => {
            const style = getComputedStyle(el);
            return { background: style.backgroundColor, image: style.backgroundImage, shadow: style.boxShadow, filter: style.backdropFilter.replace(/url\([^)]*\)/g, 'url(shared)') };
          };
          return { track: read(button.querySelector('.ts-c')), header: read(button.closest('.top').querySelector('.et')), overlay: !!button.querySelector('.ts-track-light') };
        });
        assert.deepEqual(material.track, material.header, `${name} ${theme} ${glass} capsule material`);
        assert.equal(material.overlay, false);
      }
    }
    await seed({ theme: 'dark', glass: 'liquid' });
    await settled('dark');
    await button.evaluate(button => { button.closest('.app').style.backgroundImage = 'repeating-linear-gradient(110deg, #355863 0 65px, #b39b7c 65px 130px)'; });
    await page.mouse.move(0, 900);
    await page.waitForTimeout(450);
    await page.locator(`${host} .top`).screenshot({ path: join(out, `${name}-glass-track.png`) });
    await button.evaluate(button => { button.closest('.app').style.removeProperty('background-image'); });
    const transparency = await page.context().newCDPSession(page);
    await transparency.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
    await page.waitForTimeout(450);
    assert.equal(await button.locator('.ts-c').evaluate(el => getComputedStyle(el).backdropFilter), 'none');
    await transparency.send('Emulation.setEmulatedMedia', { features: [] });
    await transparency.detach();
    console.log(`PASS ${name} shared glass materials in both themes and reduced transparency`);
    await button.click();
    await settled('light');
    const box = await button.boundingBox();
    await page.mouse.move(box.x + box.width * .75, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * .2, box.y + box.height / 2, { steps: 12 });
    await page.mouse.up();
    await settled('dark');
    await button.focus();
    await page.keyboard.press('Space');
    await settled('light');
    for (let i = 0; i < 10; i++) await button.click();
    await settled('light');
    await page.waitForTimeout(400);
    assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('margin:settings'))['margin:settings'].theme), 'light');
    await seed({ uiEffects: false });
    await page.waitForFunction(() => document.documentElement.classList.contains('margin-ui-still'));
    await button.click();
    assert.equal(await button.getAttribute('data-progress'), '0.0000');
    await settled('dark');
    await seed({ uiEffects: true, reduceMotion: true });
    await page.waitForFunction(() => document.documentElement.classList.contains('margin-reduce'));
    await button.click();
    assert.equal(await button.getAttribute('data-progress'), '1.0000');
    await settled('light');
    await page.screenshot({ path: join(out, `${name}.png`) });
    results.push({ name, initial, checks: 'shared capsule/header materials in liquid, soft and flat modes and both themes; reduced transparency; initial shape and pixels, click, drag, keyboard, rapid reversal, persisted theme, disabled UI effects, reduced motion', ok: true });
    console.log(`PASS ${name} glass theme switch`);
  }
  // Exercise cleanup in the same implementation with deterministic page lifecycle events.
  const entry = join(out, 'lifecycle-entry.ts');
  writeFileSync(entry, `export { createSunMoon } from ${JSON.stringify(resolve('src/content/ui/sun-moon.ts'))};`);
  const bundle = await build({ configFile: false, publicDir: false, logLevel: 'error', build: { write: false, lib: { entry, name: 'switchTest', formats: ['iife'] } } });
  const code = (Array.isArray(bundle) ? bundle[0] : bundle).output.find(item => item.type === 'chunk').code;
  await context.route('https://margin-switch.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }));
  await page.goto('https://margin-switch.test/');
  await page.addStyleTag({ content: readFileSync('src/content/styles/05-footprint.css', 'utf8') });
  await page.evaluate(() => {
    window.switchFrames = 0;
    window.switchRemovals = [];
    const raf = requestAnimationFrame;
    window.requestAnimationFrame = callback => raf(time => { window.switchFrames++; callback(time); });
    const remove = document.removeEventListener;
    document.removeEventListener = function (name, ...rest) { window.switchRemovals.push(name); return remove.call(this, name, ...rest); };
  });
  await page.addScriptTag({ content: code });
  await page.evaluate(() => {
    window.control = switchTest.createSunMoon(() => control.set(control.el.dataset.state === 'dark' ? 'light' : 'dark'));
    document.body.append(control.el);
    control.set('dark');
  });
  await page.waitForTimeout(100);
  await page.locator('.ts').click();
  await page.waitForTimeout(60);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const hiddenFrames = await page.evaluate(() => window.switchFrames);
  await page.waitForTimeout(120);
  assert.equal(await page.evaluate(() => window.switchFrames), hiddenFrames);
  assert.equal(await page.locator('.ts').getAttribute('data-progress'), '1.0000');
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
    control.el.click();
    control.el.remove();
  });
  await page.waitForTimeout(150);
  const removedFrames = await page.evaluate(() => window.switchFrames);
  await page.waitForTimeout(120);
  assert.equal(await page.evaluate(() => window.switchFrames), removedFrames);
  assert.ok(await page.evaluate(() => ['visibilitychange', 'margin:motion', 'margin:ui-motion'].every(name => window.switchRemovals.includes(name))));
  results.push({ name: 'lifecycle', checks: 'hidden-tab pause and detached-control cleanup', ok: true });
  console.log('PASS hidden-tab and detached-control cleanup');
  assert.deepEqual(errors, []);
} finally {
  writeFileSync(join(out, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  await context.close();
}
