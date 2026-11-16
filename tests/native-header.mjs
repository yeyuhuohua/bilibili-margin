// Exercise the actual wallpaper layer and native navigation placeholders.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installMocks } from './mocks.mjs';

const extension = resolve(process.env.SMOKE_EXT || 'dist');
const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/native-header');
mkdirSync(out, { recursive: true });
const results = [], errors = [];
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-native-header-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, viewport: { width: 1440, height: 1000 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
try {
  await installMocks(context);
  await context.addInitScript(() => sessionStorage.setItem('margin:intro-played', '1'));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page = context.pages()[0];
  page.on('pageerror', error => errors.push(error.message));
  const wallpaper = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 4;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#143264'; ctx.fillRect(0, 0, 4, 4);
    return canvas.toDataURL();
  });
  for (const theme of ['dark', 'light']) {
    await worker.evaluate(async ({ theme, wallpaper }) => chrome.storage.local.set({
      'margin:settings': { theme, intro: false, glass: 'liquid', privacyExternal: false, bg: { mode: 'image', intensity: 0.6 } },
      'margin:bg-image': wallpaper,
    }), { theme, wallpaper });
    for (const [name, url] of [
      ['feed', 'https://t.bilibili.com/'],
      ['detail', 'https://t.bilibili.com/900001'],
      ['live', 'https://live.bilibili.com/3'],
      ['home', 'https://www.bilibili.com/'],
    ]) {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      const header = page.locator('.top');
      await header.waitFor();
      await page.waitForFunction(theme => {
        const root = document.querySelector('#margin-root, #margin-watch-top')?.shadowRoot;
        const bg = document.querySelector('#margin-bg')?.shadowRoot || root;
        return root?.querySelector('.app')?.dataset.theme === theme && bg?.querySelector('.bg-img')?.style.backgroundImage;
      }, theme);
      // Native room navigation is also mounted after the extension has started.
      if (name === 'live') await page.evaluate(() => {
        const style = document.createElement('style');
        style.textContent = '.prehold-nav{position:fixed;inset:0 0 auto;height:64px;background:#fff;z-index:10000}';
        document.head.append(style);
        const nav = document.createElement('div'); nav.id = 'prehold-nav-vm'; nav.className = 'prehold-nav';
        nav.textContent = '原站预加载导航'; document.body.append(nav);
      });
      if (name === 'detail') await page.evaluate(() => {
        // dyn-detail adds this background below the 72px header when its own dark theme is active.
        document.documentElement.classList.add('bili_dark');
        const style = document.createElement('style');
        style.textContent = '#app{position:relative;min-height:2000px}html.bili_dark #app:after{content:"";z-index:1;opacity:.5;background:linear-gradient(#111,#000);display:block;position:absolute;inset:0}';
        document.head.append(style);
      });
      for (const scroll of [0, 240]) {
        await page.evaluate(scroll => {
          const app = document.querySelector('#margin-root')?.shadowRoot?.querySelector('.app');
          if (app) app.scrollTop = scroll;
          else { document.body.style.minHeight = '2000px'; window.scrollTo(0, scroll); }
        }, scroll);
        await page.waitForTimeout(250);
        const style = await header.evaluate(el => {
          const css = getComputedStyle(el), control = el.querySelector('.et');
          const box = control.getBoundingClientRect();
          const hit = el.getRootNode().elementFromPoint(box.x + 20, box.y + box.height / 2);
          return { background: css.backgroundColor, backdrop: css.backdropFilter, top: el.getBoundingClientRect().top,
            controlBackdrop: getComputedStyle(control).backdropFilter, controlHit: control.contains(hit) };
        });
        const screenshot = await page.screenshot({ path: join(out, `${name}-${theme}-${scroll}.png`), clip: { x: 0, y: 0, width: 1440, height: 120 } });
        const pixels = await page.evaluate(async base64 => {
          const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
          const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
          const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
          return [62, 65, 71, 74].map(y => [...ctx.getImageData(8, y, 1, 1).data].slice(0, 3));
        }, screenshot.toString('base64'));
        const nativeHidden = name !== 'live' || await page.locator('#prehold-nav-vm').evaluate(el => getComputedStyle(el).display === 'none');
        const nativeBackdrop = name === 'detail' ? await page.locator('#app').evaluate(el => getComputedStyle(el, '::after').content) : 'none';
        results.push({ name, theme, scroll, ...style, pixels, nativeHidden, nativeBackdrop });
        assert(nativeHidden, 'native live navigation placeholder remains visible');
        assert.equal(nativeBackdrop, 'none', 'native dynamic dark-mode backdrop creates a separate surface below the header');
        assert(style.controlHit, `${name}: native content covers the navigation controls`);
        assert.equal(style.background, 'rgba(0, 0, 0, 0)');
        assert.equal(style.backdrop, 'none');
        assert.notEqual(style.controlBackdrop, 'none');
        assert(Math.abs(style.top) < 1, `${name}: header moved while scrolling`);
        assert(pixels.flat().every(value => value < 190), `${name}: white strip covers the wallpaper`);
        assert(pixels.slice(1).every((pixel, i) => pixel.every((value, c) => Math.abs(value - pixels[i][c]) <= 3)), `${name}: hard horizontal edge below the navigation`);
        console.log(`PASS ${name} ${theme} scroll=${scroll}`);
      }
    }
  }
  assert.deepEqual(errors, []);
} finally {
  writeFileSync(join(out, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  await context.close();
}
