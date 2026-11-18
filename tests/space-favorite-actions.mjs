import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { apiBody, installMocks } from './mocks.mjs';

const ext = resolve(process.env.SMOKE_EXT || 'dist');
const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/space-favorite-actions');
mkdirSync(out, { recursive: true });
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-space-fav-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, viewport: { width: 1440, height: 1000 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const checks = [], posts = [], folderRequests = [];
let fail = false, hold = false, release;
const folder = (id, mid = 1, attr = 0) => ({ id, mid, title: `收藏夹 ${id}`, media_count: 2, attr, cover: '' });
try {
  await installMocks(context, url => {
    const u = new URL(url), p = u.pathname;
    if (p.includes('/fav/folder/info')) return { code: 0, data: folder(Number(u.searchParams.get('media_id')), u.searchParams.get('media_id') === '203' ? 2 : 1, u.searchParams.get('media_id') === '103' ? 1 : 0) };
    if (p.includes('/fav/folder/created/list')) {
      folderRequests.push(url);
      const mid = Number(u.searchParams.get('up_mid'));
      const second = Number(u.searchParams.get('pn')) > 1;
      return { code: 0, data: { count: 3, has_more: !second, list: second ? [folder(103, mid, 1)] : [folder(101, mid), folder(102, mid)] } };
    }
    if (p.includes('/fav/resource/list')) {
      const response = apiBody(url);
      response.data.medias = response.data.medias.slice(0, 2).map((v, i) => ({ ...v, id: 1000 + i }));
      return response;
    }
  });
  await context.route('**/x/v3/fav/resource/{move,copy,batch-del}', async route => {
    posts.push({ url: route.request().url(), body: Object.fromEntries(new URLSearchParams(route.request().postData())) });
    if (hold) await new Promise(resolve => { release = resolve; });
    await route.fulfill({ json: fail ? { code: -400, message: '测试操作失败' } : { code: 0 }, headers: { 'access-control-allow-origin': 'https://space.bilibili.com', 'access-control-allow-credentials': 'true' } });
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': { intro: false, theme: 'dark', bg: { mode: 'off' }, weather: false, footprint: false } }));
  const page = await context.newPage();
  page.on('dialog', dialog => dialog.accept());
  const cards = page.locator('#margin-root .main > :is(.grid,.vlist) > .card:not(.sp-collection):not(.sk)');
  await page.goto('https://space.bilibili.com/1/favlist?fid=101');
  await cards.nth(1).waitFor();
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(out, 'grid.png') });
  assert.equal(await cards.first().locator('.fav-video-actions button').count(), 3, 'own space favorites must expose existing management actions');
  assert.equal(folderRequests.filter(url => new URL(url).searchParams.get('pn') === '2').length, 0, 'target folders are not eagerly loaded');
  const card = cards.first();
  await card.getByRole('button', { name: '复制到…', exact: true }).click();
  const select = card.getByRole('combobox', { name: '目标收藏夹' });
  await select.locator('option[value="103"]').waitFor({ state: 'attached' });
  assert.equal(await select.locator('option').count(), 2, 'include later-page and private target, exclude source');
  await select.selectOption('103');
  await card.getByRole('button', { name: '确认复制', exact: true }).click();
  await card.getByText('已复制到「收藏夹 103」', { exact: true }).waitFor();
  assert.equal(await cards.count(), 2);
  assert.equal(posts[0].body.resources, '1000:2');
  assert.equal(posts[0].body.tar_media_id, '103');
  checks.push('owned grid, lazy paginated targets and copy retain source');
  fail = true;
  await card.getByRole('button', { name: '移动到…', exact: true }).click();
  await card.getByRole('combobox').selectOption('102');
  await card.getByRole('button', { name: '确认移动', exact: true }).click();
  await card.getByRole('alert').filter({ hasText: '移动失败' }).waitFor();
  assert.equal(await cards.count(), 2);
  assert.equal(await card.getByRole('combobox').inputValue(), '102');
  fail = false; hold = true;
  await card.getByRole('button', { name: '确认移动', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#margin-root').shadowRoot.querySelector('.fav-video-transfer button').disabled);
  assert.equal(posts.length, 3);
  assert.equal(await cards.count(), 2);
  release(); hold = false;
  await page.waitForFunction(() => document.querySelector('#margin-root').shadowRoot.querySelectorAll('.main > :is(.grid,.vlist) > .card').length === 1);
  checks.push('failed move retains card and target; pending move locks controls and removes only on success');
  await page.getByRole('radio', { name: '列表', exact: true }).click();
  await cards.nth(1).waitFor();
  assert.equal(await cards.first().locator('.fav-video-actions').count(), 1);
  fail = true;
  await cards.first().getByRole('button', { name: /^取消收藏：/ }).click();
  await cards.first().getByRole('alert').filter({ hasText: '取消失败' }).waitFor();
  assert.equal(await cards.count(), 2);
  fail = false;
  await cards.first().getByRole('button', { name: /^取消收藏：/ }).click();
  await page.waitForFunction(() => document.querySelector('#margin-root').shadowRoot.querySelectorAll('.vlist > .card').length === 1);
  await page.screenshot({ path: join(out, 'list.png') });
  checks.push('list layout supports removal confirmation, failure and success');
  await page.goto('https://space.bilibili.com/2/favlist?fid=203');
  await page.locator('.sp-collection-head h2').getByText('收藏夹 203', { exact: true }).waitFor();
  await cards.nth(1).waitFor();
  assert.equal(await cards.locator('.fav-video-actions').count(), 0);
  checks.push('other users never expose management actions');
  await page.goto('https://space.bilibili.com/1/favlist?fid=103');
  await page.locator('.sp-collection-head h2').getByText('收藏夹 103', { exact: true }).waitFor();
  await cards.nth(1).waitFor();
  assert.equal(await cards.first().locator('.fav-video-actions').count(), 1);
  assert.equal(new URL(page.url()).searchParams.has('margin'), false);
  checks.push('own private folder retains redesign and actions');
  await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': { intro: false, theme: 'light', bg: { mode: 'off' }, weather: false, footprint: false } }));
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.waitForTimeout(500);
  const bounds = await cards.first().locator('.fav-video-actions').evaluate(el => {
    const box = el.getBoundingClientRect(); return { left: box.left, right: box.right, width: innerWidth };
  });
  assert(bounds.left >= 0 && bounds.right <= bounds.width);
  await page.screenshot({ path: join(out, 'light-1024.png') });
  checks.push('light theme and narrower desktop keep actions in bounds');
} finally {
  await context.close();
  writeFileSync(join(out, 'results.json'), JSON.stringify({ checks, posts, folderRequests }, null, 2));
}
console.log(JSON.stringify({ checks }));
