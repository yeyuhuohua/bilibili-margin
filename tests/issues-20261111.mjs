import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { installMocks } from './mocks.mjs';

const ext = resolve(process.env.SMOKE_EXT || 'dist'), out = resolve(process.env.SMOKE_OUT || 'delivery/issues-0.6.40');
mkdirSync(out, { recursive: true });
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-issues-1111-')), {
  channel: 'chromium', headless: true, viewport: { width: 1440, height: 1100 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const results = [], errors = [], requests = [];
let liveFails = true, liveRequests = 0;
const live = i => ({ mid: 200 + i, uname: `正在直播 ${i}`, face: 'https://i0.hdslb.com/bfs/mock/avatar.jpg', title: `直播标题 ${i}`, room_id: 1000 + i });
const pinned = { rpid_str: '900001234567890123', mid: 2, member: { mid: 2, uname: '动态作者', avatar: '' }, content: { message: '作者的置顶评论' }, rcount: 1 };
const reply = (id, mid, text) => ({ rpid_str: id, mid, member: { mid, uname: '动态作者', avatar: '' }, content: { message: text } });
const folder = (id, mid = 1) => ({ id, mid, title: `${mid === 1 ? '本人' : '他人'}私密收藏夹`, attr: 3, media_count: 1 });
const check = async (name, run) => { await run(); results.push({ name, passed: true }); console.log(`PASS ${name}`); };
try {
  await installMocks(ctx, async url => {
    const u = new URL(url), p = u.pathname; requests.push(p);
    if (p.includes('/fav/folder/info')) return { code: 0, data: folder(Number(u.searchParams.get('media_id')), u.searchParams.get('media_id') === '902' ? 2 : 1) };
    if (p.includes('/fav/folder/created/list') && u.searchParams.get('up_mid') === '1') return { code: 0, data: { list: [folder(901)], count: 1, has_more: false } };
    if (p.includes('/fav/resource/list')) return { code: 0, data: { medias: [{ id: 100, type: 2, bvid: 'BV1mock00001', title: '私密夹内的视频', attr: 0, cover: '', duration: 10, upper: { name: '作者', mid: 3 }, cnt_info: { play: 10, danmaku: 0 } }], has_more: false } };
    if (p.endsWith('/portal')) return { code: 0, data: { up_list: [], live_users: { count: 19, items: Array.from({ length: 8 }, (_, i) => live(i + 1)) } } };
    if (p.endsWith('/GetWebList')) { liveRequests++; return liveFails ? { code: -500, message: '模拟直播失败' } : { code: 0, data: { rooms: Array.from({ length: 19 }, (_, i) => ({ ...live(i + 1), uid: 201 + i })) } }; }
    if (p.endsWith('/feed/all')) return { code: 0, data: { items: [{ id_str: '6001', type: 'DYNAMIC_TYPE_WORD', basic: { comment_type: 17, comment_id_str: '6001' }, modules: { module_author: { mid: 2, name: '动态作者', face: '', pub_ts: Math.floor(Date.now() / 1000) }, module_dynamic: { desc: { text: '评论标识回归' } }, module_stat: { comment: { count: 2 }, like: { count: 0 }, forward: { count: 0 } } } }], has_more: false, offset: '' } };
    if (p === '/x/v2/reply') return { code: 0, data: { top_replies: [pinned], upper: { top: pinned, mid: 2 }, replies: [pinned, reply('102', 3, '同名普通评论')], page: { size: 8, count: 2 } } };
    if (p === '/x/v2/reply/reply') return { code: 0, data: { replies: [reply('103', 2, '作者楼中楼')], page: { size: 10, count: 1 } } };
  });
  const worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': { intro: false, theme: 'dark', glass: 'liquid', bg: { mode: 'off' }, weather: false, footprint: false } }));
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message)); page.setDefaultTimeout(8000);
  await check('本人私密夹深链留在映间，内容可读且不改为公开', async () => {
    await page.goto('https://space.bilibili.com/1/favlist?fid=901');
    await page.locator('.sp-collection-head h2').getByText('本人私密收藏夹', { exact: true }).waitFor();
    await page.getByText('私密夹内的视频', { exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.has('margin'), false);
    assert.equal(requests.filter(p => /\/fav\/.*(?:edit|add|del)/.test(p)).length, 0);
    await page.locator('.sp-collection-head').getByRole('button', { name: '收藏夹', exact: true }).click();
    await page.getByRole('button', { name: '打开本人私密收藏夹', exact: true }).waitFor();
    assert.match(await page.locator('.sp-collection .dur').first().textContent(), /私密/);
  });
  await check('追番／追剧入口打开原站，明确限制到该次导航', async () => {
    const link = page.getByRole('link', { name: '追番／追剧（B 站原版）' });
    await link.waitFor(); const u = new URL(await link.getAttribute('href'));
    assert.equal(u.pathname, '/1/bangumi'); assert.equal(u.searchParams.get('margin'), 'off'); assert.equal(await link.getAttribute('target'), '_blank');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('margin:off')), null);
  });
  await check('本人登录不能查看他人私密夹，保留原生权限处理', async () => {
    await page.goto('https://space.bilibili.com/2/favlist?fid=902');
    await page.waitForURL(u => u.searchParams.get('margin') === 'off');
    assert.equal(await page.locator('.sp-collection-head h2').count(), 0);
  });
  await page.goto('https://t.bilibili.com/');
  const card = page.locator('.fd-list > .dy').first(); await card.waitFor();
  await check('动态作者与置顶标识保留，重复置顶只渲染一次，同名用户不误标 UP', async () => {
    await card.locator('.dy-stat').getByRole('button', { name: /^评论 / }).click();
    await card.getByText('作者的置顶评论', { exact: true }).waitFor();
    assert.equal(await card.locator('.dy-rlist > .dy-r').count(), 2);
    const first = card.locator('.dy-rlist > .dy-r').first();
    assert.equal(await first.locator('.dy-r-up').count(), 1); assert.equal(await first.locator('.dy-r-top').count(), 1);
    assert.equal(await card.locator('.dy-r').filter({ hasText: '同名普通评论' }).locator('.dy-r-up').count(), 0);
    await first.locator('.dy-replies-toggle').click(); await card.getByText('作者楼中楼', { exact: true }).waitFor();
    assert.equal(await first.locator('.dy-sublist .dy-r-up').count(), 1); assert.equal(await first.locator('.dy-sublist .dy-r-top').count(), 0);
  });
  await check('直播入口及侧栏默认各 8 条，未请求完整开播列表', async () => {
    await page.locator('.fd-live-row').nth(7).waitFor(); assert.equal(await page.locator('.fd-live-row').count(), 8);
    await page.locator('.et-btn[aria-label="直播"]').hover();
    await page.locator('.dp[aria-label="正在直播"] .dp-row').nth(7).waitFor();
    assert.equal(await page.locator('.dp[aria-label="正在直播"] .dp-row').count(), 8); assert.equal(liveRequests, 0);
  });
  const pop = page.locator('.dp[aria-label="正在直播"]');
  await check('直播更多失败保留已有内容，支持点击重试且不自动重复请求', async () => {
    await pop.getByRole('button', { name: '加载更多', exact: true }).click();
    await pop.getByRole('button', { name: '加载失败，重试', exact: true }).waitFor();
    assert.equal(await pop.locator('.dp-row').count(), 8); assert.equal(liveRequests, 1);
    liveFails = false; await pop.getByRole('button', { name: '加载失败，重试', exact: true }).click();
    await pop.locator('.dp-row').nth(15).waitFor(); assert.equal(liveRequests, 2);
  });
  await check('直播逐批展开并去重，第二批不重复请求完整列表', async () => {
    await pop.getByRole('button', { name: '加载更多', exact: true }).click();
    await pop.locator('.dp-row').nth(18).waitFor();
    const hrefs = await pop.locator('.dp-row').evaluateAll(nodes => nodes.map(n => n.getAttribute('href')));
    assert.equal(new Set(hrefs).size, 19); assert.equal(liveRequests, 2); assert.equal(await pop.locator('.dp-more').count(), 0);
    await page.keyboard.press('Escape');
    await page.locator('.fd-live-more').click(); await page.locator('.fd-live-row').nth(15).waitFor();
    const firstRequests = liveRequests; await page.locator('.fd-live-more').click(); await page.locator('.fd-live-row').nth(18).waitFor();
    assert.equal(liveRequests, firstRequests); assert.ok(await page.locator('.fd-live-more').isHidden());
  });
  await page.screenshot({ path: join(out, 'comments-live-dark.png') });
  assert.deepEqual(errors, []);
} finally {
  writeFileSync(join(out, 'report.json'), JSON.stringify({ results, errors, liveRequests, scope: 'Isolated built extension; all Bilibili HTTP mocked, no real private content read or modified.' }, null, 2));
  await ctx.close();
}
