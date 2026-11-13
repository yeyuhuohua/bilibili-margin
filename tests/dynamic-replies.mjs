import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installMocks } from './mocks.mjs';

const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/dynamic-replies');
mkdirSync(out, { recursive: true });
const extension = resolve(process.env.SMOKE_EXT || 'dist'), results = [], errors = [], calls = [];
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-dynamic-replies-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  viewport: { width: 1440, height: 900 }, locale: 'zh-CN',
});
const rootId = '900001234567890123';
const reply = (i, root = false) => ({ rpid: Number(rootId) + i, rpid_str: root ? rootId : `9100012345678901${String(i).padStart(2, '0')}`,
  member: { mid: i + 1, uname: root ? '根评论作者' : `回复作者 ${i}`, avatar: `https://i0.hdslb.com/face-${i}.jpg` }, rcount: root ? 12 : 0,
  content: { message: root ? '可以展开的评论' : `楼中楼 ${i}[开心]`, emote: { '[开心]': { url: 'https://i0.hdslb.com/happy.gif' } } } });
let fail = false, delay = 0;
try {
  await installMocks(context, async url => {
    if (url.includes('/x/v2/reply/reply?')) {
      const query = new URL(url).searchParams, pn = Number(query.get('pn'));
      calls.push(Object.fromEntries(query));
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      if (fail) return { code: -500, message: '临时加载失败' };
      return { code: 0, data: { replies: (pn === 1 ? Array.from({ length: 10 }, (_, i) => i + 1) : [10, 11, 12]).map(i => reply(i)), page: { count: 12, size: 10 } } };
    }
    if (url.includes('/x/v2/reply?')) return { code: 0, data: { replies: [reply(0, true)], page: { count: 1 } } };
    return null;
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page = await context.newPage(); page.setDefaultTimeout(6000);
  page.on('pageerror', error => errors.push(error.message));
  const passed = name => { results.push(name); console.log(`PASS ${name}`); };
  for (const [entry, url, selector] of [
    ['feed', 'https://t.bilibili.com/', '.fd-list > .dy'],
    ['space', 'https://space.bilibili.com/2/dynamic', '.dy-list > .dy'],
  ]) for (const theme of ['light', 'dark']) {
    await worker.evaluate(theme => chrome.storage.local.set({ 'margin:settings': { intro: false, theme, bg: { mode: 'off' } } }), theme);
    await page.goto(url);
    const card = page.locator(selector).first();
    const comments = card.getByRole('button', { name: /^评论/ });
    await comments.click();
    const toggle = card.getByRole('button', { name: '展开 12 条回复', exact: true });
    await toggle.waitFor();
    const before = calls.length, tabs = context.pages().length;
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    await toggle.focus(); await page.keyboard.press('Enter');
    await card.locator('.dy-sublist > .dy-r').nth(9).waitFor();
    assert.equal(calls.length, before + 1);
    assert.equal(calls.at(-1).root, rootId); assert.equal(calls.at(-1).type, '17');
    assert.equal(calls.at(-1).oid, '900001');
    assert.equal(await card.locator('.dy-sublist .dy-emoji').count(), 10);
    assert.equal(await card.locator('.dy-sublist .dy-r-name').first().getAttribute('href'), 'https://space.bilibili.com/2');
    assert.equal(context.pages().length, tabs);
    const collapse = card.getByRole('button', { name: '收起回复', exact: true });
    await collapse.click(); assert.equal(await card.locator('.dy-sublist').isVisible(), false);
    await toggle.click(); assert.equal(await card.locator('.dy-sublist').isVisible(), true);
    assert.equal(calls.length, before + 1);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: join(out, `${entry}-${theme}-expanded.png`) });
    passed(`${entry} ${theme} keyboard expand, exact IDs, emoji and cached collapse`);

    fail = true;
    await card.getByRole('button', { name: '加载更多回复', exact: true }).click();
    await card.getByRole('button', { name: '重试加载回复', exact: true }).waitFor();
    assert.equal(await card.locator('.dy-sublist > .dy-r').count(), 10);
    fail = false;
    await card.getByRole('button', { name: '重试加载回复', exact: true }).click();
    await card.locator('.dy-sublist > .dy-r').nth(11).waitFor();
    assert.equal(await card.locator('.dy-sublist > .dy-r').count(), 12);
    assert.equal(await card.getByRole('button', { name: '加载更多回复', exact: true }).count(), 0);
    assert.equal(calls.at(-1).pn, '2'); assert.equal(calls.at(-2).pn, '2');
    await page.screenshot({ path: join(out, `${entry}-${theme}.png`) });
    passed(`${entry} ${theme} failed page retries without losing or duplicating replies`);

    const cachedCalls = calls.length;
    await comments.click(); await comments.click(); await collapse.waitFor();
    assert.equal(await card.locator('.dy-sublist > .dy-r').count(), 12);
    assert.equal(calls.length, cachedCalls);
    // A fresh card starts a new request; collapsing only hides and preserves it.
    await page.reload(); await comments.click(); await toggle.waitFor();
    delay = 500;
    await toggle.click(); await collapse.click();
    await page.waitForTimeout(650);
    assert.equal(await card.locator('.dy-sublist').isVisible(), false);
    await toggle.click();
    assert.equal(await card.locator('.dy-sublist > .dy-r').count(), 10);
    await page.reload(); await comments.click(); await toggle.waitFor();
    await toggle.click(); await comments.click(); await comments.click();
    await page.waitForTimeout(650);
    assert.equal(await card.locator('.dy-sublist > .dy-r').count(), 10);
    assert.equal(await collapse.getAttribute('aria-expanded'), 'true');
    delay = 0;
    passed(`${entry} ${theme} cached panels preserve replies and delayed responses respect collapsed state`);
  }
  assert.deepEqual(errors, []);
} finally { writeFileSync(join(out, 'results.json'), JSON.stringify({ results, errors, calls }, null, 2)); await context.close(); }
