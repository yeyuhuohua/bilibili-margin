import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const extension = resolve(process.env.SMOKE_EXT || 'dist');
const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/popup-version');
mkdirSync(out, { recursive: true });
const manifest = JSON.parse(readFileSync(join(extension, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = readFileSync('pnpm-lock.yaml', 'utf8');
assert.equal(manifest.version, pkg.version);
assert.match(lock, /^lockfileVersion: /m);
assert.match(lock, /^importers:/m);
const parts = manifest.version.split('.').map(Number);
const nextVersion = [parts[0], parts[1], (parts[2] || 0) + 1].join('.');
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-version-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
const results = [];
let release, requests = 0;
try {
  await context.route('https://api.github.com/repos/jiuyang5354/bilibili-margin/releases/latest', route => {
    requests++;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(release) });
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': { privacyExternal: true } }));
  const page = await context.newPage();
  const popup = `chrome-extension://${new URL(worker.url()).hostname}/popup.html`;
  for (const [name, tag, label, update] of [
    ['current-release', manifest.version, `v${manifest.version_name || manifest.version}`, false],
    ['older-release', '0.52.0', 'v0.52.0', false],
    ['newer-display-name', nextVersion, `Preview ${nextVersion}`, true],
  ]) {
    release = { tag_name: `v${tag}`, name: label, html_url: `https://github.com/jiuyang5354/bilibili-margin/releases/tag/v${tag}` };
    await worker.evaluate(() => chrome.storage.local.remove('margin:update-check'));
    const before = requests;
    await page.goto(popup);
    await page.waitForFunction(() => document.querySelector('#ver')?.textContent);
    await page.waitForFunction(async () => !!(await chrome.storage.local.get('margin:update-check'))['margin:update-check']);
    await page.waitForTimeout(50);
    assert.equal(await page.locator('#ver').textContent(), manifest.version_name || manifest.version);
    assert.equal(requests, before + 1);
    assert.equal(await page.locator('#upd').evaluate(node => node.classList.contains('on')), update);
    if (update) {
      assert.equal(await page.locator('#updv').textContent(), label);
      assert.equal(await page.locator('#upd').getAttribute('href'), release.html_url);
    }
    results.push(name); console.log(`PASS ${name}`);
  }
  await worker.evaluate(tag => chrome.storage.local.set({ 'margin:update-check': {
    at: Date.now(), tag, url: `https://github.com/jiuyang5354/bilibili-margin/releases/tag/v${tag}`,
  } }), nextVersion);
  const before = requests;
  await page.goto(popup);
  await page.locator('#upd.on').waitFor();
  assert.equal(await page.locator('#updv').textContent(), `v${nextVersion}`);
  assert.equal(requests, before);
  results.push('legacy-cache'); console.log('PASS legacy-cache');
  await page.screenshot({ path: join(out, 'popup.png') });
} finally { writeFileSync(join(out, 'results.json'), JSON.stringify({ version: manifest.version, display: manifest.version_name, results }, null, 2)); await context.close(); }
