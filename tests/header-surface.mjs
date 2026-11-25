// High-contrast backgrounds must not reveal a full-width header tint or blur edge.
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { installMocks } from './mocks.mjs';

const ext = resolve(process.env.SMOKE_EXT || 'dist'), out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/header-surface');
mkdirSync(out, { recursive: true });
const baseline = process.env.HEADER_BASELINE === '1', results = [], errors = [];
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-header-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }), headless: true,
  args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  viewport: { width: 1440, height: 1000 }, locale: 'zh-CN',
});
try {
  await installMocks(ctx);
  await ctx.addInitScript(() => sessionStorage.setItem('margin:intro-played', '1'));
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker'), page = ctx.pages()[0];
  page.on('pageerror', e => errors.push(e.message));
  for (const theme of ['light', 'dark']) for (const glass of ['soft', 'liquid']) {
    await sw.evaluate(s => chrome.storage.local.set({ 'margin:settings': s }), { theme, glass, radius: glass === 'soft' ? 0 : 100, intro: false });
    for (const [name, url, host] of [
      ['home', 'https://www.bilibili.com/', '#margin-root'],
      ['watch', 'https://www.bilibili.com/video/BV1mdxN68E7F/', '#margin-watch-top'],
      ['message', 'https://message.bilibili.com/#/whisper', '#margin-root'],
    ]) {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      const app = page.locator(`${host} .app`), header = page.locator(`${host} .top`);
      await header.waitFor();
      await page.waitForFunction(({ host, theme, glass }) => {
        const app = document.querySelector(host)?.shadowRoot?.querySelector('.app');
        return app?.getAttribute('data-theme') === theme && app?.getAttribute('data-glass') === glass;
      }, { host, theme, glass });
      const corners = await header.locator('.ts').evaluate(el => {
        const thumb = el.querySelector('.ts-sm'), edge = el.querySelector('.ts-edge');
        return [getComputedStyle(el.querySelector('.ts-c')).borderRadius, getComputedStyle(thumb).borderRadius,
          getComputedStyle(edge, '::after').borderRadius];
      });
      const expected = glass === 'soft' ? '0px' : '999px';
      assert.deepEqual(corners, [expected,expected,expected], name + '/' + theme + '/' + glass);
      await app.evaluate(e => {
        e.dataset.bg = 'image'; e.scrollTop = 240;
        const probe = document.createElement('div');
        probe.style.cssText = 'position:fixed;inset:0;z-index:4;pointer-events:none;background:repeating-linear-gradient(90deg,#fff 0 48px,#aaa 48px 96px)';
        e.append(probe);
      });
      if (name === 'watch') await page.evaluate(() => { document.body.style.minHeight = '2000px'; scrollTo(0, 240); });
      await page.waitForTimeout(250);
      const styles = await header.evaluate(e => {
        const s = getComputedStyle(e), p = getComputedStyle(e, '::before'), capsule = getComputedStyle(e.querySelector('.et'));
        return { background: s.backgroundImage, color: s.backgroundColor, backdrop: s.backdropFilter, before: p.content, capsuleBackdrop: capsule.backdropFilter, top: e.getBoundingClientRect().top };
      });
      const screenshot = await page.screenshot({ path: join(out, `${name}-${theme}-${glass}.png`), clip: { x: 0, y: 0, width: 1440, height: 120 } });
      const pixels = await page.evaluate(async base64 => {
        const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
        const c = document.createElement('canvas'); c.width = image.width; c.height = image.height;
        const g = c.getContext('2d'); g.drawImage(image, 0, 0);
        return [16, 48, 70, 73, 83, 100].map(y => ({ y, rgba: [...g.getImageData(8, y, 1, 1).data] }));
      }, screenshot.toString('base64'));
      const clean = pixels.every(p => p.rgba.every(v => v === 255));
      const result = { name, theme, glass, ...styles, clean, pixels }; results.push(result);
      if (!baseline) {
        assert(clean, `${name}/${theme}/${glass}: full-width header changes the background ${JSON.stringify(pixels)}`);
        assert.equal(styles.background, 'none'); assert.equal(styles.color, 'rgba(0, 0, 0, 0)');
        assert.equal(styles.backdrop, 'none'); assert(['none', 'normal'].includes(styles.before));
        assert.notEqual(styles.capsuleBackdrop, 'none', 'individual glass controls lost their backdrop');
        assert(Math.abs(styles.top) < 1, 'header no longer stays at the top during scrolling');
      }
      console.log(`${clean ? 'PASS' : 'TRACE'} ${name} ${theme} ${glass}`);
    }
  }
  await page.goto('https://www.bilibili.com/');
  const quick = page.locator('#margin-root .et');
  await quick.waitFor();
  await quick.evaluate(el => {
    el.style.cssText = 'max-width:196px;overflow-x:auto;scrollbar-width:thin';
    el.scrollLeft = 56;
  });
  const active = quick.locator('.et-btn:visible').nth(3);
  await active.hover();
  await page.waitForTimeout(250);
  const offsets = await quick.evaluate(el => {
    const rect = q => q.getBoundingClientRect();
    const board = rect(el.querySelector('.et-thumb'));
    const button = rect([...el.querySelectorAll('.et-btn')].filter(x => !x.hidden)[3]);
    const toggle = rect(el.parentElement.querySelector('.ts'));
    const orb = rect(el.parentElement.querySelector('.ts-sm'));
    const centerY = r => r.top + r.height / 2;
    return { x: board.left-button.left, y:centerY(board)-centerY(button), orb:centerY(orb)-centerY(toggle), scroll:el.scrollLeft };
  });
  assert(offsets.scroll > 0 && [offsets.x, offsets.y, offsets.orb].every(diff => Math.abs(diff) < 1), JSON.stringify(offsets));
  results.push({name:'aligned nav hover and theme switch after horizontal scrolling', ...offsets});
  // A settings reorder can move the selected anchor while the nav width stays fixed.
  await page.mouse.move(0,0);
  const selected = quick.locator('.et-btn').filter({hasText:'分区'}).first();
  await selected.evaluate(b => {
    b.dispatchEvent(new PointerEvent('pointerenter',{pointerType:'mouse'}));
  });
  await sw.evaluate(async () => {
    const key = 'margin:settings';
    const old = (await chrome.storage.local.get(key))[key];
    await chrome.storage.local.set({[key]:{...old,headOrder:['直播','大会员','分区']}});
  });
  await page.waitForFunction(() => {
    const nav = document.querySelector('#margin-root').shadowRoot.querySelector('.et');
    const b = [...nav.querySelectorAll('.et-btn')].find(el => el.querySelector('span').textContent === '分区');
    return b.style.order === '2' && Math.abs(nav.querySelector('.et-thumb').getBoundingClientRect().x-b.getBoundingClientRect().x)<1;
  },null,{timeout:3000});
  // Follow the filter actually painted by the theme track, not a fallback in <defs>.
  const track = page.locator('#margin-root .ts-c[style*="url("]');
  const filterId = await track.evaluate(el => el.style.backdropFilter.match(/#([\w-]+)/)[1]);
  const imageSelector = `#margin-root #${filterId} feImage`;
  const map = page.locator(imageSelector), roundUrl = await map.getAttribute('href');
  assert.match(roundUrl, /^blob:/);
  const box = await track.boundingBox();
  let previousUrl = roundUrl;
  for (const radius of [0,50,100,150]) {
    await sw.evaluate(async radius => {
      const key = 'margin:settings';
      const settings = (await chrome.storage.local.get(key))[key];
      await chrome.storage.local.set({[key]:{...settings,radius}});
    }, radius);
    await page.waitForFunction(radius => {
      const thumb = document.querySelector('#margin-root').shadowRoot.querySelector('.ts-sm');
      const expected = 999 * radius / 100;
      return parseFloat(getComputedStyle(thumb).borderRadius) === expected &&
        parseFloat(getComputedStyle(thumb.querySelector('.ts-edge'),'::after').borderRadius) === expected;
    }, radius);
    const { width, height } = await track.boundingBox();
    assert.deepEqual([width, height], [box.width, box.height], 'radius test must not resize the glass');
    if (radius === 0 || radius === 50) {
      await page.locator(`${imageSelector}:not([href="${previousUrl}"])`).waitFor({ state: 'attached', timeout: 5000 });
      previousUrl = await map.getAttribute('href');
      const alpha = await map.evaluate(async node => {
        const img = new Image(); img.src = node.getAttribute('href'); await img.decode();
        const ctx = document.createElement('canvas').getContext('2d'); ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, 1, 1).data[3];
      });
      assert.equal(alpha, radius === 0 ? 255 : 0, `lens corner at radius setting ${radius}`);
      if (radius === 50) assert.equal(previousUrl, roundUrl, 'equivalent clamped radii must reuse the original map');
    }
  }
  console.log('PASS fixed-size liquid lens: square and round map pixels; clamped radius reuses original URL');
  await sw.evaluate(async () => {
    const key = 'margin:settings', old = (await chrome.storage.local.get(key))[key];
    await chrome.storage.local.set({[key]:{...old,headLabels:true}});
  });
  await page.setViewportSize({width:1920,height:960});
  for (const url of ['https://www.bilibili.com/video/BV1mdxN68E7F/','https://live.bilibili.com/3']) {
    await page.goto(url,{waitUntil:'domcontentloaded'});
    const menu = page.locator('#margin-watch-top .et-labels');
    await menu.waitFor();
    assert.ok(await menu.evaluate(el=>el.scrollWidth <= el.clientWidth + 1),'wide header clipped its shortcuts');
    assert.equal(await page.locator('#margin-watch-top .upload').evaluate(el=>getComputedStyle(el).whiteSpace),'nowrap');
  }
  assert.deepEqual(errors, []);
} finally {
  writeFileSync(join(out, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  await ctx.close();
}
