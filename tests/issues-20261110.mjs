import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { installMocks } from './mocks.mjs';
const ext = resolve(process.env.SMOKE_EXT || 'dist'), out = resolve(process.env.SMOKE_OUT || 'delivery/issues-0.6.33');
mkdirSync(out, { recursive: true });
const results = [], errors = [], removals = [], recalls = [];
let removeFail = true, recallFail = true, recalled = false;
const now = Math.floor(Date.now() / 1000), key = '900001234567890123';
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-nov10-')), {
  channel: 'chromium', headless: true, viewport: { width: 1440, height: 1000 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const check = async (name, run) => { try { await run(); results.push({ name, passed: true }); }
  catch (e) { results.push({ name, passed: false, error: e.message }); } console.log(JSON.stringify(results.at(-1))); };
const medias = [1, 2].map(id => ({ id, bvid: `BVfixture${id}`, type: 2, attr: 0, title: `测试视频 ${id}`, cover: 'https://i0.hdslb.com/mock.jpg', upper: { mid: 2, name: '测试UP' }, cnt_info: { play: 100 } }));
try {
  await installMocks(ctx, url => {
    if (url.includes('fav/folder/created/list')) return { code: 0, data: { list: [{ id: 101, title: '我的收藏夹', media_count: 2, attr: 0 }] } };
    if (url.includes('fav/resource/list')) return { code: 0, data: { medias, has_more: false } };
    if (url.includes('fav/folder/collected/list')) return { code: 0, data: { list: [{ id: 301, title: '订阅合集', media_count: 2, type: 21 }], has_more: false } };
    if (url.includes('/fav/season/list')) return { code: 0, data: { medias } };
    if (url.includes('/get_sessions')) return { code: 0, data: { session_list: [{ talker_id: 2, session_type: 1, unread_count: 0, session_ts: now * 1e6 }] } };
    if (url.includes('/fetch_session_msgs')) return { code: 0, data: { messages: [
      { sender_uid: 1, msg_type: 1, msg_status: recalled ? 1 : 0, content: '{"content":"刚发送的消息"}', timestamp: now, msg_key: key },
      { sender_uid: 2, msg_type: 1, content: '{"content":"对方消息"}', timestamp: now, msg_key: '900002' },
      { sender_uid: 1, msg_type: 1, content: '{"content":"已过期消息"}', timestamp: now - 300, msg_key: '900003' },
    ] } };
  });
  const respond = (r, json) => r.fulfill({ json, headers: { 'access-control-allow-origin': r.request().headers().origin || 'https://www.bilibili.com', 'access-control-allow-credentials': 'true' } });
  await ctx.route('**/x/v3/fav/resource/batch-del', async r => {
    removals.push(Object.fromEntries(new URLSearchParams(r.request().postData())));
    await respond(r, removeFail ? { code: -111, message: '模拟取消失败' } : { code: 0, data: {} });
  });
  await ctx.route('**/web_im/v1/web_im/send_msg', async r => {
    recalls.push(Object.fromEntries(new URLSearchParams(r.request().postData())));
    if (!recallFail) recalled = true;
    await respond(r, recallFail ? { code: -1, message: '模拟撤回失败' } : { code: 0, data: {} });
  });
  await ctx.addCookies([{ name: 'bili_jct', value: 'fixture-csrf', domain: '.bilibili.com', path: '/' }]);
  const worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': { intro: false, theme: 'dark', glass: 'liquid', bg: { mode: 'off' } } }));
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto('https://www.bilibili.com/'); await page.locator('#margin-root .top').waitFor(); await page.evaluate(() => dispatchEvent(new Event('margin:open-fav')));
  const dialog = page.getByRole('dialog', { name: '收藏夹', exact: true });
  await dialog.locator('.fav-grid .card').nth(1).waitFor();
  await check('144 native favorite list URL enables continuous playback without preloading all pages', async () => {
    assert.equal(await dialog.getByRole('link', { name: '播放全部', exact: true }).getAttribute('href'), 'https://www.bilibili.com/list/ml101?sid=101');
    assert.equal(removals.length, 0);
  });
  const remove = () => dialog.getByRole('button', { name: '取消收藏：测试视频 1', exact: true });
  await check('147 cancel confirmation makes no mutation', async () => {
    page.once('dialog', d => d.dismiss()); await remove().click(); assert.equal(removals.length, 0);
  });
  await check('147 server failure preserves video and retry control', async () => {
    page.once('dialog', d => d.accept()); await remove().click(); await dialog.getByText(/取消失败.*模拟取消失败/).waitFor();
    assert.equal(await dialog.locator('.fav-grid .card').count(), 2); assert(!await remove().isDisabled());
  });
  await check('147 retry removes only the chosen resource after acknowledgment', async () => {
    removeFail = false; page.once('dialog', d => d.accept()); await remove().click();
    await remove().waitFor({ state: 'detached' }); assert.equal(await dialog.locator('.fav-grid .card').count(), 1);
    assert.equal(removals.at(-1).media_id, '101'); assert.equal(removals.at(-1).resources, '1:2'); assert.equal(removals.at(-1).csrf, 'fixture-csrf');
  });
  await page.screenshot({ path: join(out, 'favorites.png') });
  await check('147 subscribed content has no owned-folder removal control', async () => {
    await dialog.getByRole('radio', { name: '订阅内容', exact: true }).click();
    await dialog.locator('.fav-grid .card').nth(1).waitFor(); assert.equal(await dialog.locator('.fav-video-remove').count(), 0);
  });
  await page.goto('https://message.bilibili.com/#/whisper/mid2'); await page.locator('.wh-input').waitFor();
  await check('151 recall appears only for own recent message', async () => {
    await page.getByRole('button', { name: '撤回消息', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '撤回消息', exact: true }).count(), 1);
  });
  await check('151 rejected recall preserves message and supports retry', async () => {
    await page.getByRole('button', { name: '撤回消息', exact: true }).click(); await page.getByText(/撤回失败，请稍后重试/).waitFor();
    assert(await page.getByText('刚发送的消息', { exact: true }).isVisible());
    assert(!await page.getByRole('button', { name: '撤回消息', exact: true }).isDisabled());
  });
  await check('151 successful recall preserves raw long key and replaces message only after success', async () => {
    recallFail = false; await page.getByRole('button', { name: '撤回消息', exact: true }).click(); await page.getByText('你撤回了一条消息', { exact: true }).waitFor();
    assert.equal(recalls.at(-1)['msg[msg_type]'], '5'); assert.equal(recalls.at(-1)['msg[content]'], key);
    assert.equal(await page.getByText('刚发送的消息', { exact: true }).count(), 0);
    assert(await page.getByText('对方消息', { exact: true }).isVisible());
  });
  await check('151 reload respects server recalled state', async () => {
    await page.reload(); await page.getByText('你撤回了一条消息', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '撤回消息', exact: true }).count(), 0);
  });
  await page.setViewportSize({ width: 2560, height: 1440 });
  for (const [name, url] of [['home', 'https://www.bilibili.com/'], ['watch', 'https://www.bilibili.com/video/BV1mdxN68E7F/'],
    ['message', 'https://message.bilibili.com/'], ['space', 'https://space.bilibili.com/2/']]) {
    await check(`148 ${name} settings centered at matching 960x680 size`, async () => {
      await page.goto(url); await page.getByRole('button', { name: '设置', exact: true }).first().click();
      const panel = page.getByRole('dialog', { name: '设置', exact: true }); await panel.waitFor(); await page.waitForTimeout(300);
      const b = await panel.boundingBox(); assert(Math.abs(b.x - 800) < 1 && Math.abs(b.y - 380) < 1 && Math.abs(b.width - 960) < 1 && Math.abs(b.height - 680) < 1, JSON.stringify(b));
    });
  }
  assert.deepEqual(errors, []);
} finally {
  writeFileSync(join(out, 'report.json'), JSON.stringify({ results, errors, removals, recalls, scope: 'Actual built extension, local mocked APIs only; no real favorites removed or messages recalled.' }, null, 2));
  await ctx.close();
}
if (results.some(r => !r.passed) || errors.length) process.exitCode = 1;
