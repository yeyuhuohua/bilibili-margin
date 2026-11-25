// Native Firefox rendering of the production drawer component; no add-on installation or network.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { firefox } from 'playwright';
import { build } from 'vite';

const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/folder-pocket');
mkdirSync(out, { recursive: true });
const bundle = await build({ configFile: false, publicDir: false, logLevel: 'error', build: {
  write: false, lib: { entry: resolve('src/content/ui/glass-folder.ts'), name: 'folders', formats: ['iife'] },
} });
const css = ['01-base', '04-glass-folder', '09-appearance'].map(n => readFileSync(`src/content/styles/${n}.css`, 'utf8')).join('\n');
const cover = readFileSync(new URL('./fixtures/folder-cover.svg', import.meta.url));
const browser = await firefox.launch({ headless: true });
const checks = [], errors = [], check = (name, ok) => { assert.ok(ok, name); checks.push(name); };
try {
  const page = await browser.newPage({ viewport: { width: 780, height: 590 }, reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('http://folder.test/**', r => r.request().resourceType() === 'image' ? r.fulfill({ contentType: 'image/svg+xml', body: cover }) : r.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="UTF-8"><div id="host"></div>' }));
  await page.goto('http://folder.test/');
  await page.addScriptTag({ content: (Array.isArray(bundle) ? bundle[0] : bundle).output.find(x => x.type === 'chunk').code });
  await page.evaluate(css => {
    const tree = document.getElementById('host').attachShadow({ mode: 'open' });
    const style = document.createElement('style'); style.textContent = css;
    const app = document.createElement('main'); app.className = 'app'; app.dataset.glass = 'liquid'; app.dataset.theme = 'dark';
    tree.append(style, app);
    app.append(folders.glassFolder({ label: '北岸档案', meta: '1 个视频', image: 'http://folder.test/cover.svg', files: [{ name: '北岸', href: 'http://folder.test/view' }] }).el);
  }, css);
  const card = page.locator('.gf-root[data-entered]'), stage = card.locator('.gf-stage'), hit = card.locator('.gf-hit');
  await card.locator('.gf-back img').evaluate(img => img.decode());
  const liquid = await stage.screenshot({ path: join(out, 'firefox-fallback.png') });
  check('liquid uses no optical filter or filter node in Firefox', await card.locator('.gf-lip').evaluate(el => getComputedStyle(el).backdropFilter === 'none' && !el.getRootNode().querySelector('#gf-prism')));
  await page.locator('.app').evaluate(el => { el.dataset.glass = 'soft'; });
  check('Firefox liquid fallback is visually identical to soft', (await stage.screenshot()).equals(liquid));
  await hit.focus(); await page.keyboard.press('Enter');
  check('keyboard activation expands the real fan in fallback', await hit.getAttribute('aria-expanded') === 'true' && !await card.locator('.gf-files').evaluate(el => el.inert));
  await page.keyboard.press('Escape');
  check('Escape restores focus without requiring refraction support', await hit.evaluate(el => el.matches(':focus') && el.getAttribute('aria-expanded') === 'false'));
  check('no uncaught Firefox errors', !errors.length);
  const result = { browser: 'Firefox ' + browser.version(), scope: 'Production folder in an isolated ShadowRoot; no Firefox add-on installation', checks, errors };
  writeFileSync(join(out, 'firefox.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser.close(); }
