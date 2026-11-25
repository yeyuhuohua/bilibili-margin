// Set HEADER_LIVE=1 for the real anonymous search page instead of the offline native markup.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { installMocks } from './mocks.mjs';

// An event keyword can mount Bilibili's full-page Easter-egg overlay over the field.
const live = process.env.HEADER_LIVE === '1', term = 'typescript', url = `https://search.bilibili.com/all?keyword=${term}`;
const ext = resolve(process.env.SMOKE_EXT || 'dist'), out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/native-search-material');
mkdirSync(out, { recursive: true });
const ctx = await chromium.launchPersistentContext('', {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, viewport: { width: 1440, height: 900 }, locale: 'zh-CN',
  args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const results = { live };
try {
  if (!live) {
    await installMocks(ctx);
    await ctx.route(url, route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><meta charset="utf-8">
      <style>.search-header{display:grid;place-items:center}.search-input-wrap{display:flex;align-items:center;box-sizing:border-box}.search-input-el{border:0;background:transparent}</style>
      <main id="app"><div class="search-header"><div class="search-input-wrap flex_between"><svg class="search-icon"></svg><input type="text" class="search-input-el" value="${term}"><button class="search-button">搜索</button></div></div></main>` }));
  }
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  const set = patch => sw.evaluate(async patch => {
    const key = 'margin:settings', s = (await chrome.storage.local.get(key))[key];
    await chrome.storage.local.set({ [key]: { ...s, ...patch } });
  }, patch);
  await set({ theme: 'dark', glass: 'liquid', radius: 100, intro: false, weather: false, bg: { mode: 'off' } });
  const page = ctx.pages()[0];
  page.setDefaultTimeout(live ? 15000 : 7000);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const shell = page.locator('.search-input-wrap:visible').first(), input = shell.locator('.search-input-el');
  await input.waitFor();
  await page.waitForFunction(() => document.documentElement.matches('.margin-search[data-margin-theme="dark"][data-margin-glass="liquid"]') &&
    ['.search-input-wrap[data-material="lens"]', '#margin-watch-top'].every(sel => document.querySelector(sel)) &&
    getComputedStyle(document.querySelector('.search-input-wrap')).backdropFilter.includes('url('));
  const paint = () => shell.evaluate(el => {
    const s = getComputedStyle(el), r = el.getBoundingClientRect(), id = /#([\w-]+)/.exec(s.backdropFilter)?.[1];
    return { border: s.borderLeftColor, borderWidth: s.borderLeftWidth, outline: s.outlineStyle, shadow: s.boxShadow,
      background: s.backgroundColor, filter: s.backdropFilter, width: r.width, height: r.height,
      scales: id && [...document.getElementById(id).querySelectorAll('feDisplacementMap')].map(n => Number(n.getAttribute('scale'))) };
  });
  const crop = async filename => {
    const r = await shell.boundingBox();
    await page.screenshot({ path: join(out, filename), clip: { x: r.x-10, y: r.y-8, width: r.width+20, height: r.height+16 } });
  };
  const settled = () => shell.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished.catch(() => {}))));
  // Attaching the lens starts the native border-color transition; sample its final paint, not an in-between frame.
  await settled();
  const idle = results.idle = await paint();
  await crop('dark-idle.png');
  assert.equal(idle.border, 'rgba(0, 0, 0, 0)', 'native search input still has a light border around its whole perimeter');
  assert.equal(idle.shadow, await page.locator('#margin-watch-top .top .et').evaluate(el => getComputedStyle(el).boxShadow), 'native and header search should share the directional edge');
  assert.deepEqual(idle.scales, [1,0,-1].map(d => Math.round(idle.height)*.6+d));
  assert.match(idle.filter, /blur\(0\.5px\) saturate\(1\.3\)/);
  await input.click();
  await page.waitForFunction(() => document.activeElement?.matches('.search-input-el') &&
    getComputedStyle(document.querySelector('.search-input-wrap')).borderLeftColor !== 'rgba(0, 0, 0, 0)');
  await input.press('End'); await input.pressSequentially('x');
  assert.equal(await input.inputValue(), `${term}x`, 'the site-owned field still accepts typing');
  await input.press('Backspace'); assert.equal(await input.inputValue(), term);
  await settled(); await crop('dark-focused.png');
  const focus = results.focus = await paint();
  assert.deepEqual([focus.width,focus.height,focus.borderWidth], [idle.width,idle.height,idle.borderWidth], 'focus must not resize the field');
  console.log(`PASS ${live ? 'live anonymous' : 'offline'} native search: dark directional shell, unchanged optics and native input focus`);

  await input.evaluate(el => el.blur());
  await settled();
  const blurred = results.blurred = await paint();
  assert.equal(blurred.border, idle.border, 'blur must restore the completely transparent idle border');
  assert.equal(blurred.shadow, idle.shadow, 'blur must restore the directional idle rim');
  const cdp = await ctx.newCDPSession(page);
  for (const [feature, value] of [['prefers-reduced-transparency','reduce'], ['prefers-contrast','more'], ['forced-colors','active']]) {
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: feature, value }] });
    assert(await page.evaluate(q => matchMedia(q).matches, `(${feature}:${value})`));
    await settled();
    const s = results[feature] = await paint();
    assert.equal(s.filter, 'none', `${feature}: no optics behind native text`);
    assert.match(s.background, /^rgb\(/, `${feature}: native field must be opaque`);
    if (feature !== 'prefers-reduced-transparency') {
      assert.notEqual(s.border, 'rgba(0, 0, 0, 0)', `${feature}: field boundary disappears`);
      await input.focus();
      assert.notEqual((await paint()).outline, 'none', `${feature}: native text focus needs a distinct indicator`);
      await input.evaluate(el => el.blur());
    }
    console.log(`PASS native search ${feature}`);
  }
  await cdp.send('Emulation.setEmulatedMedia', { features: [] });
  for (const glass of ['flat','soft','liquid']) for (const radius of [0,100]) {
    await set({ glass, radius });
    await page.waitForFunction(({ glass, radius }) => {
      const s = getComputedStyle(document.querySelector('.search-input-wrap'));
      return document.documentElement.dataset.marginGlass === glass && (parseFloat(s.borderTopLeftRadius)>0) === (radius>0) &&
        (glass === 'flat' ? s.backdropFilter === 'none' : glass === 'soft' ? s.backdropFilter.startsWith('blur(') : s.backdropFilter.includes('url('));
    }, { glass, radius });
    const { width, height } = await paint();
    assert.deepEqual([width,height], [idle.width,idle.height], 'changing mode or corners must not resize the native field');
  }
  console.log('PASS native search: stable geometry and expected filters at both radii in all three modes');
} finally {
  writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2));
  await ctx.close();
}
