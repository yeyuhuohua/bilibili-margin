import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installMocks } from './mocks.mjs';

const extension = resolve(process.env.SMOKE_EXT || 'dist');
const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/app-feed-time');
mkdirSync(out, { recursive: true });
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-app-time-')), {
  channel: 'chromium', headless: true, viewport: { width: 1440, height: 1000 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
const checks = [], errors = [], details = [];
try {
  await installMocks(context, address => {
    if (new URL(address).pathname === '/x/web-interface/view') details.push(address);
    return null;
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(async () => {
    await chrome.storage.local.set({ 'margin:settings': {
      intro: false, appFeed: true, weather: false, footprint: false, bg: { mode: 'off' }, reduceMotion: true,
    } });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (address, options) => {
      const url = new URL(String(address));
      if (url.hostname !== 'app.bilibili.com') return originalFetch(address, options);
      const start = Number(url.searchParams.get('idx'));
      const items = Array.from({ length: 15 }, (_, i) => {
        const idx = start + i + 1;
        const label = ['昨天 10:25', '11月10日', '3小时前', '100万播放'][i % 4];
        return { goto: 'av', card_goto: 'av', param: String(idx), idx,
          bvid: `BV${String(idx).padStart(10, '0')}`, title: `时间回归 ${idx}`, cover: 'https://i0.hdslb.com/cover.jpg',
          args: { up_id: 1, up_name: '测试 · 作者' }, player_args: { aid: idx, cid: idx, duration: 125 },
          desc: `测试 · 作者 · ${label}`, cover_left_text_1: '100', cover_left_text_2: '20',
        };
      });
      return Promise.resolve(new Response(JSON.stringify({ code: 0, data: { items } }), { status: 200 }));
    };
  });
  const page = context.pages()[0];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://www.bilibili.com/');
  const cards = page.locator('#margin-root .home main .grid .card:not(.sk)');
  await cards.first().locator('.pubtime').waitFor();
  await cards.first().scrollIntoViewIfNeeded();
  assert.equal(await cards.nth(0).locator('.pubtime').textContent(), '昨天 10:25');
  assert.equal(await cards.nth(1).locator('.pubtime').textContent(), '11月10日');
  assert.equal(await cards.nth(2).locator('.pubtime').textContent(), '3小时前');
  assert.equal(await cards.nth(3).locator('.pubtime').count(), 0);
  assert.equal(await cards.first().locator('.pubtime').getAttribute('datetime'), null);
  checks.push('native App labels reach rendered cards without fabricated timestamps');
  assert.equal(await cards.first().locator('.dur').innerText(), '2:05');
  checks.push('video duration remains independent of publication date');
  await cards.first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(out, 'app-time.png') });
  await worker.evaluate(async () => {
    const stored = await chrome.storage.local.get('margin:settings');
    await chrome.storage.local.set({ 'margin:settings': { ...stored['margin:settings'], homeHide: ['ago', 'dur'] } });
  });
  await cards.first().locator('.pubtime').waitFor({ state: 'detached' });
  assert.equal(await cards.first().locator('.dur').count(), 0);
  checks.push('existing hide-date and hide-duration settings are respected');
  await worker.evaluate(async () => {
    const stored = await chrome.storage.local.get('margin:settings');
    await chrome.storage.local.set({ 'margin:settings': { ...stored['margin:settings'], appFeed: false, homeHide: [] } });
  });
  await cards.first().locator('.pubtime[datetime]').waitFor();
  assert(Number.isFinite(Date.parse(await cards.first().locator('.pubtime').getAttribute('datetime'))));
  checks.push('Web recommendation timestamps continue to render');
  assert.deepEqual(details, []);
  checks.push('date display adds no per-video detail requests');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks, errors }));
} finally {
  writeFileSync(join(out, 'report.json'), JSON.stringify({ checks, errors, details }, null, 2));
  await context.close();
}
