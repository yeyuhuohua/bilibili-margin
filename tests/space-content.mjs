import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { installMocks } from './mocks.mjs';

const ext = resolve(process.env.SMOKE_EXT || 'dist');
const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/space-content');
mkdirSync(out, { recursive: true });
const videos = JSON.parse(readFileSync(new URL('./fixtures/pop.json', import.meta.url), 'utf8'));
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-space-content-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  viewport: { width: 1440, height: 1000 }, locale: 'zh-CN',
});
let failAudio = false, emptyAudio = false, holdArticle = false, releaseArticle;
const requests = [], results = [], errors = [];
const page = context.pages()[0];
page.on('pageerror', error => errors.push(error.message));
const folder = (id, attr = 0) => ({ id, mid: 2, title: `收藏夹 ${id}`, media_count: 2, attr, cover: videos[0].pic });
try {
  await installMocks(context, async url => {
    const u = new URL(url);
    if (u.pathname.includes('/opus/feed/space')) {
      requests.push(url);
      if (holdArticle) { holdArticle = false; await new Promise(resolve => { releaseArticle = resolve; }); }
      const next = u.searchParams.get('offset') === 'next';
      return { code: 0, data: { items: [{ opus_id: next ? '100002' : '100001', content: next ? '第二页图文' : '第一页图文', jump_url: `//www.bilibili.com/opus/${next ? '100002' : '100001'}`, cover: next ? null : { url: videos[0].pic }, stat: { like: '3' } }], has_more: !next, offset: next ? '' : 'next' } };
    }
    if (u.pathname.includes('/song/upper')) {
      requests.push(url);
      if (failAudio) return { code: -500, message: '音频临时不可用' };
      if (emptyAudio) return { code: 0, data: null };
      const pn = Number(u.searchParams.get('pn'));
      return { code: 0, data: { data: [{ id: pn, title: `第 ${pn} 页音频`, cover: videos[pn].pic, duration: 60, statistic: { play: 100 } }], pageCount: 2 } };
    }
    if (u.pathname.includes('/fav/folder/created/list') && u.searchParams.get('up_mid') === '2') {
      requests.push(url);
      const first = u.searchParams.get('pn') === '1';
      return { code: 0, data: { list: first ? [folder(201), folder(203, 1)] : [folder(202)], has_more: first } };
    }
    if (u.pathname.includes('/fav/folder/info')) return { code: 0, data: folder(Number(u.searchParams.get('media_id')), u.searchParams.get('media_id') === '203' ? 1 : 0) };
    if (u.pathname.includes('/fav/resource/list')) {
      requests.push(url);
      const pn = Number(u.searchParams.get('pn'));
      const v = videos[pn];
      return { code: 0, data: { medias: [{ type: 2, attr: 0, bvid: v.bvid, title: v.title, cover: v.pic, duration: v.dur, upper: { mid: v.mid, name: v.name }, cnt_info: { play: v.play } }], has_more: pn < 2 } };
    }
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': { intro: false, theme: 'dark' } }));
  const content = page.locator('#margin-root .main > .grid .sp-content-card');
  for (const [path, tab, expected] of [['article', 'article', '第一页图文'], ['upload/opus', 'article', '第一页图文'], ['audio', 'audio', '第 1 页音频'], ['upload/audio', 'audio', '第 1 页音频']]) {
    await page.goto(`https://space.bilibili.com/2/${path}`);
    await content.nth(1).waitFor();
    assert.equal(await page.locator(`#margin-root .sp-bar [data-tab="${tab}"]`).getAttribute('aria-selected'), 'true');
    assert.match(await content.first().textContent(), new RegExp(expected));
    assert.equal(await content.count(), 2);
    const href = await content.first().locator('a.title').getAttribute('href');
    assert(href.includes(tab === 'article' ? '/opus/' : '/audio/au'));
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(out, `${path.replace('/', '-')}.png`) });
    results.push(path + ' route and pagination');
  }
  await page.goto('https://space.bilibili.com/2/favlist');
  await page.getByRole('button', { name: '打开收藏夹 202', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '打开收藏夹 203', exact: true }).count(), 0);
  await page.getByRole('button', { name: '打开收藏夹 201', exact: true }).click();
  await page.locator('#margin-root .main > :is(.grid,.vlist) .card').nth(1).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('fid'), '201');
  await page.reload();
  await page.locator('#margin-root .sp-collection-head h2').getByText('收藏夹 201', { exact: true }).waitFor();
  await page.locator('#margin-root .main > :is(.grid,.vlist) .card').nth(1).waitFor();
  await page.locator('.sp-collection-head').getByRole('button', { name: '收藏夹', exact: true }).click();
  await page.getByRole('button', { name: '打开收藏夹 202', exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.has('fid'), false);
  results.push('public folders, content pagination, direct link and return');
  await page.goto('https://space.bilibili.com/2/favlist?fid=203');
  await page.waitForURL(url => url.searchParams.get('margin') === 'off');
  assert.equal(new URL(page.url()).searchParams.get('fid'), '203');
  assert.equal(await page.locator('#margin-root .sp-bar').count(), 0);
  results.push('private direct link returns to native permissions');
  await page.goto('https://space.bilibili.com/2/favlist?fid=201&ftype=collect&ctype=21');
  await page.locator('#margin-watch-top').waitFor();
  assert.equal(await page.locator('#margin-root .sp-bar').count(), 0);
  results.push('subscribed collection uses existing native route');
  failAudio = true;
  await page.goto('https://space.bilibili.com/2/audio');
  await page.getByText('加载失败：音频临时不可用', { exact: true }).waitFor();
  failAudio = false;
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await content.nth(1).waitFor();
  results.push('audio error retry');
  emptyAudio = true;
  await page.reload();
  await page.getByText('还没有投稿音频', { exact: true }).waitFor();
  assert.equal(await content.count(), 0);
  emptyAudio = false;
  results.push('empty audio response');
  holdArticle = true;
  await page.goto('https://space.bilibili.com/2/article');
  await page.locator('#margin-root .sp-bar [data-tab="audio"]').click();
  await content.nth(1).waitFor();
  assert(releaseArticle);
  releaseArticle();
  await page.waitForTimeout(100);
  assert.equal(await page.getByText('第一页图文', { exact: true }).count(), 0);
  results.push('stale article response ignored after tab switch');
  await page.locator('#margin-root .sp-bar [data-tab="video"]').click();
  await page.locator('#margin-root .main > .grid .card:not(.sk)').first().waitFor();
  for (const width of [1920, 1280, 1100]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.locator('#margin-root .sp-bar').evaluate(el => el.scrollWidth - el.clientWidth);
    assert(overflow < 2, `space tabs overflow ${overflow}px at ${width}`);
  }
  await worker.evaluate(() => chrome.storage.local.get('margin:settings').then(value => chrome.storage.local.set({ 'margin:settings': { ...value['margin:settings'], theme: 'light' } })));
  await page.locator('#margin-root .sp-bar [data-tab="article"]').click();
  await content.nth(1).waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(out, 'article-light-narrow.png') });
  assert.deepEqual(errors, []);
} finally {
  writeFileSync(join(out, 'results.json'), JSON.stringify({ results, requests, errors }, null, 2));
  await context.close();
}
console.log(JSON.stringify(results));
