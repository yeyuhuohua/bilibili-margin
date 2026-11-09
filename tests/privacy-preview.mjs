// All pages, accounts and credentials in this test are fixtures. No live account is used.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { build } from 'vite';
import { installMocks } from './mocks.mjs';

const out = resolve(process.env.SMOKE_OUT || 'artifacts/privacy-runtime');
mkdirSync(out, { recursive: true });
const ext = resolve(process.env.SMOKE_EXT || 'dist');
const profile = mkdtempSync(join(tmpdir(), 'margin-privacy-'));
const results = [], errors = [], externalRequests = [];
const hosts = new Set(['ipwho.is', 'api.open-meteo.com', 'geocoding-api.open-meteo.com', 'bsbsb.top', 'api.github.com']);
const fixtureToken = 'privacy_fixture_credential_1234567890';
const launch = () => chromium.launchPersistentContext(profile, {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, viewport: { width: 1440, height: 1000 }, colorScheme: 'dark', locale: 'zh-CN',
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
async function check(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, ok: false, error: error.message }); console.log(`FAIL ${name}: ${error.message}`); }
}
let context = await launch();
try {
  await installMocks(context);
  context.on('request', request => {
    if (hosts.has(new URL(request.url()).hostname)) externalRequests.push({ url: request.url(), headers: request.headers() });
  });
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': { intro: false, bg: { mode: 'off' } } }));
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const executionContexts = [];
  cdp.on('Runtime.executionContextCreated', ({ context }) => executionContexts.push(context));
  await cdp.send('Runtime.enable');
  await page.goto('https://www.bilibili.com/', { waitUntil: 'domcontentloaded' });
  await page.locator('#margin-root .grid .card').first().waitFor();
  const send = message => popup.evaluate(message => chrome.runtime.sendMessage(message), message);
  const local = key => worker.evaluate(key => chrome.storage.local.get(key), key);

  await check('default optional services make no requests', async () => {
    await page.locator('#margin-root .wx-empty').filter({ hasText: '天气联网已关闭' }).waitFor();
    assert.equal(externalRequests.length, 0);
    assert.equal((await send({ margin: 'privacy', op: 'history-remember', query: 'not-saved' })).entries.length, 0);
    assert.equal((await local('margin:private-search-history'))['margin:private-search-history'], undefined);
  });

  await page.locator('#margin-root .top [aria-label="设置"]').click();
  await check('privacy controls render and match defaults', async () => {
    await page.waitForTimeout(700);
    assert.equal(await page.getByRole('switch', { name: '允许外部辅助服务', exact: true }).getAttribute('aria-checked'), 'false');
    assert.equal(await page.getByRole('switch', { name: '保存最近搜索', exact: true }).getAttribute('aria-checked'), 'false');
    const control = await page.getByRole('switch', { name: '允许外部辅助服务', exact: true }).boundingBox();
    assert(control && control.x >= 0 && control.x + control.width <= 1440);
    await page.screenshot({ path: join(out, 'privacy-settings-dark.png') });
  });

  await check('history stores only inside extension and expires', async () => {
    await page.getByRole('switch', { name: '保存最近搜索', exact: true }).click();
    await popup.waitForFunction(() => chrome.storage.local.get('margin:settings').then(data => data['margin:settings'].searchHistory === true));
    const response = await send({ margin: 'privacy', op: 'history-remember', query: 'privacy-preview-search' });
    assert.equal(response.entries[0].text, 'privacy-preview-search');
    assert.equal(await page.evaluate(() => localStorage.getItem('margin:search-history')), null);
    await worker.evaluate(() => chrome.storage.local.set({ 'margin:private-search-history': [{ text: 'expired', at: Date.now() - 31 * 86400000 }, { text: 'current', at: Date.now() }] }));
    assert.deepEqual((await send({ margin: 'privacy', op: 'history-read' })).entries.map(entry => entry.text), ['current']);
  });

  await check('clear and disable remove history without clearing settings', async () => {
    await page.getByRole('button', { name: '清除搜索记录', exact: true }).click();
    await popup.waitForFunction(() => chrome.storage.local.get('margin:private-search-history').then(data => !data['margin:private-search-history']));
    await send({ margin: 'privacy', op: 'history-remember', query: 'second-search' });
    await page.getByRole('switch', { name: '保存最近搜索', exact: true }).click();
    await popup.waitForFunction(() => chrome.storage.local.get('margin:private-search-history').then(data => !data['margin:private-search-history']));
    assert.equal((await local('margin:settings'))['margin:settings'].intro, false);
  });

  await check('optional-service opt-in and opt-out work in the rendered page', async () => {
    await context.addCookies([{ name: 'fixture_private_cookie', value: 'never-send-this', domain: '.ipwho.is', path: '/', secure: true }]);
    await page.getByRole('switch', { name: '允许外部辅助服务', exact: true }).click();
    await page.locator('#margin-root .wx-place').waitFor();
    assert(externalRequests.some(request => new URL(request.url).host === 'ipwho.is'));
    assert(externalRequests.some(request => new URL(request.url).host === 'api.open-meteo.com'));
    for (const request of externalRequests) { assert(!request.headers.cookie); assert(!request.headers.referer); }
    await page.getByRole('switch', { name: '允许外部辅助服务', exact: true }).click();
    await page.locator('#margin-root .wx-empty').filter({ hasText: '天气联网已关闭' }).waitFor();
    const before = externalRequests.length;
    await popup.reload();
    await page.waitForTimeout(250);
    assert.equal(externalRequests.length, before);
  });

  await check('App credentials live in session storage and stay out of local exports', async () => {
    const accepted = await send({ margin: 'app', op: 'save', key: fixtureToken, mid: 123, expiresIn: 3600 });
    assert.equal(accepted.ok, true);
    const state = await send({ margin: 'app', op: 'state' });
    assert.equal(state.authed, true); assert(!JSON.stringify(state).includes(fixtureToken));
    const stored = await worker.evaluate(() => chrome.storage.local.get(null));
    assert(!JSON.stringify(stored).includes(fixtureToken));
    assert.equal((await worker.evaluate(() => chrome.storage.session.get('margin:app-auth')))['margin:app-auth'].key, fixtureToken);
    assert.equal((await send({ margin: 'app', op: 'save', key: 'invalid', mid: -1, expiresIn: Infinity })).ok, false);
  });

  await check('content scripts cannot read background session credentials', async () => {
    let contentContext;
    for (const candidate of executionContexts) {
      try {
        const probe = await cdp.send('Runtime.evaluate', { contextId: candidate.id, expression: `typeof chrome !== 'undefined' && chrome.runtime?.id === ${JSON.stringify(id)}`, returnByValue: true });
        if (probe.result.value === true) contentContext = candidate;
      } catch { /* Navigation may destroy an old execution context. */ }
    }
    assert(contentContext, 'extension content-script context not found');
    const probe = await cdp.send('Runtime.evaluate', { contextId: contentContext.id, expression: `(async()=>{try{await chrome.storage.session.get('margin:app-auth');return 'readable'}catch{return 'blocked'}})()`, awaitPromise: true, returnByValue: true });
    assert.equal(probe.result.value, 'blocked');
  });

  await check('actual DOM helpers strip injected content and unsafe links', async () => {
    const entry = join(out, 'fixture.ts');
    writeFileSync(entry, `import {h,highlight} from ${JSON.stringify(resolve('src/content/ui/dom.ts'))}; import {dynCard} from ${JSON.stringify(resolve('src/content/ui/dyn.ts'))}; Object.assign(window,{privacyFixture:{h,highlight,dynCard}});`);
    const built = await build({ configFile: false, publicDir: false, logLevel: 'error', build: { write: false, minify: false, lib: { entry, formats: ['iife'], name: 'privacyFixture' } } });
    const code = (Array.isArray(built) ? built : [built]).flatMap(result => result.output ?? []).find(chunk => chunk.type === 'chunk').code;
    await page.addScriptTag({ content: code });
    const result = await page.evaluate(() => {
      const { h, highlight, dynCard } = window.privacyFixture;
      const el = document.createElement('div');
      highlight(el, '<em class="suggest_high_light" onclick="alert(1)">safe</em><img src="https://privacy-fixture.invalid/pixel"><iframe src="https://privacy-fixture.invalid/"></iframe><script>alert(1)</script>');
      const dynamic = { id: '1', text: '动态', pics: [], url: 'java\nscript:alert(1)' };
      const card = dynCard(dynamic, true);
      const validCard = dynCard({ ...dynamic, url: 'https://www.bilibili.com/opus/1' }, true);
      return { text: el.textContent, markup: el.innerHTML, bad: h('a', { href: 'java\nscript:alert(1)' }).hasAttribute('href'), good: h('a', { href: 'https://www.bilibili.com/' }).getAttribute('href'), badCard: card.hasAttribute('data-href'), goodCard: validCard.dataset.href };
    });
    assert.equal(result.text, 'safe'); assert.equal(result.markup, '<mark>safe</mark>'); assert.equal(result.bad, false); assert.equal(result.good, 'https://www.bilibili.com/');
    assert.equal(result.badCard, false); assert.equal(result.goodCard, 'https://www.bilibili.com/opus/1');
  });

  await check('auth revoke removes the credential', async () => {
    assert.equal((await send({ margin: 'app', op: 'revoke' })).ok, true);
    assert.equal((await send({ margin: 'app', op: 'state' })).authed, false);
    await send({ margin: 'app', op: 'save', key: fixtureToken, mid: 123, expiresIn: 3600 });
  });
  await worker.evaluate(async () => {
    const settings = (await chrome.storage.local.get('margin:settings'))['margin:settings'];
    await chrome.storage.local.set({ 'margin:settings': { ...settings, theme: 'light' } });
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(out, 'privacy-settings-light.png') });

  await context.close();
  context = await launch();
  await installMocks(context);
  const restartedWorker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await check('browser restart clears the App session credential', async () => {
    assert.equal((await restartedWorker.evaluate(() => chrome.storage.session.get('margin:app-auth')))['margin:app-auth'], undefined);
    const reopened = await context.newPage();
    await reopened.goto(`chrome-extension://${new URL(restartedWorker.url()).host}/popup.html`);
    assert.equal((await reopened.evaluate(() => chrome.runtime.sendMessage({ margin: 'app', op: 'state' }))).authed, false);
  });
} finally {
  await context.close();
  writeFileSync(join(out, 'results.json'), JSON.stringify({ results, errors, externalRequests }, null, 2));
}
assert.equal(results.filter(result => !result.ok).length, 0, 'privacy runtime checks failed');
assert.deepEqual(errors, []);
