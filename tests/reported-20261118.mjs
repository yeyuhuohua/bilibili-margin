import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { apiBody, installMocks } from './mocks.mjs';

const ext = resolve(process.env.SMOKE_EXT || 'dist');
const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/reported-20261118');
mkdirSync(out, { recursive: true });
const checks = [], snapshots = [];
const selected = process.env.ISSUE_CASE;
for (const app of [true, false]) {
  const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-issues-181-')), {
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
    headless: true, viewport: { width: 1440, height: 1000 },
    args: [...(app ? ['--app=data:text/html,margin-regression'] : []), `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  try {
    let privateSpace = false, completeReads = 0, releaseReads = 0, releaseStatus = 200;
    const folderReads = [];
    await installMocks(context, address => {
      const u = new URL(address);
      if (privateSpace && u.pathname.includes('/fav/folder/created/')) folderReads.push(address);
      if (privateSpace && u.pathname.includes('/fav/folder/created/list-all')) {
        completeReads++;
        return { code: 0, data: { list: Array.from({ length: 23 }, (_, i) => ({ id: 500 + i, title: `自己的收藏 ${i + 1}`, media_count: 1, ...(i === 0 ? { attr: 3 } : {}) })) } };
      }
      if (privateSpace && u.pathname.includes('/fav/folder/created/list')) return { code: 0, data: null };
      if (address.includes('/feed/rcmd')) {
        const body = apiBody(address);
        for (const item of body.data.item) item.track_id = 'test-negative-feedback';
        return body;
      }
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': { intro: false, theme: 'dark', bg: { mode: 'off' }, hoverPreview: false, weather: false, footprint: false } }));
    const page = context.pages()[0] || await context.newPage();
    page.on('dialog', dialog => dialog.accept());
    if (!selected || selected === '199') {
      for (const selector of ['.card-block', '.card-nope', '.card-later']) {
        await page.goto('https://www.bilibili.com/');
        const card = page.locator('#margin-root .home-grid .card:not(.sk)').first();
        await card.waitFor(); await card.locator('.cover').hover();
        if (selector !== '.card-later') await card.locator('.card-more').click();
        const button = selector === '.card-later' ? card.locator(selector) : page.getByRole('menuitem', {name: selector === '.card-block' ? /^不看「/ : '不感兴趣'});
        await button.waitFor({ state: 'visible' });
        const previous = context.pages().length;
        await button.click(); await page.waitForTimeout(400);
        assert.equal(page.url(), 'https://www.bilibili.com/', `${selector} navigated away from the card action`);
        assert.equal(context.pages().length, previous, `${selector} opened the video`);
        checks.push(`199 ${app ? 'app' : 'browser'} ${selector} does not open its containing link`);
      }
    }
    if (!app && (!selected || selected === '200')) {
      await page.goto('https://www.bilibili.com/');
      await page.locator('#margin-root .home-grid .card:not(.sk)').first().waitFor();
      let navigations = 0;
      page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${new URL(worker.url()).hostname}/popup.html`);
      await popup.waitForFunction(() => document.querySelector('#ver').textContent);
      await popup.evaluate(() => {
        window.settingWrites = 0;
        const set = chrome.storage.local.set.bind(chrome.storage.local);
        chrome.storage.local.set = async values => {
          if (values['margin:settings']) window.settingWrites++;
          await new Promise(resolve => setTimeout(resolve, 100));
          return set(values);
        };
        const button = document.querySelector('#enabled'); button.click(); button.click();
      });
      await popup.waitForTimeout(350);
      assert.equal(await popup.evaluate(() => window.settingWrites), 1, 'rapid clicks must produce one settings write');
      await popup.waitForFunction(() => !document.querySelector('#enabled').disabled && document.querySelector('#enabled').getAttribute('aria-checked') === 'false');
      await page.waitForTimeout(500);
      const disabledNavigations = navigations;
      await page.waitForTimeout(800);
      assert.equal(navigations, disabledNavigations, 'disabled page keeps reloading');
      await popup.locator('#enabled').click();
      await page.locator('#margin-root .home-grid .card:not(.sk)').first().waitFor();
      await page.waitForTimeout(500);
      const enabledNavigations = navigations;
      await page.waitForTimeout(800);
      assert.equal(navigations, enabledNavigations, 'enabled page keeps reloading');
      assert(enabledNavigations <= 3, `too many reloads: ${enabledNavigations}`);
      snapshots.push({ disabledNavigations, enabledNavigations });
      checks.push('200 duplicate click writes once; disable and re-enable settle without a reload loop');
    }
    if (!app && (!selected || selected === '202')) {
      privateSpace = true;
      await page.goto('https://space.bilibili.com/1/favlist');
      const folders = page.locator('#margin-root .main .sp-collection');
      await folders.nth(19).waitFor();
      await page.locator('#margin-root .main > .sentinel').scrollIntoViewIfNeeded();
      try { await folders.nth(22).waitFor({ timeout: 5000 }); }
      catch (error) {
        console.log(JSON.stringify({ completeReads, folderReads, folderCount: await folders.count(), status: await page.locator('.main > .status').textContent(), geometry: await page.locator('.main > .sentinel').evaluate(el => { const app = el.closest('.app'); return { top: el.getBoundingClientRect().top, appTop: app.getBoundingClientRect().top, height: app.clientHeight, scroll: app.scrollTop, scrollHeight: app.scrollHeight }; }) }));
        await page.screenshot({ path: join(out, 'pagination-failure.png') }); throw error;
      }
      assert.equal(await folders.count(), 23);
      assert.match(await folders.first().textContent(), /私密/);
      assert.equal(await page.getByRole('link', {name:'原版本人视角'}).getAttribute('href'), 'https://space.bilibili.com/1?margin=off');
      const following = page.locator('.sp-stat[href*="/relation/follow"]');
      assert.equal(new URL(await following.getAttribute('href')).searchParams.get('margin'), 'off');
      assert.equal(new URL(await page.locator('.sp-native-following').getAttribute('href')).searchParams.get('margin'), 'off');
      await page.screenshot({ path: join(out, 'own-favorites.png') });
      const before = completeReads;
      await page.goto('https://space.bilibili.com/2/favlist');
      await page.getByText('没有公开的收藏夹', { exact: true }).waitFor();
      assert.equal(await page.getByRole('link',{name:'原版本人视角'}).count(), 0);
      assert.equal(completeReads, before, 'other users must not use the owner-only fallback');
      checks.push('202 own privacy fallback keeps private folders and later pages; native follow/bangumi links; no other-user fallback');
      privateSpace = false;
    }
    if (!app && (!selected || selected === '204')) {
      const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
      const parts = manifest.version.split('.').map(Number); parts[2]++;
      const next = parts.join('.');
      await context.route('https://api.github.com/repos/jiuyang5354/bilibili-margin/releases/latest', async route => {
        releaseReads++;
        await new Promise(resolve => setTimeout(resolve, 150));
        await route.fulfill({ status: releaseStatus, json: { tag_name: `v${next}`, name: '下一正式版', html_url: `https://github.com/jiuyang5354/bilibili-margin/releases/tag/v${next}` }, headers: { 'access-control-allow-origin': 'https://www.bilibili.com' } });
      });
      await page.goto('https://www.bilibili.com/');
      await page.getByRole('button', { name: '设置', exact: true }).click();
      const settings = page.getByRole('dialog', { name: '设置', exact: true });
      const check = settings.getByRole('button', { name: '检查更新', exact: true });
      await check.click();
      await settings.getByText('外部服务已关闭，可在隐私分类开启，或通过更新日志查看。', { exact: true }).waitFor();
      assert.equal(releaseReads, 0);
      await worker.evaluate(async () => {
        const key = 'margin:settings', current = (await chrome.storage.local.get(key))[key];
        await chrome.storage.local.set({ [key]: { ...current, privacyExternal: true }, 'margin:update-check': { at: Date.now(), tag: '0.52.0', url: 'https://github.com/jiuyang5354/bilibili-margin/releases/tag/v0.52.0' } });
      });
      await check.evaluate(button => { button.click(); button.click(); });
      await settings.getByRole('link', { name: '下一正式版 · 查看新版', exact: true }).waitFor();
      assert.equal(releaseReads, 1, 'manual check bypasses cached older result and blocks duplicate requests');
      const saved = await worker.evaluate(async () => (await chrome.storage.local.get('margin:update-check'))['margin:update-check']);
      releaseStatus = 503; await check.click();
      await settings.getByText('检查失败，请稍后重试或查看更新日志。', { exact: true }).waitFor();
      assert(await settings.getByText('检查失败，请稍后重试或查看更新日志。', { exact: true }).evaluate(el => el.getBoundingClientRect().bottom <= el.closest('.stg-body').getBoundingClientRect().bottom + 1), 'update feedback must be visible inside the settings scroll area');
      assert.equal(releaseReads, 2);
      assert.deepEqual(await worker.evaluate(async () => (await chrome.storage.local.get('margin:update-check'))['margin:update-check']), saved);
      await settings.screenshot({ path: join(out, 'update-check.png') });
      releaseStatus = 429;
      await check.click();
      const permissionPage = context.waitForEvent('page');
      await settings.getByRole('button', { name: '通过官方发布页检查' }).click();
      const consent = await permissionPage;
      await consent.waitForURL('**/popup.html#release-check');
      await consent.getByRole('button', { name: '授权并检查' }).waitFor();
      assert.equal(await consent.evaluate(() => chrome.permissions.contains({ origins:['https://github.com/*'] })), false);
      await consent.evaluate(() => { chrome.permissions.request = async () => false; });
      await consent.getByRole('button', { name: '授权并检查' }).click();
      await consent.getByText('未授权，可直接查看官方发布页。', { exact:true }).waitFor();
      assert.equal(releaseReads, 3);
      assert.deepEqual(await worker.evaluate(async () => (await chrome.storage.local.get('margin:update-check'))['margin:update-check']), saved);
      await consent.close();
      checks.push('234 manual rate limit opens an extension page; denial preserves cache');
      checks.push('204 settings check respects privacy, bypasses cache, prevents duplicate requests and keeps cached results on failure');
    }
  } finally { await context.close(); }
}
writeFileSync(join(out, 'results.json'), JSON.stringify({ checks, snapshots }, null, 2));
console.log(JSON.stringify({ checks, snapshots }));
