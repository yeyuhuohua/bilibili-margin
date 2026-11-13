import assert from 'node:assert/strict';
import { build } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { installMocks } from './mocks.mjs';

const out = resolve(process.env.SMOKE_OUT || 'delivery/reliability'); mkdirSync(out, { recursive: true });
const bundle = await build({ configFile: false, publicDir: false, logLevel: 'error', build: { write: false, minify: false, lib: { entry: 'tests/reliability-entry.ts', name: 'review', formats: ['iife'] } } });
const code = (Array.isArray(bundle) ? bundle[0] : bundle).output.find(x => x.type === 'chunk').code;
const browser = await chromium.launch({ headless: true, channel: 'chromium' });
const results = [], errors = [];
let login = false, navCalls = 0;
const context = await browser.newContext({ viewport: { width: 1280, height: 850 } });
await installMocks(context, async url => {
  if (url.includes('/x/web-interface/nav')) {
    navCalls++; return { code: 0, data: { isLogin: login, mid: login ? 1 : 0, wbi_img: {} } };
  }
  return null;
});
await context.route('http://margin.test/**', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html class="margin-skin"><body><button id="native">原生页面按钮</button><div id="fixture"></div></body></html>' }));
async function pageFor(kind) {
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://margin.test/');
  await page.evaluate(() => {
    window.store = {}; window.failSettings = false; window.fpMode = 'ok'; window.imports = [];
    window.chrome = { runtime: {
      getManifest: () => ({ version: '0.60.25', version_name: '0.6.25' }),
      sendMessage: async m => {
        if (m.margin === 'fp' && m.op === 'import') {
          window.imports.push(m);
          if (window.fpMode === 'reject') return { ok: false, error: '模拟磁盘写入失败' };
          if (window.fpMode === 'disconnect') throw Error('Extension context invalidated');
          if (window.fpMode === 'timeout') return new Promise(() => {});
        }
        return { ok: true, authed: false };
      },
    }, storage: { local: {
      get: async key => ({ [key]: window.store[key] }),
      set: async patch => { if (window.failSettings && patch['margin:settings']) throw Error('模拟设置写入失败'); Object.assign(window.store, patch); },
    }, onChanged: { addListener() {}, removeListener() {} } } };
  });
  await page.addScriptTag({ content: code });
  await page.evaluate(kind => {
    const root = document.querySelector('#fixture').attachShadow({ mode: 'open' });
    const style = document.createElement('style'); style.textContent = review.css; root.append(style);
    const app = document.createElement('div'); app.className = 'app'; app.dataset.theme = 'dark'; root.append(app);
    const trigger = document.createElement('button'); trigger.id = 'trigger'; trigger.textContent = '打开'; app.append(trigger);
    window.api = kind === 'favorites' ? review.createFavorites(() => {}) : review.createSettingsPanel(() => review.DEFAULTS, () => null).sheet;
    app.append(api.el); trigger.onclick = () => api.open(); trigger.focus(); api.open();
  }, kind);
  await page.getByRole('dialog').waitFor(); return page;
}
async function check(name, run) {
  const before = errors.length;
  try { await run(); assert.equal(errors.length, before, errors.slice(before).join('\n')); results.push({ name, passed: true }); }
  catch (e) { results.push({ name, passed: false, error: e.message }); }
}
try {
  for (const kind of ['settings', 'favorites']) await check(`${kind}: focus stays inside dialog and restores`, async () => {
    const page = await pageFor(kind), dialog = page.getByRole('dialog');
    const first = kind === 'settings' ? dialog.getByRole('searchbox', { name: '搜索设置' }) : dialog.getByRole('button', { name: '关闭', exact: true });
    await first.focus();
    for (const key of ['Shift+Tab', 'Tab']) for (let n=0;n<20;n++) {
      await page.keyboard.press(key);
      assert(await dialog.evaluate(el => { let a=document.activeElement;while(a?.shadowRoot?.activeElement)a=a.shadowRoot.activeElement;return el.contains(a); }), key+' escaped modal');
    }
    assert(await page.locator('#native').evaluate(el => el.inert), 'native page background was not isolated');
    await page.keyboard.press('Escape');
    assert(await page.locator('#trigger').evaluate(el => el.getRootNode().activeElement === el), 'opener focus not restored');
    assert(!await page.locator('#native').evaluate(el => el.inert), 'native page remained inert after close');
    await page.close();
  });
  await check('favorites: login after empty auth response retries once and caches success', async () => {
    login = false; const page = await pageFor('favorites');
    await page.getByText('登录后才能看到你的收藏夹', { exact: true }).waitFor();
    await page.evaluate(() => api.close()); login = true; const before = navCalls;
    await page.evaluate(() => api.open());
    await page.locator('.gf-root').first().waitFor({ timeout: 2500 });
    assert.equal(navCalls, before + 1, 'auth was not revalidated on login retry');
    const after = navCalls; await page.evaluate(() => { api.close(); api.open(); });
    await page.waitForTimeout(100); assert.equal(navCalls, after, 'successful cache was needlessly refetched');
    await page.close();
  });
  for (const mode of ['reject', 'disconnect', 'settings-fail', 'ok']) await check(`import: ${mode} reports actual saved state`, async () => {
    const page = await pageFor('settings');
    await page.getByRole('searchbox', { name: '搜索设置' }).fill('导入');
    await page.evaluate(mode => { window.fpMode = mode; window.failSettings = mode === 'settings-fail'; }, mode);
    page.on('dialog', d => d.accept());
    const backup = { app: 'margin', settings: { theme: 'light' }, activity: { '2026-11-01': { s: 120, f: '08:30' } } };
    await page.getByLabel('选择要导入的备份文件').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    await page.waitForTimeout(150);
    const state = await page.evaluate(() => ({ imports: imports.length, settings: store['margin:settings'], text: document.querySelector('#fixture').shadowRoot.querySelector('.toast')?.textContent || '' }));
    if (mode === 'ok') { assert.equal(state.settings.theme, 'light'); assert.match(state.text, /已导入.*设置.*1 天足迹/); }
    else if (mode === 'settings-fail') { assert.match(state.text, /足迹.*已|已.*足迹/); assert.match(state.text, /设置.*失败/); }
    else { assert.equal(state.settings, undefined, 'settings must not be changed after footprint failure'); assert.match(state.text, /导入失败/); }
    assert.equal(state.imports, 1); await page.close();
  });
  await check('import: timeout is recoverable and does not apply settings', async () => {
    const page=await pageFor('settings'); await page.clock.install();
    await page.getByRole('searchbox', { name: '搜索设置' }).fill('导入');
    await page.evaluate(()=>{window.fpMode='timeout';}); page.on('dialog',d=>d.accept());
    await page.getByLabel('选择要导入的备份文件').setInputFiles({name:'timeout.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({app:'margin',settings:{theme:'light'},activity:{'2026-11-01':{s:120}}}))});
    await page.waitForFunction(()=>window.imports.length===1); await page.clock.fastForward(8100);
    const state=await page.evaluate(()=>({text:document.querySelector('#fixture').shadowRoot.querySelector('.toast')?.textContent,settings:store['margin:settings']}));
    assert.match(state.text,/导入失败.*超时/);assert.equal(state.settings,undefined);
    assert(!await page.getByRole('button',{name:'导入',exact:true}).isDisabled());await page.close();
  });
} finally {
  writeFileSync(join(out, 'report.json'), JSON.stringify({ results, errors }, null, 2)); await browser.close();
}
console.log(JSON.stringify({ passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed) }, null, 2));
assert(results.every(r => r.passed), 'reliability regressions failed');
