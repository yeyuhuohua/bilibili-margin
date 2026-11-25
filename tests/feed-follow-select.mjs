// 左侧「关注」列表是固定侧栏，任何滚动位置都能点：切 UP 后要回到顶部，并同步顶部头像条的选中态。
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { installMocks } from './mocks.mjs';

const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/feed-follow-select');
mkdirSync(out, { recursive: true });
const ext = resolve(process.env.SMOKE_EXT || 'dist');
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-feed-select-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, viewport: { width: 1440, height: 1000 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const results = [], errors = [];
let worker;
const seed = (patch) => worker.evaluate(async (patch) => { const saved = (await chrome.storage.local.get('margin:settings'))['margin:settings']; await chrome.storage.local.set({ 'margin:settings': { ...saved, ...patch } }); }, patch);
try {
  await installMocks(ctx);
  worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  await seed({ intro: false, weather: false, footprint: false, feedLayout: 'classic', feedFollowList: true, bg: { mode: 'off' }, theme: 'dark' });
  const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('https://t.bilibili.com/');
  const root = page.locator('#margin-root');
  const app = root.locator('.app');
  const rows = root.locator('.fd-follows button[title]'); await rows.first().waitFor();
  const strip = root.locator('.fd-main > .fd-ups');
  const pressed = () => strip.locator('.fd-up[aria-pressed="true"]').getAttribute('title');
  // 离线数据流不长：把列表撑高，确保页面真的能滚到中段
  await root.locator('.fd-list').evaluate((el) => { el.style.minHeight = '2600px'; });
  const scrollTo = (top) => app.evaluate((el, top) => { el.scrollTop = top; }, top);
  const atTop = () => page.waitForFunction(() => document.getElementById('margin-root')?.shadowRoot?.querySelector('.app')?.scrollTop === 0, null, { timeout: 5000 });

  let picked = 0;
  // 深浅主题各点一个不同的 UP（再点同一个是取消选择）
  for (const [theme, index] of [['dark', 2], ['light', 5]]) {
    await seed({ theme });
    await scrollTo(900);
    assert.equal(await app.evaluate((el) => el.scrollTop), 900, 'feed must be scrolled mid-way before selecting');
    const name = await rows.nth(index).getAttribute('title');
    picked = index;
    await rows.nth(index).click(); await atTop();
    assert.ok((await pressed())?.startsWith(name), `${theme}: strip must highlight ${name} after selecting it from the follow list`);
    results.push(`${theme}: follow-list selection scrolls back to the top and highlights the creator in the strip`);
  }
  // 再点同一个 UP 回到「全部动态」：同样回顶，头像条高亮回到「全部动态」
  await scrollTo(900);
  await rows.nth(picked).click(); await atTop();
  assert.equal(await pressed(), '全部动态');
  results.push('deselecting returns to all updates at the top with the strip reset');
  await page.screenshot({ path: join(out, 'classic-after-select.png') });
  assert.deepEqual(errors, []);
  results.forEach((result) => console.log('PASS ' + result));
} finally {
  writeFileSync(join(out, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  await ctx.close();
}
