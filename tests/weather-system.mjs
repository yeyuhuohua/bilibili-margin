import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { apiBody, installMocks } from './mocks.mjs';

const ext = resolve(process.env.SMOKE_EXT || 'dist'), out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/weather-system');
mkdirSync(out, { recursive: true });
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-weather-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, viewport: { width: 1440, height: 1000 }, locale: 'zh-CN',
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const results = [], errors = [], requests = [], forecasts = [];
let ipFails = true, forecastFails = false, ips = 0, ipDelay = 0;
try {
  await installMocks(ctx);
  await ctx.route('https://ipwho.is/**', async route => {
    ips++; if (ipDelay) await new Promise(resolve => setTimeout(resolve, ipDelay));
    await route.fulfill({ status: ipFails ? 503 : 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ success: true, city: 'Shanghai', latitude: 31.23, longitude: 121.47 }) }).catch(() => {});
  });
  await ctx.route('https://api.open-meteo.com/**', route => {
    const url = route.request().url(); forecasts.push(new URL(url).searchParams.get('latitude'));
    return route.fulfill({ status: forecastFails ? 503 : 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(apiBody(url)) });
  });
  ctx.on('request', request => requests.push(request.url()));
  const worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  const seed = patch => worker.evaluate(async patch => { const s = (await chrome.storage.local.get('margin:settings'))['margin:settings']; await chrome.storage.local.set({ 'margin:settings': { ...s, ...patch } }); }, patch);
  const state = () => worker.evaluate(async () => (await chrome.storage.local.get('margin:weather-location-v2'))['margin:weather-location-v2']);
  await seed({ intro: false, theme: 'dark', weather: false, footprint: true, privacyExternal: false, bg: { mode: 'off' }, reduceMotion: true });
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto('https://www.bilibili.com/'); await page.locator('.card:not(.sk)').first().waitFor();
  const index = readdirSync(join(ext, 'pages')).find(file => file.endsWith('.js') && readFileSync(join(ext, 'pages', file), 'utf8').includes('35.3036,113.9268'));
  assert(index, 'city data should be an independent chunk');
  assert(!requests.some(url => url.endsWith(index))); results.push('city index is not loaded with a weather-disabled homepage');
  await seed({ weather: true, privacyExternal: true });
  await page.locator('.wx').getByRole('button', { name: '选择城市', exact: true }).waitFor();
  assert.equal(ips, 1); assert.equal(forecasts.length, 0); assert.equal((await state())?.loc ?? null, null);
  results.push('IP failure displays recovery controls, without saving Shanghai or requesting a fake forecast');
  ipDelay = 9000; await page.locator('.wx').getByRole('button', { name: '重试', exact: true }).click();
  await page.locator('.wx').getByText('天气请求超时，请重试').waitFor({ timeout: 12000 }); ipDelay = 0;
  assert.equal((await state())?.loc ?? null, null); results.push('network timeout leaves recoverable controls instead of an endless loading skeleton');
  await page.locator('.wx').getByRole('button', { name: '选择城市', exact: true }).click();
  const query = page.locator('.wx').getByRole('searchbox', { name: '天气城市' });
  await query.fill('珠海'); await query.press('Enter');
  const option = page.locator('.wx [role="option"]').filter({ hasText: '广东省' }).first(); await option.waitFor();
  assert.equal(requests.filter(url => url.includes('geocoding-api')).length, 0);
  assert(requests.some(url => url.endsWith(index)));
  await option.focus(); await page.keyboard.press('Enter');
  await page.locator('.wx-city').filter({ hasText: '珠海市' }).waitFor();
  assert.equal((await state()).loc.lat, 22.2716); assert.equal(forecasts.at(-1), '22.2716');
  results.push('offline city matching loads on demand, supports keyboard selection and queries the selected coordinates');
  const space = await ctx.newPage(); space.on('pageerror', e => errors.push(e.message));
  await space.goto('https://space.bilibili.com/2');
  await space.locator('.top .hd-settings').click(); await space.getByRole('tab', { name: '首页', exact: true }).click();
  await space.getByRole('button', { name: /天气城市与卡片信息/ }).click();
  const spaceInput = space.getByRole('searchbox', { name: '天气城市', exact: true });
  await spaceInput.waitFor(); assert.equal(await spaceInput.inputValue(), '珠海市');
  await spaceInput.fill('北京市朝阳区'); await spaceInput.press('Enter');
  await space.locator('.city-list [role="option"]').filter({ hasText: '北京市' }).first().click();
  await page.locator('.wx-city').filter({ hasText: '朝阳' }).waitFor();
  assert.equal((await state()).loc.lat, 39.9215); assert.equal(ips, 2);
  await space.close(); results.push('settings on another Bilibili subdomain share and update the selected city without another IP request');
  await page.bringToFront(); await page.locator('.wx').scrollIntoViewIfNeeded();
  const cdp = await ctx.newCDPSession(page), worlds = [];
  cdp.on('Runtime.executionContextCreated', ({ context }) => worlds.push(context)); await cdp.send('Runtime.enable');
  let world;
  for (const candidate of worlds) {
    const probe = await cdp.send('Runtime.evaluate', { contextId: candidate.id, returnByValue: true,
      expression: `globalThis.chrome?.runtime?.id === ${JSON.stringify(new URL(worker.url()).host)}` });
    if (probe.result.value) { world = candidate; break; }
  }
  assert(world, 'actual extension execution context is available'); forecastFails = true;
  await cdp.send('Runtime.evaluate', { contextId: world.id,
    expression: 'Date.now = ((now) => () => now() + 31 * 60_000)(Date.now); document.dispatchEvent(new Event("visibilitychange"));' });
  await page.locator('.wx-live').getByText(/待更新/).waitFor();
  assert(await page.locator('.wx-city').isVisible());
  results.push('failed background refresh retains the selected city and displays the last update time');
  await page.locator('.wx').screenshot({ path: join(out, 'stale-dark.png') });
  await page.locator('.wx-city').click(); await query.fill('新乡'); await query.press('Enter');
  await page.locator('.wx [role="option"]').filter({ hasText: '河南省' }).first().click();
  await page.locator('.wx').getByRole('button', { name: '重试', exact: true }).waitFor();
  assert(await page.locator('.wx').getByRole('button', { name: '选择城市', exact: true }).isVisible());
  await page.locator('.wx').screenshot({ path: join(out, 'forecast-failed.png') });
  forecastFails = false; await page.locator('.wx').getByRole('button', { name: '重试', exact: true }).click();
  await page.locator('.wx-city').filter({ hasText: '新乡市' }).waitFor();
  assert.equal(forecasts.at(-1), '35.3036'); results.push('failed forecasts retain both recovery actions and retry succeeds for the newly selected city');
  await seed({ theme: 'light' }); await page.waitForTimeout(150);
  await page.locator('.wx').screenshot({ path: join(out, 'success-light.png') });
  assert.equal(ips, 2); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: results.length, results, ips, forecasts }));
} finally { writeFileSync(join(out, 'results.json'), JSON.stringify({ results, errors, ips, forecasts }, null, 2)); await ctx.close(); }
