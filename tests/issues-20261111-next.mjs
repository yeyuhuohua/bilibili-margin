import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { installMocks } from './mocks.mjs';

const ext = resolve(process.env.SMOKE_EXT || 'dist'), out = resolve(process.env.SMOKE_OUT || 'delivery/issues-0.6.41');
mkdirSync(out, { recursive: true });
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-next-')), {
  channel: 'chromium', headless: true, viewport: { width: 1440, height: 1000 }, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const results = [], errors = []; let posts = 0, rejectPost = false; const releases = [];
const check = async (name, run) => { try { await run(); results.push({ name, passed: true }); } catch (e) { results.push({ name, passed: false, error: e.message }); } console.log(JSON.stringify(results.at(-1))); };
const reply = n => ({ rpid_str: String(n), member: { mid: n, uname: `读者 ${n}` }, content: { message: `回复 ${n}` } });
try {
  await installMocks(context, async address => {
    const url = new URL(address), path = url.pathname;
    if (path.endsWith('/index/top/feed/rcmd')) return { code: 0, data: { item: ['128', '0', 36, '1.2万', 'unknown'].map((danmaku, i) => ({ goto: 'av', bvid: `BV1count0000${i}`, title: `弹幕计数测试 ${i}`, duration: 20, pic: '', owner: { mid: 2, name: '计数测试作者' }, stat: { view: 100, danmaku } })) } };
    if (path.endsWith('/feed/all')) return { code: 0, data: { items: [{ id_str: '8101', type: 'DYNAMIC_TYPE_WORD', basic: { comment_type: 17, comment_id_str: '8101' }, modules: { module_author: { mid: 2, name: '慢请求测试作者', pub_ts: 1 }, module_dynamic: { desc: { text: '慢响应下评论测试' } }, module_stat: { comment: { count: 16 }, like: { count: 0 }, forward: { count: 0 } } } }], has_more: false } };
    if (path === '/x/v2/reply') { const pn = Number(url.searchParams.get('pn')); return { code: 0, data: { replies: Array.from({ length: 8 }, (_, i) => reply((pn - 1) * 8 + i + 1)), page: { count: 16, size: 8 } } }; }
    if (path === '/x/v2/reply/add') { posts++; await new Promise(resolve => releases.push(resolve)); return rejectPost ? { code: -400, message: '模拟拒绝发布' } : { code: 0, data: {} }; }
  });
  await context.route('https://live.bilibili.com/3', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html><body><div class="live-room-app"><div class="app-content" style="min-height:1600px"><main id="sections-vm"><div id="player-ctnr" style="width:800px;height:450px">原生播放器</div></main></div></div></body></html>' }));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const seed = patch => worker.evaluate(async patch => { const saved = (await chrome.storage.local.get('margin:settings'))['margin:settings']; await chrome.storage.local.set({ 'margin:settings': { ...saved, intro: false, weather: false, footprint: false, bg: { mode: 'off' }, ...patch } }); }, patch);
  await seed({ theme: 'dark' });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message)); page.setDefaultTimeout(6000);
  await page.goto('https://t.bilibili.com/'); await page.locator('.fd-list > .dy:not(.sk)').first().waitFor();
  const card = page.locator('.fd-list > .dy:not(.sk)').first();
  await card.getByRole('button', { name: /^评论 / }).click(); await card.getByText('回复 8', { exact: true }).waitFor();
  await card.getByRole('textbox', { name: '发表评论' }).fill('只应该发送一次');
  await card.locator('.dy-send').click(); await page.waitForTimeout(50);
  await check('sending is immediately announced while the request remains pending', async () => { assert.equal(await card.locator('.dy-send').getAttribute('aria-busy'), 'true'); });
  await check('loading another reply page cannot unlock a pending publish', async () => {
    await card.getByRole('button', { name: '加载更多评论', exact: true }).click(); await card.getByText('回复 16', { exact: true }).waitFor();
    await card.locator('.dy-send').evaluate(el => el.click());
    await card.getByRole('textbox', { name: '发表评论' }).press('Enter'); await page.waitForTimeout(80);
    assert.equal(posts, 1);
  });
  releases.splice(0).forEach(resolve => resolve()); await page.waitForTimeout(100);
  await check('successful send appears once and clears the submitted draft', async () => { assert.equal(await card.locator('.dy-r.mine').count(), 1); assert.equal(await card.getByRole('textbox').inputValue(), ''); });
  await check('server rejection keeps the draft and only explicit retry posts again', async () => {
    rejectPost = true; await card.getByRole('textbox').fill('失败时保留'); const before = posts;
    await card.locator('.dy-send').click(); await page.waitForTimeout(50); releases.splice(0).forEach(resolve => resolve());
    await card.getByText(/模拟拒绝发布/).waitFor(); assert.equal(await card.getByRole('textbox').inputValue(), '失败时保留'); assert.equal(posts, before + 1);
    rejectPost = false;
  });
  await check('native video comment buttons preserve one pending request for fetch and XHR', async () => {
    await page.goto('https://www.bilibili.com/video/BV1mdxN68E7F/'); await page.locator('#margin-watch-top').waitFor();
    await page.evaluate(() => {
      const host = document.createElement('bili-comments'); document.body.append(host); const root = host.attachShadow({ mode: 'open' });
      for (const transport of ['fetch', 'xhr']) {
        const box = document.createElement('bili-comment-box'); box.id = transport; root.append(box);
        const sr = box.attachShadow({ mode: 'open' }); sr.innerHTML = '<div id="editor" contenteditable="true">慢请求草稿</div><div id="pub"><button type="button">发布</button></div>';
        sr.querySelector('button').addEventListener('click', async () => {
          const body = new URLSearchParams({ type: '1', oid: '123', message: sr.querySelector('#editor').textContent });
          if (transport === 'fetch') { await fetch('https://api.bilibili.com/x/v2/reply/add', { method: 'POST', body }).then(r => r.json()); }
          else { await new Promise(resolve => { const xhr = new XMLHttpRequest(); xhr.open('POST', 'https://api.bilibili.com/x/v2/reply/add'); xhr.onloadend = resolve; xhr.send(body); }); }
        });
      }
    });
    const native = page.locator('bili-comment-box #pub button'); await native.first().locator('.m-send-visual').waitFor({ state: 'attached' });
    for (const id of ['fetch', 'xhr']) {
      const before = posts, button = page.locator(`bili-comment-box#${id} #pub button`);
      await button.evaluate(el => el.click()); await page.waitForTimeout(50);
      await button.evaluate(el => { el.click(); el.click(); }); await page.waitForTimeout(80);
      const pending = await button.getAttribute('aria-busy'); releases.splice(0).forEach(resolve => resolve()); await page.waitForTimeout(100);
      assert.equal(posts, before + 1, `${id} should issue exactly one POST`); assert.equal(pending, 'true');
      assert.equal(await button.getAttribute('aria-busy'), null, 'settled requests release only their own pending state');
      assert.equal(await page.locator(`bili-comment-box#${id} #editor`).textContent(), '慢请求草稿');
    }
    const before = posts;
    await native.evaluateAll(buttons => buttons.forEach(button => button.click())); await page.waitForTimeout(50);
    await native.evaluateAll(buttons => buttons.forEach(button => button.click())); await page.waitForTimeout(60);
    assert.equal(posts, before + 2, 'independent comment editors may send concurrently without duplicates');
    releases.splice(0).forEach(resolve => resolve()); await page.waitForTimeout(80);
  });
  for (const style of ['classic', 'new']) await check(`dynamic header opens the ${style} search panel`, async () => {
    await seed({ searchStyle: style }); await page.goto('https://t.bilibili.com/'); await page.locator('.top .search input').click();
    await page.locator('.cp[data-open="true"]').waitFor(); await page.keyboard.press('Escape');
  });
  await check('live-room wallpaper remains visible beyond the header', async () => {
    await seed({ bg: { mode: 'mesh' } }); await page.goto('https://live.bilibili.com/3'); await page.locator('#margin-watch-top').waitFor();
    await page.waitForFunction(() => document.documentElement.classList.contains('margin-has-bg'));
    const backgrounds = await page.locator('.live-room-app, .app-content').evaluateAll(els => els.map(el => getComputedStyle(el).backgroundColor));
    assert.ok(backgrounds.every(color => color === 'rgba(0, 0, 0, 0)'), JSON.stringify(backgrounds));
    await page.screenshot({ path: join(out, 'live-background-on.png') });
    await seed({ bg: { mode: 'off' } });
    await page.waitForFunction(() => !document.documentElement.classList.contains('margin-has-bg'));
    assert.notEqual(await page.locator('.app-content').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');
  });
  await check('card danmaku preserves numeric-string counts and explicit zero', async () => {
    await seed({appFeed:false,homeHide:[]}); await page.goto('https://www.bilibili.com/');
    const first=page.locator('.card').filter({has:page.getByText('弹幕计数测试 0',{exact:true})}); await first.waitFor();
    assert.equal(await first.locator('.stat[aria-label="128 弹幕"]').count(),1);
    const zero=page.locator('.card').filter({has:page.getByText('弹幕计数测试 1',{exact:true})});
    assert.equal(await zero.locator('.stat[aria-label="0 弹幕"]').count(),1);
    const formatted=page.locator('.card').filter({has:page.getByText('弹幕计数测试 3',{exact:true})});
    assert.equal(await formatted.locator('.stat[aria-label="1.2万 弹幕"]').count(),1);
    const invalid=page.locator('.card').filter({has:page.getByText('弹幕计数测试 4',{exact:true})});
    assert.equal(await invalid.locator('.stat[aria-label$=" 弹幕"]').count(),0);
    await seed({homeHide:['danmaku']});
    await page.waitForFunction(()=>{const root=document.querySelector('#margin-root').shadowRoot;return !root.querySelector('.card .stat[aria-label$=" 弹幕"]');});
    assert.equal(await page.locator('.card .stat[aria-label$=" 弹幕"]').count(),0);
  });
  await page.screenshot({ path: join(out, 'live-background.png') });
  assert.deepEqual(errors, []);
} finally {
  releases.splice(0).forEach(resolve => resolve());
  writeFileSync(join(out, 'report.json'), JSON.stringify({ results, errors, posts, scope: 'Built extension in isolated Chromium with synthetic posts and mocked HTTP; no real comments published.' }, null, 2));
  await context.close();
}
if (results.some(result => !result.passed)) process.exitCode = 1;
