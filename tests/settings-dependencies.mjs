// #239 子项随母项变灰：外部辅助服务关闭、减少动画开启、控件动效关闭或搜索栏为旧版时，依赖它们的设置项变灰且不可点；母项满足后解禁且不改值。
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installMocks } from './mocks.mjs';

const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/settings-dependencies');
mkdirSync(out, { recursive: true });
const ext = resolve(process.env.SMOKE_EXT || 'dist');
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-settings-deps-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, viewport: { width: 1440, height: 1000 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const errors = [], results = [];
const isOff = (control) => control.evaluate((el) => el.closest('.row, .block')?.hasAttribute('data-off'));
const off = async (control, label) => {
  assert.equal(await control.isDisabled(), true, `${label} must be disabled`);
  assert.equal(await isOff(control), true, `${label} row must be data-off`);
};
const live = async (control, label) => {
  assert.equal(await control.isDisabled(), false, `${label} must be enabled`);
  assert.equal(await isOff(control), false, `${label} row must not be data-off`);
};
try {
  await installMocks(ctx);
  const worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('https://www.bilibili.com/');
  await page.locator('#margin-root .top [aria-label="设置"]').click();
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  const tab = (name) => dialog.getByRole('tab', { name, exact: true });
  const sw = (name) => dialog.getByRole('switch', { name, exact: true });
  const palSpeed = dialog.getByRole('spinbutton', { name: '搜索框展开速度（%）' });
  const interval = dialog.getByRole('radio', { name: '每天', exact: true });
  const external = sw('允许外部辅助服务'), weather = sw('天气'), sponsor = sw('跳过视频内广告');
  const reduce = sw('减少动画'), effects = sw('控件动效'), intro = sw('首页过场动画'), drag = sw('账号卡片可拖拽');

  // 默认设置：外部服务关、旧版搜索栏。首次打开不走 sync()，依赖状态必须已经画好。
  await tab('搜索与顶栏').click(); await off(palSpeed, 'palette speed under classic search');
  await tab('隐私与数据').click(); await off(interval, 'update reminder');
  await tab('首页').click(); await off(weather, 'weather');
  await tab('内容过滤').click(); await off(sponsor, 'sponsor skip');
  await tab('隐私与数据').click(); await page.waitForTimeout(350); await page.screenshot({ path: join(out, 'external-off.png') });
  results.push('dependent controls greyed out on first open while external services are off');

  // 「检查更新」不受影响：外部服务关闭时保持可点，由它自己提示去哪里开启
  await tab('总览').click(); await live(dialog.getByRole('button', { name: '检查更新', exact: true }), 'check update');
  results.push('manual update check stays clickable while external services are off');

  // 打开外部服务：三个子项一起解禁，各自的值不变
  await tab('隐私与数据').click();
  assert.equal(await external.getAttribute('aria-checked'), 'false');
  await external.click();
  assert.equal(await external.getAttribute('aria-checked'), 'true');
  await live(interval, 'update reminder');
  await tab('首页').click(); await live(weather, 'weather'); assert.equal(await weather.getAttribute('aria-checked'), 'true');
  await tab('内容过滤').click(); await live(sponsor, 'sponsor skip'); assert.equal(await sponsor.getAttribute('aria-checked'), 'false');
  results.push('enabling external services re-enables weather, sponsor skip and update reminders without changing their values');

  // 关掉后再次变灰；从 storage 侧改回（弹窗开关、导入备份的路径）也要同步
  await tab('隐私与数据').click(); await external.click(); await off(interval, 'update reminder');
  await worker.evaluate(() => chrome.storage.local.get('margin:settings').then((s) => chrome.storage.local.set({ 'margin:settings': { ...s['margin:settings'], privacyExternal: true } })));
  await page.waitForFunction(() => {
    const el = document.querySelector('#margin-root')?.shadowRoot?.querySelector('[aria-label="允许外部辅助服务"]');
    return el?.getAttribute('aria-checked') === 'true';
  });
  await live(interval, 'update reminder');
  results.push('storage-side changes repaint dependent rows');

  // 动画：减少动画 → 开场动画、账号卡片拖拽；控件动效 → 账号卡片拖拽（开场动画不受影响）
  await tab('外观').click();
  await live(intro, 'intro'); await live(drag, 'draggable card');
  await reduce.click(); await off(intro, 'intro'); await off(drag, 'draggable card');
  await page.waitForTimeout(350); await page.screenshot({ path: join(out, 'reduce-motion-on.png') });
  await reduce.click(); await live(intro, 'intro'); await live(drag, 'draggable card');
  await effects.click(); await off(drag, 'draggable card'); await live(intro, 'intro');
  await effects.click(); await live(drag, 'draggable card');
  results.push('reduced motion and control effects gate the intro and the draggable account card');

  // 新版搜索栏 → 展开速度解禁
  await tab('搜索与顶栏').click();
  await dialog.getByRole('radio', { name: '新版', exact: true }).click();
  await live(palSpeed, 'palette speed under new search');
  await dialog.getByRole('radio', { name: '旧版', exact: true }).click();
  await off(palSpeed, 'palette speed under classic search');
  results.push('new search style enables the palette speed input');

  // 重新打开：状态仍正确
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
  await page.locator('#margin-root .top [aria-label="设置"]').click();
  await tab('隐私与数据').click(); await live(interval, 'update reminder');
  await tab('外观').click(); await live(intro, 'intro'); await live(drag, 'draggable card');
  results.push('dependency state survives close and reopen');
  assert.deepEqual(errors, []);
  results.forEach((result) => console.log('PASS ' + result));
} finally {
  writeFileSync(join(out, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  await ctx.close();
}
