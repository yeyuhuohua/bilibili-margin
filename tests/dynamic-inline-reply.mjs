import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { installMocks } from './mocks.mjs';

const ext = resolve(process.env.SMOKE_EXT || 'dist'), out = resolve(process.env.SMOKE_OUT || 'delivery/dynamic-inline-reply');
mkdirSync(out, { recursive: true });
const root = '90071992547409931', child = '90071992547409932';
const row = (id, name, text, count = 0) => ({ rpid_str: id, member: { mid: 2, uname: name }, content: { message: text }, rcount: count });
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-inline-reply-')), {
  channel: 'chromium', headless: true, viewport: { width: 1200, height: 1000 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const results = [], errors = [], posts = [];
let release, reject = false;
try {
  await installMocks(context, raw => {
    const p = new URL(raw).pathname;
    if (p.endsWith('/feed/all')) return { code: 0, data: { items: [{ id_str: '8101', type: 'DYNAMIC_TYPE_WORD', basic: { comment_type: 17, comment_id_str: '8101' }, modules: { module_author: { mid: 1, name: '动态作者', pub_ts: 1 }, module_dynamic: { desc: { text: '内联回复测试' } }, module_stat: { comment: { count: 2 }, like: { count: 0 }, forward: { count: 0 } } } }], has_more: false } };
    if (p === '/x/v2/reply') return { code: 0, data: { replies: [row(root, '主评论作者', '主评论正文', 1), row('90071992547409939', '暂无回复作者', '零回复主评论')], page: { count: 2, size: 8 } } };
    if (p === '/x/v2/reply/reply') return { code: 0, data: { replies: [row(child, '楼中楼作者', '楼中楼正文')], page: { count: 1, size: 10 } } };
  });
  await context.route('**/x/v2/reply/add', async route => {
    const form = Object.fromEntries(new URLSearchParams(route.request().postData())); posts.push(form);
    await new Promise(resolve => { release = resolve; });
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(reject ? { code: -400, message: '模拟发送失败' } : { code: 0, data: { reply: row(`9007199254740994${posts.length}`, '我', form.message) } }) });
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': { intro: false, weather: false, footprint: false, theme: 'dark', bg: { mode: 'off' } } }));
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message)); page.setDefaultTimeout(5000);
  await page.goto('https://t.bilibili.com/');
  const card = page.locator('.fd-list > .dy:not(.sk)').first();
  await card.getByRole('button', { name: /^评论 / }).click();
  const main = card.locator('.dy-rlist > .dy-r').filter({ has: page.getByText('主评论正文', { exact: true }) }), input = card.getByRole('textbox', { name: '发表评论' });
  await main.locator('.dy-r-reply').first().click();
  assert.match(await card.locator('.dy-reply-context').textContent(), /主评论作者/);
  await page.screenshot({ path: join(out, 'reply-selected.png') });
  await input.fill('回复主评论'); await card.locator('.dy-send').click();
  await page.waitForFunction(() => document.getElementById('margin-root').shadowRoot.querySelector('.dy-send')?.getAttribute('aria-busy') === 'true');
  await card.locator('.dy-send').evaluate(button => button.click()); await input.press('Enter');
  await page.waitForTimeout(80); assert.equal(posts.length, 1);
  assert.equal(posts[0].root, root); assert.equal(posts[0].parent, root); assert.equal(posts[0].oid, '8101'); assert.equal(posts[0].type, '17');
  release(); await main.getByText('回复主评论', { exact: true }).waitFor();
  assert.equal(await input.inputValue(), ''); results.push('root reply preserves exact IDs and pending requests cannot submit twice');
  const nested = main.locator('.dy-sublist > .dy-r').filter({ hasText: '楼中楼正文' });
  if (!await nested.count()) { await main.locator('.dy-replies-toggle').click(); }
  await nested.locator('.dy-r-reply').click(); await input.fill('失败草稿'); reject = true;
  await card.locator('.dy-send').click(); await page.waitForTimeout(80); assert.equal(posts[1].root, root); assert.equal(posts[1].parent, child);
  release(); await card.getByText(/发布失败/).waitFor(); assert.equal(await input.inputValue(), '失败草稿');
  assert.match(await card.locator('.dy-reply-context').textContent(), /楼中楼作者/); results.push('nested reply uses root and parent separately and rejection retains its target and draft');
  await card.getByRole('button', { name: '取消回复', exact: true }).click();
  assert.equal(await input.inputValue(), '失败草稿'); assert(await card.locator('.dy-reply-context').isHidden());
  reject = false; await card.locator('.dy-send').click(); await page.waitForTimeout(80);
  assert.equal(posts[2].root, undefined); assert.equal(posts[2].parent, undefined); release();
  await card.locator('.dy-rlist > .dy-r').filter({ has: page.getByText('失败草稿', { exact: true }) }).waitFor(); results.push('cancel keeps the draft and restores a top-level comment');
  const emptyThread = card.locator('.dy-rlist > .dy-r').filter({ has: page.getByText('零回复主评论', { exact: true }) });
  await emptyThread.locator('.dy-r-reply').click(); await input.fill('新增第一条回复'); await card.locator('.dy-send').click(); await page.waitForTimeout(80);
  assert.equal(posts[3].root, '90071992547409939');
  await main.locator(':scope > .dy-r-b > .dy-r-meta > .dy-r-reply').click(); await input.fill('发送期间新草稿');
  release(); await emptyThread.getByText('新增第一条回复', { exact: true }).waitFor();
  assert.equal(await input.inputValue(), '发送期间新草稿'); assert.match(await card.locator('.dy-reply-context').textContent(), /主评论作者/);
  assert.equal(await emptyThread.locator('.dy-replies-toggle').getAttribute('aria-expanded'), 'true');
  results.push('a previously empty thread accepts replies and completion preserves a newer target and draft');
  for (const theme of ['dark', 'light']) {
    await worker.evaluate(async theme => { const saved = (await chrome.storage.local.get('margin:settings'))['margin:settings']; await chrome.storage.local.set({ 'margin:settings': { ...saved, theme } }); }, theme);
    await page.screenshot({ path: join(out, `${theme}.png`) });
  }
  assert.deepEqual(errors, []);
} finally {
  writeFileSync(join(out, 'report.json'), JSON.stringify({ results, errors, posts, scope: 'Isolated built extension with mocked HTTP; no real comments posted.' }, null, 2));
  await context.close();
}
console.log(`PASS ${results.length} inline reply groups`);
