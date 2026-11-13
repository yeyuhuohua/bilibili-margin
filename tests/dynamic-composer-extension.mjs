import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { build } from 'vite';
import { installMocks } from './mocks.mjs';

const out = resolve(process.env.SMOKE_OUT || 'delivery/dynamic-composer-extension');
mkdirSync(out, { recursive: true });
const entry = join(out, 'entry.ts');
writeFileSync(entry, `import { createDynamicComposer } from ${JSON.stringify(resolve('src/content/ui/dynamic-composer.ts').replaceAll('\\', '/'))};
window.mountDynamicComposer = () => {
  const app = document.createElement('div');
  app.className = 'app'; app.dataset.theme = 'dark'; app.dataset.glass = 'liquid';
  document.body.append(app);
  const composer = createDynamicComposer(app, id => { window.dynamicPublished = id; });
  composer.open();
};`);
await build({ configFile: false, publicDir: false, logLevel: 'error', build: { outDir: out, emptyOutDir: false, lib: { entry, name: 'dynamicComposerHarness', formats: ['iife'], fileName: () => 'composer.js' } } });
const css = readdirSync('src/content/styles').filter(name => name.endsWith('.css')).sort().map(name => readFileSync(join('src/content/styles', name), 'utf8')).join('\n') + readFileSync('src/content/takeover.css', 'utf8');
const ext = resolve('dist'), checks = [], errors = [], posts = [];
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-composer-')), { channel: 'chromium', headless: true, viewport: { width: 1440, height: 1000 }, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
try {
  await installMocks(ctx, url => {
    if (url.includes('upload_bfs')) return { code: 0, data: { image_url: 'https://i0.hdslb.com/bfs/mock/a.png', image_width: 100, image_height: 100 } };
    if (url.includes('create/dyn')) return { code: 0, data: { dyn_id_str: '123456789' } };
  });
  await ctx.addCookies([{ name: 'bili_jct', value: 'fixture-only', domain: '.bilibili.com', path: '/' }]);
  const worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': { intro: false, theme: 'dark', glass: 'liquid', bg: { mode: 'off' } } }));
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (r.method() === 'POST') posts.push({ url: r.url(), body: r.postData() }); });
  await page.goto('https://t.bilibili.com/');
  await page.locator('.fd-list .dy').first().waitFor();
  await page.locator('.fd-post').evaluate(button => button.click());
  await page.waitForFunction(() => location.search.includes('compose=1') && document.querySelector('.bili-dyn-publishing'));
  assert(await page.locator('.bili-dyn-publishing__title__input').count());
  assert(await page.locator('.bili-topic-search__input').count());
  assert.equal(await page.locator('.dynamic-composer').count(), 0);
  checks.push('feed opens the complete native composer with title and topic support');
  await page.screenshot({ path: join(out, 'native-composer.png') });

  await page.goto('https://t.bilibili.com/?margin=off');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ path: join(out, 'composer.js') });
  await page.evaluate(() => window.mountDynamicComposer());
  await page.getByRole('textbox', { name: '动态内容' }).fill('扩展内发布验证');
  await page.getByLabel('添加动态图片').setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC1sAAAAASUVORK5CYII=', 'base64') });
  await page.locator('.dc-picture img').waitFor();
  assert.equal(posts.length, 0);
  checks.push('attachment preview does not upload before confirmation');
  const bounds = await page.getByRole('dialog', { name: '发动态', exact: true }).boundingBox();
  assert(bounds.x >= 0 && bounds.x + bounds.width <= 1440);
  await page.screenshot({ path: join(out, 'dark.png') });
  await page.getByRole('button', { name: '发布', exact: true }).click();
  await page.waitForFunction(() => window.dynamicPublished === '123456789');
  assert.equal(posts.filter(p => p.url.includes('upload_bfs')).length, 1);
  assert.equal(posts.filter(p => p.url.includes('create/dyn')).length, 1);
  const payload = JSON.parse(posts.find(p => p.url.includes('create/dyn')).body);
  assert.equal(payload.dyn_req.scene, 2);
  assert.equal(payload.dyn_req.pics.length, 1);
  assert.equal(payload.dyn_req.content.contents[0].raw_text, '扩展内发布验证');
  checks.push('one sequential upload followed by one image-post request with actual source payload');
  assert.deepEqual(errors, []);
  checks.push('no extension page errors');
  console.log(JSON.stringify({ passed: checks.length }));
} finally {
  writeFileSync(join(out, 'report.json'), JSON.stringify({ passed: checks.length, checks, errors, scope: 'Installed dist for the native composer entry and an isolated source-level publisher with mocked HTTP. No real dynamic published.' }, null, 2));
  await ctx.close();
}
