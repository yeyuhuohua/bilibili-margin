import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { installMocks } from './mocks.mjs';

const ext = resolve(process.env.SMOKE_EXT || 'dist'), out = resolve('delivery/dynamic-inline-comments');
mkdirSync(out, { recursive: true });
const results = [], errors = [], requests = [];
let failures = 1, posts = 0;
const item = (id, text, basic = { comment_type: 17, comment_id_str: id }) => ({ id_str: id, type: 'DYNAMIC_TYPE_WORD', basic,
  modules: { module_author: { mid: 1, name: '映间编辑部', face: 'https://i0.hdslb.com/bfs/mock/avatar.jpg', pub_ts: Math.floor(Date.now() / 1000) },
    module_dynamic: { desc: { text } }, module_stat: { comment: { count: 10 }, like: { count: 2 }, forward: { count: 0 } } } });
const reply = n => ({ rpid: n, member: { uname: `读者 ${n}`, mid: n, avatar: 'https://i0.hdslb.com/bfs/mock/avatar.jpg' }, content: { message: `页内评论 ${n}` }, rcount: n === 1 ? 2 : 0 });
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-inline-')), {
  channel: 'chromium', headless: true, viewport: { width: 1440, height: 1000 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const check = async (name, run) => { try { await run(); results.push({ name, passed: true }); }
  catch (e) { results.push({ name, passed: false, error: e.message }); } console.log(JSON.stringify(results.at(-1))); };
try {
  await installMocks(ctx, async url => {
    const u = new URL(url), p = u.pathname;
    if (p.endsWith('/feed/all')) return { code: 0, data: { items: [item('8001', '文字动态验证'),
      { ...item('8002', '转发动态验证'), orig: item('7000', '原始动态验证') }, item('8003', '延迟加载验证'),
      item('8004', '失败重试验证', {}), item('8005', '视频动态验证', { comment_type: 1, comment_id_str: '123' }),
      item('8006', '空评论验证')], has_more: false, offset: '' } };
    if (p.endsWith('/detail')) {
      if (failures-- > 0) return { code: -500, message: '模拟接口失败' };
      return { code: 0, data: { item: item('8004', '失败重试验证') } };
    }
    if (p === '/x/v2/reply/reply') return { code: 0, data: { replies: [reply(101), reply(102)], page: { count: 2, size: 10 } } };
    if (p === '/x/v2/reply/add') { posts++; return { code: 0, data: {} }; }
    if (p === '/x/v2/reply') {
      requests.push({ oid: u.searchParams.get('oid'), pn: Number(u.searchParams.get('pn')), type: u.searchParams.get('type') });
      if (u.searchParams.get('oid') === '8003') await new Promise(r => setTimeout(r, 550));
      if (u.searchParams.get('oid') === '8006') return { code: 0, data: { replies: [], page: { count: 0, size: 8 } } };
      const pn = Number(u.searchParams.get('pn'));
      return { code: 0, data: { top_replies: [reply(99)], replies: pn === 1 ? Array.from({ length: 8 }, (_, i) => reply(i + 1)) : [reply(8), reply(9), reply(10)], page: { count: 11, size: 8 } } };
    }
  });
  const worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  await worker.evaluate(async () => { await globalThis.marginLocalGlassReady;
    await chrome.storage.local.set({ 'margin:settings': { intro: false, theme: 'dark', glass: 'liquid', bg: { mode: 'off' } } }); });
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto('https://t.bilibili.com/'); await page.locator('.fd-list > .dy').nth(5).waitFor();
  const card = text => page.locator('.fd-list > .dy').filter({ has: page.locator('.dy-body > .dy-text', { hasText: text }) });
  const trigger = c => c.locator(':scope > .dy-foot > .dy-stat').getByRole('button', { name: /^评论 / });
  const first = card('文字动态验证');
  await check('no comments are requested before expansion', async () => { assert.equal(requests.length, 0); });
  await check('comments expand within the current feed with pinned and ordinary rows intact', async () => {
    await trigger(first).click(); await first.locator('.dy-cbox .dy-rlist > .dy-r').nth(8).waitFor();
    assert.equal(page.url(), 'https://t.bilibili.com/'); assert.equal(ctx.pages().length, 2);
    assert.equal(await trigger(first).getAttribute('aria-expanded'), 'true');
    assert.equal(await first.locator('.dy-rlist > .dy-r').count(), 9);
  });
  await check('footer collapse restores focus and reopening retains draft without refetch', async () => {
    await first.getByRole('textbox', { name: '发表评论' }).fill('未发送的草稿');
    const count = requests.length;
    await first.getByRole('button', { name: '收起评论', exact: true }).click();
    assert(await first.locator('.dy-cbox').isHidden());
    assert(await trigger(first).evaluate(el => el.getRootNode().activeElement === el));
    await trigger(first).click(); assert.equal(await first.getByRole('textbox').inputValue(), '未发送的草稿');
    assert.equal(requests.length, count); assert.equal(posts, 0);
  });
  await check('load more pages stays inline and removes duplicates', async () => {
    await first.getByRole('button', { name: '加载更多评论', exact: true }).click();
    await first.getByText('页内评论 10', { exact: true }).waitFor();
    assert.equal(await first.locator('.dy-rlist > .dy-r').count(), 11);
    assert(await first.getByRole('button', { name: '加载更多评论', exact: true }).isHidden());
    assert.deepEqual(requests.filter(r => r.oid === '8001').map(r => r.pn), [1, 2]);
  });
  await check('nested replies still expand and collapse inside the comment thread', async () => {
    const root = first.locator('.dy-rlist > .dy-r').filter({ hasText: '页内评论 1' }).first();
    const sub = root.locator('.dy-replies-toggle');
    await sub.click(); await root.getByText('页内评论 101', { exact: true }).waitFor();
    await sub.click(); assert(await root.getByText('页内评论 101', { exact: true }).isHidden());
  });
  await check('repost uses its own comment target rather than the original dynamic', async () => {
    await trigger(card('转发动态验证')).click(); await card('转发动态验证').getByText('页内评论 99', { exact: true }).waitFor();
    assert(requests.some(r => r.oid === '8002')); assert(!requests.some(r => r.oid === '7000'));
  });
  await check('closing during a delayed request never reopens the panel', async () => {
    const c = card('延迟加载验证'); await trigger(c).click(); await trigger(c).click();
    await page.waitForTimeout(700); assert(await c.locator('.dy-cbox').isHidden());
    const count = requests.length; await trigger(c).click(); await c.getByText('页内评论 99', { exact: true }).waitFor();
    assert.equal(requests.length, count);
  });
  await check('missing target and network error can retry within the same dynamic', async () => {
    const c = card('失败重试验证'); await trigger(c).click(); await c.getByText(/评论加载失败.*模拟接口失败/).waitFor();
    await c.getByRole('button', { name: '重试加载评论', exact: true }).click(); await c.getByText('页内评论 99', { exact: true }).waitFor();
    assert(requests.some(r => r.oid === '8004')); assert.equal(page.url(), 'https://t.bilibili.com/');
  });
  await check('video comment targets preserve type 1 and empty comments remain editable', async () => {
    await trigger(card('视频动态验证')).click(); await card('视频动态验证').getByText('页内评论 99', { exact: true }).waitFor();
    assert(requests.some(r => r.oid === '123' && r.type === '1'));
    const c = card('空评论验证'); await trigger(c).click(); await c.getByText('还没有评论', { exact: true }).waitFor();
    assert(!await c.getByRole('button', { name: '发布', exact: true }).isDisabled());
    assert.equal(posts, 0);
  });
  await page.setViewportSize({ width: 1440, height: 1700 });
  await first.scrollIntoViewIfNeeded(); await page.waitForTimeout(250); await first.screenshot({ path: join(out, 'dark.png') });
  await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': { intro: false, theme: 'light', glass: 'liquid', bg: { mode: 'off' } } }));
  await page.waitForTimeout(400); await first.screenshot({ path: join(out, 'light.png') });
  assert.deepEqual(errors, []);
} finally {
  writeFileSync(join(out, 'report.json'), JSON.stringify({ results, errors, requests, posts,
    scope: 'Actual built extension in isolated Chromium, all HTTP mocked locally. No real comments published.' }, null, 2));
  await ctx.close();
}
if (results.some(r => !r.passed) || errors.length) process.exitCode = 1;
