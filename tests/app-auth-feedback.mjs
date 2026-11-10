// Passport responses are mocked. No real account is authorized by this test.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installMocks } from './mocks.mjs';

const ext = resolve(process.env.SMOKE_EXT || 'dist');
const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/app-auth-feedback');
mkdirSync(out, { recursive: true });
const results = [], errors = [];
let mode = 'error', qrCount = 0, polls = [], releaseFirst;
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-auth-feedback-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, viewport: { width: 1440, height: 1000 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json',
  headers: { 'access-control-allow-origin': route.request().headers().origin || 'https://www.bilibili.com' }, body: JSON.stringify(body) });
try {
  await installMocks(context);
  await context.route('**/qrcode/auth_code', route => {
    qrCount++;
    return json(route, { code: 0, data: { url: `https://passport.bilibili.com/mock-qr/${qrCount}`, auth_code: `a${qrCount}` } });
  });
  await context.route('**/qrcode/poll', async route => {
    const code = new URLSearchParams(route.request().postData()).get('auth_code');
    polls.push(code);
    const responseMode = mode;
    if (responseMode === 'hold') {
      await new Promise(resolve => { releaseFirst = resolve; });
      return json(route, { code: -400, message: '旧二维码错误' });
    }
    if (responseMode === 'network') return json(route, { code: -1 }, 503);
    return json(route, responseMode === 'error' ? { code: -400, message: '模拟授权失败，请稍后重试' }
      : { code: responseMode === 'expired' ? 86038 : 86039, message: '' });
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': { intro: false, weather: false, footprint: false, bg: { mode: 'off' } } }));
  for (mode of ['error', 'network', 'expired', 'hold']) {
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const result = { mode, ok: false };
    results.push(result);
    polls = []; releaseFirst = undefined;
    try {
      await page.goto('https://www.bilibili.com/', { waitUntil: 'domcontentloaded' });
      await page.locator('#margin-root .top [aria-label="设置"]').click();
      await page.locator('#margin-root .sheet[aria-label="设置"]').getByRole('tab', { name: '实验功能', exact: true }).click();
      await page.locator('#margin-root .sd-head').filter({ hasText: 'App 授权' }).click();
      const button = page.locator('#margin-root .af-row').getByRole('button', { name: '扫码授权', exact: true });
      const note = page.locator('#margin-root .af-note');
      await button.click();
      await page.locator('#margin-root .af-qr svg').waitFor({ state: 'attached' });
      if (mode === 'hold') {
        await page.waitForTimeout(2300);
        assert(releaseFirst, 'initial poll did not start');
        mode = 'wait';
        await button.click();
        await page.locator('#margin-root .af-qr svg').waitFor();
        releaseFirst();
        await page.waitForTimeout(350);
        assert((await note.textContent()).includes('扫一扫'), 'old response replaced the new authorization status');
        assert(await page.locator('#margin-root .af-qr').isVisible());
        mode = 'error';
      }
      const expected = mode === 'network' ? 'HTTP 503' : mode === 'expired' ? '二维码已过期' : '模拟授权失败';
      await page.waitForFunction(expected => document.getElementById('margin-root').shadowRoot.querySelector('.af-note').textContent.includes(expected), expected, { polling: 100, timeout: 8000 });
      result.note = await note.textContent();
      const count = polls.length;
      await page.waitForTimeout(2300);
      assert.equal(polls.length, count, 'authorization polling continued after a terminal response');
      assert(await button.isEnabled());
      assert(await page.locator('#margin-root .af-qr').isHidden());
      result.polls = [...polls];
      result.ok = true;
      console.log(`PASS auth ${result.mode}`);
    } catch (error) {
      result.error = error.message;
      result.note = await page.locator('#margin-root .af-note').textContent().catch(() => null);
      result.polls = [...polls];
      console.log(`FAIL auth ${result.mode}: ${error.message}`);
    }
    finally { releaseFirst?.(); await page.screenshot({ path: join(out, `${result.mode}.png`) }); await page.close(); }
  }
} finally {
  writeFileSync(join(out, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  await context.close();
}
if (results.some(result => !result.ok) || errors.length) process.exitCode = 1;
