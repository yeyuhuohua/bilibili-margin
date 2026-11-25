// 更新提醒（v0.61）：后台定时查到新版 → 图标角标 → 页面里提醒一次 → 入口指向官方发布页。
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installMocks } from './mocks.mjs';

const extension = resolve(process.env.SMOKE_EXT || 'dist');
const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/update-reminder');
mkdirSync(out, { recursive: true });
const manifest = JSON.parse(readFileSync(join(extension, 'manifest.json'), 'utf8'));
const nextVersion = manifest.version.split('.').map((part, i) => (i === 2 ? Number(part) + 1 : Number(part))).join('.');
const releaseUrl = `https://github.com/jiuyang5354/bilibili-margin/releases/tag/v${nextVersion}`;

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-reminder-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, viewport: { width: 1440, height: 1000 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
const results = [];
/** service worker 里读扩展存储，页面上下文读不到 chrome.storage */
async function until(fn, label) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('等待超时：' + label);
}
try {
  await installMocks(context);
  await context.route('https://api.github.com/repos/jiuyang5354/bilibili-margin/releases/latest', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ tag_name: `v${nextVersion}`, name: `v${nextVersion}`, html_url: releaseUrl }),
  }));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': { intro: false, theme: 'light', bg: { mode: 'off' } } }));

  // 默认关闭：不开周期就不该有定时任务
  await worker.evaluate(() => chrome.storage.local.get('margin:settings'));
  await worker.evaluate(async () => (await chrome.alarms.getAll()).length);
  assert.equal(await worker.evaluate(async () => (await chrome.alarms.getAll()).some(alarm => alarm.name === 'margin:update-check')), false);
  results.push('默认关闭时不排定时任务');

  // 打开周期后：后台查到新版 → 记下状态 → 图标角标
  await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': { intro: false, theme: 'light', bg: { mode: 'off' }, privacyExternal: true, updateInterval: 6 } }));
  await until(async () => worker.evaluate(async () => (await chrome.alarms.getAll()).some(alarm => alarm.name === 'margin:update-check')), '定时任务');
  await until(async () => worker.evaluate(async () => !!(await chrome.storage.local.get('margin:update-reminder'))['margin:update-reminder']), '更新提醒状态');
  const state = await worker.evaluate(async () => (await chrome.storage.local.get('margin:update-reminder'))['margin:update-reminder']);
  assert.equal(state.tag, nextVersion);
  assert.equal(state.url, releaseUrl);
  assert.equal(await worker.evaluate(() => chrome.action.getBadgeText({})), '新');
  results.push('后台查到新版后记下状态并在图标上标「新」');

  // 页面上提醒一次，入口指向官方发布页
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const opened = [];
  context.on('page', p => { if (p.url().includes('github.com')) opened.push(p.url()); });
  await page.goto('https://www.bilibili.com/');
  const toast = page.locator('#margin-root').getByText(`映间有新版本 v${nextVersion}`);
  await toast.waitFor({ timeout: 20000 });
  results.push('页面里提醒一次有新版');

  await page.locator('#margin-root').getByRole('button', { name: '查看发布页' }).click();
  await until(() => opened.length > 0, '打开发布页');
  assert.equal(opened[0], releaseUrl);
  results.push('提醒里的入口指向官方发布页');

  // 看过之后不再重复弹
  const seen = await worker.evaluate(async () => (await chrome.storage.local.get('margin:update-reminder'))['margin:update-reminder']);
  assert.equal(seen.seen, true);
  const again = await context.newPage();
  await again.goto('https://www.bilibili.com/');
  await again.waitForTimeout(1500);
  assert.equal(await again.locator('#margin-root').getByText(`映间有新版本 v${nextVersion}`).count(), 0);
  results.push('看过一次之后不再重复提醒');
  await worker.evaluate(async () => {
    const key = 'margin:settings';
    const settings = (await chrome.storage.local.get(key))[key];
    await chrome.storage.local.set({ [key]: { ...settings, updateInterval: 0 } });
  });
  await until(() => worker.evaluate(async () =>
    !(await chrome.alarms.get('margin:update-check')) &&
    !(await chrome.storage.local.get('margin:update-reminder'))['margin:update-reminder'] &&
    (await chrome.action.getBadgeText({})) === ''), '关闭后清理提醒');
  results.push('关闭后清除任务、提醒与角标');
  assert.deepEqual(errors, []);
} finally {
  await context.close();
}
results.forEach(result => console.log('PASS ' + result));
