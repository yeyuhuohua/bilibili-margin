import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installMocks } from './mocks.mjs';
const out = resolve(process.env.SMOKE_OUT || 'artifacts/new-issues-20261109/regression'); mkdirSync(out, { recursive: true });
const ext = resolve(process.env.SMOKE_EXT || 'dist');
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-new-feedback-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, acceptDownloads: true, viewport: { width: 1440, height: 1000 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const results = [], errors = [];
const check = async (name, run) => { try { await run(); results.push({ name, ok: true }); console.log('PASS ' + name); } catch (e) { results.push({ name, ok: false, error: e.message }); console.log('FAIL ' + name + ': ' + e.message); } };
try {
  await installMocks(ctx);
  const worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': { theme: 'dark', intro: false, bg: { mode: 'off' } } }));
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto('https://www.bilibili.com/'); await page.locator('#margin-root .top [aria-label="设置"]').click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('tab', { name: '隐私与数据', exact: true }).click();
  await check('138-export-produces-a-real-versioned-backup', async () => {
    const downloaded = page.waitForEvent('download', { timeout: 3000 });
    await settings.getByRole('button', { name: '导出', exact: true }).click();
    const file = await downloaded;
    assert.match(file.suggestedFilename(), /margin-backup-0\.6\.\d+-\d{4}-\d{2}-\d{2}\.json/);
    const body = JSON.parse(readFileSync(await file.path(), 'utf8'));
    assert.equal(body.app, 'margin'); assert.equal(body.format, 1); assert.equal(body.settings.theme, 'dark');
    assert.equal(await file.failure(), null);
  });
  await page.goto('https://t.bilibili.com/');
  await page.locator('#margin-root .fd-follows').waitFor();
  await check('139-left-follow-list-toggle-keeps-top-strip', async () => {
    await page.locator('#margin-root .fd-ups .fd-up').first().waitFor();
    const count = await page.locator('#margin-root .fd-ups .fd-up').count();
    await page.locator('#margin-root .top [aria-label="设置"]').click();
    const dialog = page.getByRole('dialog', { name: '设置', exact: true });
    await dialog.getByRole('tab', { name: '外观', exact: true }).click();
    const toggle = dialog.getByRole('switch', { name: '动态页关注列表', exact: true });
    await toggle.waitFor({ timeout: 3000 }); assert.equal(await toggle.getAttribute('aria-checked'), 'true');
    await toggle.click(); await page.keyboard.press('Escape');
    await page.locator('#margin-root .fd-follows').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#margin-root .fd-ups .fd-up').count(), count);
    await page.reload(); await page.locator('#margin-root .fd-ups .fd-up').first().waitFor();
    assert.equal(await page.locator('#margin-root .fd-follows:visible').count(), 0);
    await page.locator('#margin-root .top [aria-label="设置"]').click();
    await dialog.getByRole('tab', { name: '外观', exact: true }).click(); await toggle.click(); await page.keyboard.press('Escape');
    await page.locator('#margin-root .fd-follows').waitFor(); assert.equal(await page.locator('#margin-root .fd-follows').count(), 1);
  });
  assert.deepEqual(errors, []);
} finally { writeFileSync(join(out, 'results.json'), JSON.stringify({ results, errors }, null, 2)); await ctx.close(); }
if (results.some(result => !result.ok)) process.exitCode = 1;
