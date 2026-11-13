// Synthetic credentials only. Exercises the built extension and real browser restarts.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { installMocks } from './mocks.mjs';

const out = resolve(process.env.SMOKE_OUT || 'delivery/app-auth-remember');
mkdirSync(out, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'margin-remember-'));
const ext = resolve('dist');
const token = 'fixture_remember_token_123456789';
const checks = [];
let context, popup, worker;
const send = message => popup.evaluate(message => chrome.runtime.sendMessage({ margin: 'app', ...message }), message);
const state = () => send({ op: 'state' });
async function launch() {
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, viewport: { width: 1440, height: 1000 },
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  await installMocks(context);
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  popup = await context.newPage();
  await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
}
async function save(expiresIn = 90 * 86400) {
  assert.equal((await send({ op: 'save', key: token, mid: 123, expiresIn })).ok, true);
}
async function restart() { await context.close(); await launch(); }
try {
  await launch();
  assert.deepEqual(await state(), { ok: true, authed: false, remember: false, mid: 0, exp: 0 });
  await save();
  await restart();
  assert.equal((await state()).authed, false);
  checks.push('default-off credentials disappear after browser restart');

  await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': { intro: false, weather: false, footprint: false, bg: { mode: 'off' } } }));
  const page = await context.newPage();
  await page.goto('https://www.bilibili.com/');
  await page.locator('#margin-root .top [aria-label="设置"]').click();
  await page.locator('#margin-root .sheet[aria-label="设置"]').getByRole('tab', { name: '实验功能', exact: true }).click();
  await page.locator('#margin-root .sd-head').filter({ hasText: 'App 授权' }).click();
  const toggle = page.getByRole('switch', { name: '记住授权', exact: true });
  assert.equal(await toggle.getAttribute('aria-checked'), 'false');
  await toggle.click();
  await page.waitForFunction(() => document.getElementById('margin-root').shadowRoot.querySelector('[aria-label="记住授权"]').disabled === false);
  assert.equal((await state()).remember, true);
  await page.screenshot({ path: join(out, 'remember-settings.png') });
  checks.push('rendered settings switch defaults off and saves opt-in');

  await save();
  const deadline = (await state()).exp;
  assert(Math.abs(deadline - Math.floor(Date.now() / 1000) - 30 * 86400) < 3);
  await restart();
  assert.equal((await state()).authed, true);
  assert.equal((await state()).exp, deadline);
  assert(!JSON.stringify(await state()).includes(token));
  assert(!JSON.stringify(await worker.evaluate(() => chrome.storage.local.get(null))).includes(token));
  checks.push('remembered login survives restart, caps at 30 days and stays out of public state/local storage');

  await save(3600);
  assert(Math.abs((await state()).exp - Math.floor(Date.now() / 1000) - 3600) < 3);
  checks.push('shorter server expiry wins');
  const shortDeadline = (await state()).exp;
  await send({ op: 'remember', enabled: true });
  assert.equal((await state()).exp, shortDeadline);
  checks.push('repeated opt-in does not extend expiry');
  await send({ op: 'remember', enabled: false });
  assert.equal((await state()).authed, true);
  await restart();
  assert.equal((await state()).authed, false);
  assert.equal((await state()).remember, false);
  checks.push('disabling persistence keeps current session and removes login on restart');

  await save();
  await send({ op: 'remember', enabled: true });
  await restart();
  assert.equal((await state()).authed, true);
  checks.push('existing session can be opted in');
  await send({ op: 'revoke' });
  await restart();
  assert.equal((await state()).authed, false);
  checks.push('revocation removes remembered credentials');

  await save(1);
  await new Promise(resolve => setTimeout(resolve, 1200));
  assert.equal((await state()).authed, false);
  await restart();
  assert.equal((await state()).authed, false);
  checks.push('expired credential is removed and stays removed after restart');
  assert.equal((await send({ op: 'remember', enabled: 'yes' })).ok, false);
  assert.equal((await send({ op: 'save', key: token, mid: 123, expiresIn: -1 })).ok, false);
  checks.push('invalid messages rejected');

  await save();
  await worker.evaluate(() => {
    globalThis.originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ code: -101 }), { status: 200 });
  });
  assert.equal((await send({ op: 'feed', idx: 0 })).expired, true);
  assert.equal((await state()).authed, false);
  await worker.evaluate(() => { globalThis.fetch = globalThis.originalFetch; delete globalThis.originalFetch; });
  await restart();
  assert.equal((await state()).authed, false);
  checks.push('server-invalid credentials removed from persistent storage');

  await save();
  await worker.evaluate(() => {
    globalThis.originalFetch = globalThis.fetch;
    globalThis.fetch = () => new Promise(resolve => { globalThis.finishOldFeed = () => resolve(new Response(JSON.stringify({ code: -101 }))); });
  });
  const oldFeed = send({ op: 'feed', idx: 0 });
  await popup.waitForFunction(async () => {
    const response = await chrome.runtime.sendMessage({ margin: 'app', op: 'state' });
    return response.authed;
  });
  for (let attempt = 0; attempt < 100 && !(await worker.evaluate(() => !!globalThis.finishOldFeed)); attempt++) await new Promise(resolve => setTimeout(resolve, 20));
  assert(await worker.evaluate(() => !!globalThis.finishOldFeed), 'feed request did not start');
  assert.equal((await send({ op: 'save', key: `${token}_new`, mid: 456, expiresIn: 3600 })).ok, true);
  await worker.evaluate(() => { globalThis.finishOldFeed(); globalThis.fetch = globalThis.originalFetch; delete globalThis.originalFetch; delete globalThis.finishOldFeed; });
  await oldFeed;
  assert.equal((await state()).mid, 456);
  checks.push('stale failed requests preserve a newer login');

  await Promise.all([save(), send({ op: 'remember', enabled: false }), send({ op: 'revoke' })]);
  assert.equal((await state()).authed, false);
  await restart();
  assert.equal((await state()).authed, false);
  checks.push('concurrent save/opt-out/revoke leave consistent empty state');
} finally {
  await context?.close();
  writeFileSync(join(out, 'report.json'), JSON.stringify({ passed: checks.length, checks }, null, 2));
}
console.log(JSON.stringify({ passed: checks.length, checks }));
