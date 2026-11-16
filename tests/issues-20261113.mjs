import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { installMocks } from './mocks.mjs';

// GitHub #176：简洁平面 + 哔哩蓝/粉时，投稿按钮被 [data-material] 的实底规则改成 --surface，
// 文字仍是 --margin-primary-fg(#fff)，白底白字。这里锁住三种强调色 + 深浅主题下的实际取值。
const ext = resolve(process.env.SMOKE_EXT || 'dist');
const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/issues-20261113');
mkdirSync(out, { recursive: true });
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-issues-1113-')), {
  channel: 'chromium', headless: true, viewport: { width: 1440, height: 1000 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const results = [], errors = [];
const check = async (name, run) => {
  try { await run(); results.push({ name, passed: true }); console.log(`PASS ${name}`); }
  catch (e) { results.push({ name, passed: false, error: e.message }); console.log(`FAIL ${name}: ${e.message}`); throw e; }
};
try {
  await installMocks(ctx);
  const worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.setDefaultTimeout(8000);
  const seed = patch => worker.evaluate(async p => {
    const s = (await chrome.storage.local.get('margin:settings'))['margin:settings'] || {};
    await chrome.storage.local.set({ 'margin:settings': { ...s, ...p } });
  }, patch);
  const load = async ({ accent, theme, glass = 'flat' }) => {
    await seed({ intro: false, weather: false, footprint: false, bg: { mode: 'off' }, theme, glass, accent });
    await page.goto('https://www.bilibili.com/');
    await page.locator('#margin-root .upload').waitFor();
    const expected = { classic: '', blue: '#007da8', pink: '#b92f64' }[accent];
    await page.waitForFunction(v => document.documentElement.style.getPropertyValue('--margin-primary') === v, expected);
    return page.locator('#margin-root .upload').evaluate(el => {
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, color: cs.color };
    });
  };
  const contrast = ({ bg, color }) => {
    const rgb = s => s.match(/\d+/g).slice(0, 3).map(Number).map(v => { const c = v / 255; return c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
    const lum = s => { const [r, g, b] = rgb(s); return .2126 * r + .7152 * g + .0722 * b; };
    const [a, b] = [lum(bg), lum(color)].sort((x, y) => y - x);
    return (a + .05) / (b + .05);
  };

  await check('简洁平面 + 哔哩蓝：投稿按钮保留强调底色、白字可读', async () => {
    const s = await load({ accent: 'blue', theme: 'light' });
    assert.deepEqual(s, { bg: 'rgb(0, 125, 168)', color: 'rgb(255, 255, 255)' });
    assert(contrast(s) >= 4.5, `对比度不足：${contrast(s).toFixed(2)}`);
  });

  await check('简洁平面 + 哔哩粉：投稿按钮保留强调底色、白字可读', async () => {
    const s = await load({ accent: 'pink', theme: 'light' });
    assert.deepEqual(s, { bg: 'rgb(185, 47, 100)', color: 'rgb(255, 255, 255)' });
    assert(contrast(s) >= 4.5, `对比度不足：${contrast(s).toFixed(2)}`);
  });

  await check('简洁平面 + 经典色：沿用 --surface 实底 + --nav-ink 深字，和改动前一致', async () => {
    const s = await load({ accent: 'classic', theme: 'light' });
    assert.deepEqual(s, { bg: 'rgb(255, 255, 255)', color: 'rgb(36, 40, 49)' });
  });

  await check('深色主题 + 哔哩粉：同样保留强调底色', async () => {
    const s = await load({ accent: 'pink', theme: 'dark' });
    assert.deepEqual(s, { bg: 'rgb(185, 47, 100)', color: 'rgb(255, 255, 255)' });
  });

  await check('简洁平面仍把其它材质控件改成实底，没有被 :not(.upload) 带偏', async () => {
    await load({ accent: 'blue', theme: 'light' });
    const et = await page.locator('#margin-root .top .et').evaluate(el => getComputedStyle(el).backgroundColor);
    assert.equal(et, 'rgb(255, 255, 255)');
  });

  for (const theme of ['light', 'dark']) {
    for (const accent of ['classic', 'blue', 'pink']) {
      await check(`完整平面矩阵：${theme}/${accent}`, async () => {
        const s = await load({accent, theme});
        assert(contrast(s) >= 4.5, JSON.stringify(s));
        assert.equal(await page.locator('#margin-root .upload').evaluate(el => getComputedStyle(el).backdropFilter), 'none');
      });
    }
  }
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia', {features: [{name:'prefers-reduced-transparency', value:'reduce'}]});
  assert(await page.evaluate(() => matchMedia('(prefers-reduced-transparency: reduce)').matches));
  for (const theme of ['light', 'dark']) {
    for (const accent of ['classic', 'blue', 'pink']) {
      await check(`减少透明度：${theme}/${accent}`, async () => {
        const s = await load({accent, theme, glass:'liquid'});
        assert(contrast(s) >= 4.5, JSON.stringify(s));
        assert.equal(await page.locator('#margin-root .upload').evaluate(el => getComputedStyle(el).backdropFilter), 'none');
      });
    }
  }
  await cdp.send('Emulation.setEmulatedMedia', {features: []});
  for (const theme of ['light', 'dark']) {
    for (const feedLayout of ['classic', 'sidebar']) {
      await check(`全部动态风车及选中交互：${theme}/${feedLayout}`, async () => {
        await seed({theme,feedLayout});
        await page.goto('https://t.bilibili.com/');
        const all = page.locator('.fd-ups .fd-up[data-mid="0"]');
        await all.waitFor();
        assert.equal(await all.locator('[data-header-icon="moments"]').count(), 1);
        const clips = await page.locator('#margin-root svg clipPath').evaluateAll(els=>els.map(el=>el.id));
        assert.equal(new Set(clips).size, clips.length, 'feed/header clip path IDs must not collide');
        await all.click();
        assert.equal(await all.getAttribute('aria-pressed'), 'true');
      });
    }
  }

  await page.screenshot({ path: join(out, 'flat-upload-accent.png') });
  assert.deepEqual(errors, []);
} finally {
  writeFileSync(join(out, 'report.json'), JSON.stringify({results,errors,scope:'Isolated Chromium extension with mocked Bilibili data; no account writes.'}, null, 2));
  const failed = results.filter(r => !r.passed);
  if (failed.length) process.exitCode = 1;
  await ctx.close();
}
