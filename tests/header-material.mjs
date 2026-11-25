// Built extension, real header mounts, offline Bilibili responses. SMOKE_EXT can point at a release.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { installMocks } from './mocks.mjs';

const ext = resolve(process.env.SMOKE_EXT || 'dist');
const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/header-material');
mkdirSync(out, { recursive: true });
const ctx = await chromium.launchPersistentContext('', {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, viewport: { width: 1440, height: 900 }, locale: 'zh-CN',
  args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const results = [], errors = [];
const darkBands = 'linear-gradient(115deg,#292e36 0% 24%,#556f83 24% 40%,#4b3945 40% 58%,#20252a 58% 78%,#426568 78%) 0 0 / 440px 100%';
// A backdrop behind the real controls, never CSS overrides on the controls themselves.
const backdrop = (top, background) => top.evaluate(async (header, background) => {
  const app = header.closest('.app'), bg = app.querySelector('.material-test-bg') || document.createElement('div');
  bg.className = 'material-test-bg';
  bg.style.cssText = `position:fixed;z-index:4;pointer-events:none;inset:0 0 auto;height:${Math.ceil(header.querySelector('.et').getBoundingClientRect().bottom + 20)}px`;
  bg.style.background = background; app.append(bg);
  await document.fonts.ready;
}, background);
async function strip(top, filename) {
  const image = await top.page().screenshot({ path: join(out, filename), clip: { x: 0, y: 0, width: 1440, height: 80 } });
  return top.evaluate(async (header, png) => {
    const img = new Image(); img.src = `data:image/png;base64,${png}`; await img.decode();
    const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
    const g = canvas.getContext('2d'); g.drawImage(img, 0, 0);
    const pixels = g.getImageData(0, 0, img.width, img.height).data;
    const swatch = document.createElement('canvas').getContext('2d');
    const rgb = (x,y) => pixels.subarray((img.width*y+x)*4, (img.width*y+x)*4+3);
    const luma = c => .2126*c[0] + .7152*c[1] + .0722*c[2];
    const luminance = c => luma(Array.from(c, v => (v/=255) <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4));
    return ['.search', '.et'].map(selector => {
      const el = header.querySelector(selector), r = el.getBoundingClientRect();
      const xs = []; // Omit curved ends. At 5px from the bottom, glyphs/dividers do not pollute the backing sample.
      for (let x = Math.ceil(r.left + r.height); x < r.right - r.height; x++) xs.push(x);
      const medianEdge = (y, inset) => Math.round(xs.map(x => luma(rgb(x,y)) - luma(rgb(x,y+inset))).sort((a,b) => a-b)[Math.floor(xs.length/2)]);
      const backing = xs.map(x => rgb(x, Math.round(r.bottom)-5));
      const minContrast = color => {
        swatch.clearRect(0,0,1,1); swatch.fillStyle = color; swatch.fillRect(0,0,1,1);
        const rgba = swatch.getImageData(0,0,1,1).data, alpha = rgba[3]/255;
        return Math.min(...backing.map(px => {
          const bg = luminance(px), fg = luminance(Array.from(px, (v,i) => rgba[i]*alpha + v*(1-alpha)));
          return (Math.max(bg,fg)+.05)/(Math.min(bg,fg)+.05);
        }));
      };
      const hot = el.querySelector('.search-ph-w:not(.out)');
      const text = selector === '.et' ? { shortcuts: getComputedStyle(el.querySelector('.et-btn')).color } : {
        hint: (hot ? getComputedStyle(hot) : getComputedStyle(el.querySelector('input'),'::placeholder')).color,
        keycap: getComputedStyle(el.querySelector('kbd')).color };
      return { selector, outline: getComputedStyle(el).outlineStyle,
        top: medianEdge(Math.round(r.top), 3), bottom: medianEdge(Math.round(r.bottom)-1, -3),
        contrast: Object.fromEntries(Object.entries(text).map(([role, color]) => [role, minContrast(color)])) };
    });
  }, image.toString('base64'));
}
try {
  await installMocks(ctx);
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  const set = patch => sw.evaluate(async patch => {
    const key = 'margin:settings', current = (await chrome.storage.local.get(key))[key];
    await chrome.storage.local.set({ [key]: { ...current, ...patch } });
  }, patch);
  const page = ctx.pages()[0];
  page.setDefaultTimeout(7000);
  page.on('pageerror', e => errors.push(e.message));
  await set({ theme: 'dark', glass: 'liquid', radius: 100, homeHide: ['search'], searchStyle: 'classic',
    intro: false, weather: false, footprint: false, bg: { mode: 'off' } });
  for (const [name, url, host] of [
    ['home', 'https://www.bilibili.com/', '#margin-root'],
    ['watch', 'https://www.bilibili.com/video/BV1mdxN68E7F/', '#margin-watch-top'],
    ['message', 'https://message.bilibili.com/#/whisper', '#margin-root'],
  ]) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const top = page.locator(`${host} .top`);
    await top.locator('.search').waitFor();
    await page.waitForFunction(host => {
      const top = document.querySelector(host)?.shadowRoot?.querySelector('.top');
      return top && ['.et', '.search'].every(sel => getComputedStyle(top.querySelector(sel)).backdropFilter.includes('url('));
    }, host);
    await backdrop(top, darkBands);
    const samples = await strip(top, `${name}-dark-stripes.png`);
    results.push({ name, samples });
    for (const s of samples) {
      const where = `${name} ${s.selector}: ${JSON.stringify(s)}`;
      assert.equal(s.outline, 'none', `idle dark shell still draws an all-around outline: ${where}`);
      // A's lower line was ~66 levels brighter than its fill; B's was ~8 darker.
      assert(s.bottom > -7 && s.bottom < 35, `lower edge is washed out or too heavy: ${where}`);
      assert(s.top > s.bottom + 24 && s.top < 115, `top light must dominate the lower edge: ${where}`);
    }
    console.log(`PASS ${name}: directional dark shell on search and shortcuts`, samples);

    const quick = top.locator('.et'), thumb = quick.locator('.et-thumb');
    const aligned = label => page.waitForFunction(({ host, label }) => {
      const nav = document.querySelector(host).shadowRoot.querySelector('.top .et');
      const t = nav.querySelector('.et-thumb'), b = nav.querySelector(`[aria-label="${label}"]`);
      const a = t.getBoundingClientRect(), r = b.getBoundingClientRect();
      return Number(getComputedStyle(t).opacity) > .98 && Math.abs(a.left-r.left) < 1 && Math.abs(a.width-r.width) < 1;
    }, { host, label });
    const lefts = [];
    for (const label of ['分区', '大会员']) {
      await quick.getByRole('link', { name: label, exact: true }).hover();
      await aligned(label);
      lefts.push((await thumb.boundingBox()).x);
    }
    assert(lefts[1] > lefts[0], 'one thumb must move between shortcuts');
    const optics = await top.evaluate(header => ['.search', '.et'].map(selector => {
      const shell = header.querySelector(selector), css = getComputedStyle(shell);
      const id = /#([\w-]+)/.exec(css.backdropFilter)?.[1];
      const filter = shell.getRootNode().getElementById(id);
      return { selector, height: shell.getBoundingClientRect().height, filter: css.backdropFilter,
        scales: [...filter.querySelectorAll('feDisplacementMap')].map(n => Number(n.getAttribute('scale'))),
        nested: [shell, ...shell.querySelectorAll('*')].flatMap(el => [null,'::before','::after'].filter(p =>
          (el !== shell || p) && getComputedStyle(el,p).backdropFilter !== 'none').map(p => el.tagName + (p || ''))) };
    }));
    for (const o of optics) {
      assert.deepEqual(o.nested, [], `nested filter inside ${name} ${o.selector}`);
      assert.deepEqual(o.scales, [1,0,-1].map(d => Math.round(o.height)*.6+d), 'do not strengthen the existing shell lens');
    }
    const paint = await thumb.evaluate(el => { const s = getComputedStyle(el); return [s.filter, s.boxShadow, s.backgroundColor]; });
    assert.deepEqual(paint.slice(0,2), ['none','none'], 'the thumb is a tint, not a second beveled capsule');
    assert.notEqual(paint[2], 'rgba(0, 0, 0, 0)', 'the moving tint must remain visible');
    results.push({ name, optics, thumb: paint });
    await page.mouse.move(0, 85);
    await quick.locator('.et-thumb:not([data-on])').waitFor({ state: 'attached' });
    console.log(`PASS ${name}: one shell lens, moving unfiltered tint`);

    // Tab previews without activating; a temporary pointer preview yields back to keyboard focus.
    await quick.getByRole('link', { name: '分区', exact: true }).focus();
    await page.keyboard.press('Tab');
    const focused = quick.getByRole('link', { name: '直播', exact: true });
    assert(await focused.evaluate(el => el.matches(':focus-visible') && getComputedStyle(el).outlineStyle !== 'none'));
    assert(await thumb.evaluate(el => el.hasAttribute('data-on')), 'Tab focus must reveal the same moving tint as pointer hover');
    await aligned('直播');
    if (name === 'home') await page.screenshot({ path: join(out, 'home-keyboard.png'), clip: { x:0, y:0, width:1440, height:80 } });
    assert.equal(await quick.locator('[data-selected]').count(), 0);
    await quick.getByRole('link', { name: '大会员', exact: true }).hover();
    await aligned('大会员');
    await page.mouse.move(0, 85);
    await aligned('直播');
    await top.locator('.ts').focus();
    await quick.locator('.et-thumb:not([data-on])').waitFor({ state: 'attached' });
    console.log(`PASS ${name}: keyboard and pointer share the thumb without selecting or stranding it`);
  }
  const top = page.locator('#margin-root .top'), quick = top.locator('.et');
  await set({ headHover: false, headLabels: true });
  await top.locator('.et.et-labels').waitFor(); // same settings update as headHover
  await quick.getByRole('link', { name: '分区', exact: true }).hover();
  assert(!(await quick.locator('.et-thumb').evaluate(el => el.hasAttribute('data-on'))), 'disabled pointer previews must stay off');
  await quick.getByRole('link', { name: '分区', exact: true }).focus();
  await page.keyboard.press('Tab');
  assert(await quick.locator('.et-thumb').evaluate(el => el.hasAttribute('data-on')), 'disabling hover must not disable keyboard feedback');
  await top.locator('.ts').focus(); await page.mouse.move(0,85);
  // The same mounted page follows the OS theme; include the rotating search hint, not just its hidden placeholder.
  const wallpaper = readFileSync(new URL('./fixtures/glass-wallpaper.svg', import.meta.url)).toString('base64');
  await set({ headLabels: false, theme: 'auto', searchStyle: 'new', uiEffects: false });
  await top.locator('.search.has-hot .search-ph-w:not(.out)').waitFor();
  for (const theme of ['dark','light']) {
    await page.emulateMedia({ colorScheme: theme });
    await page.locator(`#margin-root .app[data-theme="${theme}"]`).waitFor();
    for (const [scene, bg] of Object.entries({ paper: '#f5f4f1', charcoal: '#111112', wallpaper: `url(data:image/svg+xml;base64,${wallpaper}) center / 560px auto` })) {
      await backdrop(top, bg);
      const samples = await strip(top, `${theme}-${scene}.png`);
      results.push({ theme, scene, samples });
      for (const s of samples) for (const [role, ratio] of Object.entries(s.contrast))
        assert(ratio >= 4.5, `${theme}/${scene} ${role}: ${ratio.toFixed(2)}:1 on the rendered shell`);
    }
    console.log(`PASS ${theme}: shortcuts, rotating hint and keycap meet 4.5:1 over paper, charcoal and wallpaper`);
  }
  const shellState = (selectors = ['.search','.et','.et-thumb']) => top.evaluate((header, selectors) => selectors.map(sel => {
    const el = header.querySelector(sel), s = getComputedStyle(el);
    return { sel, radius: parseFloat(s.borderTopLeftRadius), filter: s.backdropFilter, background: s.backgroundColor,
      outline: s.outlineStyle, size: [el.offsetWidth,el.offsetHeight] };
  }), selectors);
  let size;
  const fills = { light: ['rgb(255, 255, 255)','rgba(250, 250, 248, 0.8)'], dark: ['rgb(26, 26, 28)','rgba(22, 25, 31, 0.72)'] };
  for (const theme of ['light','dark']) for (const glass of ['flat','soft','liquid']) for (const radius of [0,100]) {
    await set({ theme, glass, radius });
    await page.waitForFunction(({ theme, glass, radius }) => {
      const app = document.querySelector('#margin-root').shadowRoot.querySelector('.app');
      const shell = app.querySelector('.top .et'), css = getComputedStyle(shell);
      return app.dataset.theme === theme && app.dataset.glass === glass && (parseFloat(css.borderTopLeftRadius) > 0) === (radius > 0) &&
        (glass !== 'liquid' || css.backdropFilter.includes('url('));
    }, { theme, glass, radius });
    const current = await shellState();
    for (const s of current) {
      assert(radius ? s.radius >= s.size[1]/2 : s.radius === 0, `${glass}/${radius} ${s.sel} corners`);
      if (s.sel === '.et-thumb' || glass === 'flat') assert.equal(s.filter, 'none');
      else if (glass === 'soft') { assert.match(s.filter, /blur\(/); assert(!s.filter.includes('url(')); }
      else assert(s.filter.includes('url('));
      if (s.sel !== '.et-thumb') assert.equal(s.background, fills[theme][glass === 'flat' ? 0 : 1], `unchanged ${theme}/${glass} fill`);
    }
    const boxes = current.slice(0,2).map(s => s.size);
    size ??= boxes; assert.deepEqual(boxes, size, 'radius/mode must not resize capsules');
  }
  console.log('PASS light and dark, soft / flat / liquid, radius 0 / 100: stable geometry, original fills and one shell filter');
  const cdp = await ctx.newCDPSession(page);
  for (const [feature,value] of [['prefers-reduced-transparency','reduce'], ['prefers-contrast','more'], ['forced-colors','active']]) {
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: feature, value }] });
    assert(await page.evaluate(q => matchMedia(q).matches, `(${feature}:${value})`));
    for (const s of await shellState(['.search','.et','.ts-c'])) {
      assert.equal(s.filter, 'none', `${feature}: ${s.sel} must not sample the backdrop`);
      assert.match(s.background, /^rgb\(/, `${feature}: opaque ${s.sel} shell`);
      if (feature !== 'prefers-reduced-transparency') assert.notEqual(s.outline, 'none', `${feature}: visible ${s.sel} boundary`);
    }
    console.log(`PASS header ${feature}`);
  }
  assert.deepEqual(errors, []);
} finally {
  writeFileSync(join(out, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  await ctx.close();
}
