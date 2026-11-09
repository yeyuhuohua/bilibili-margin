import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installMocks } from './mocks.mjs';

const extension = resolve(process.env.SMOKE_EXT || 'dist');
const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/dynamic-reserve');
mkdirSync(out, { recursive: true });
const results = [], requests = [], errors = [];
let fail = false;
const reservation = (rid, patch = {}) => ({ rid, title: '周末直播预约', state: 0, reserve_total: 42,
  jump_url: 'https://live.bilibili.com/123', desc1: { text: '明晚 20:00' }, desc2: { text: '42人预约', visible: true },
  button: { type: 2, status: 1, uncheck: { text: '预约', disable: 0 },
    check: { text: '已预约', disable: 0, interactive: { popups: '取消预约', desc: '确定取消本场直播预约？', confirm: '确定', cancel: '返回' } } }, ...patch });
const dynamic = (id, reserve) => ({ id_str: id, type: 'DYNAMIC_TYPE_WORD',
  basic: { comment_type: 17, comment_id_str: id }, modules: {
    module_author: { mid: 2, name: '作者', pub_ts: 1700000000 },
    module_dynamic: { desc: { text: '点击预约按钮，不错过直播' }, additional: { type: 'ADDITIONAL_TYPE_RESERVE', reserve } },
  } });
const original = dynamic('900001234567890123', reservation('800001234567890123'));
const repost = { ...dynamic('900001234567890124'), orig: dynamic('900001234567890125', reservation('800001234567890125')) };
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-reserve-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  viewport: { width: 1440, height: 900 }, locale: 'zh-CN',
});
try {
  await installMocks(context, url => url.includes('/web-dynamic/v1/feed/') ? { code: 0, data: {
    items: [original, repost,
      dynamic('9003', reservation('8003', { state: 1 })),
      dynamic('9004', reservation('8004', { title: '已结束', button: { type: 2, status: 2, check: { text: '已结束', disable: 1, toast: '预约已结束' } } })),
      dynamic('9005', reservation('8005', { title: '正在直播', button: { type: 1, jump_style: { text: '去直播间' } } })),
      dynamic('9006', reservation('8006', { state: -1 })),
    ], has_more: false, offset: '',
  } } : null);
  await context.addCookies([{ name: 'bili_jct', value: 'reserve-test-token', domain: '.bilibili.com', path: '/' }]);
  await context.route('**/x/dynamic/feed/reserve/click?*', async route => {
    assert.equal(new URL(route.request().url()).searchParams.get('csrf'), 'reserve-test-token');
    assert.equal(route.request().method(), 'POST');
    const data = route.request().postDataJSON(); requests.push(data);
    await new Promise(resolve => setTimeout(resolve, 120));
    const status = data.cur_btn_status === 1 ? 2 : 1;
    await route.fulfill({ contentType: 'application/json', headers: {
      'access-control-allow-origin': route.request().headers().origin, 'access-control-allow-credentials': 'true',
    }, body: JSON.stringify(fail ? { code: -101, message: '请先登录后重试' } : { code: 0, data: {
      final_btn_status: status, desc_update: `${status === 2 ? 43 : 42}人预约`, reserve_update: status === 2 ? 43 : 42,
    } }) });
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page = await context.newPage(); page.setDefaultTimeout(6000);
  page.on('pageerror', error => errors.push(error.message));
  for (const [entry, url] of [['feed', 'https://t.bilibili.com/'], ['space', 'https://space.bilibili.com/2/dynamic']]) {
    for (const theme of ['light', 'dark']) {
      await worker.evaluate(theme => chrome.storage.local.set({ 'margin:settings': { intro: false, theme, bg: { mode: 'off' } } }), theme);
      await page.goto(url);
      const card = page.locator('.dy-reserve').first(), button = card.getByRole('button');
      await button.waitFor();
      assert((await card.innerText()).includes('明晚 20:00'));
      const tabs = context.pages().length, start = requests.length;
      await button.evaluate(el => { el.click(); el.click(); });
      await card.locator('button[aria-pressed="true"]').waitFor();
      assert.equal(requests.length, start + 1);
      assert.equal(requests.at(-1).reserve_id, '800001234567890123');
      assert.equal(requests.at(-1).dynamic_id_str, '900001234567890123');
      assert.equal(await card.locator('.dy-reserve-desc').innerText(), '明晚 20:00 · 43人预约');
      assert.equal(context.pages().length, tabs);
      page.once('dialog', dialog => dialog.dismiss()); await button.click();
      assert.equal(requests.length, start + 1);
      fail = true;
      page.once('dialog', dialog => dialog.accept()); await button.click();
      await card.getByRole('status').filter({ hasText: '请先登录后重试' }).waitFor();
      assert.equal(await button.getAttribute('aria-pressed'), 'true');
      fail = false;
      page.once('dialog', dialog => dialog.accept()); await button.click();
      await card.locator('button[aria-pressed="false"]').waitFor();
      assert.equal(requests.at(-1).cur_btn_status, 2);
      assert.equal(requests.at(-1).reserve_total, 43);
      assert.equal(context.pages().length, tabs);
      const nested = page.locator('.dy.nested .dy-reserve');
      await nested.getByRole('button').click();
      await nested.locator('button[aria-pressed="true"]').waitFor();
      assert.equal(requests.at(-1).dynamic_id_str, '900001234567890125');
      assert.equal(requests.at(-1).reserve_id, '800001234567890125');
      assert.equal(await page.locator('.dy-reserve').filter({ hasText: '原预约信息已删除' }).getByRole('button').count(), 0);
      assert(await page.getByRole('button', { name: '已结束', exact: true }).isDisabled());
      assert.equal(await page.locator('.dy-reserve').filter({ hasText: '请在最新版' }).getByRole('button').count(), 0);
      const jump = page.getByRole('link', { name: '去直播间', exact: true });
      assert.equal(await jump.getAttribute('href'), 'https://live.bilibili.com/123');
      const navigated = context.waitForEvent('page'); await jump.click();
      const live = await navigated; await live.waitForLoadState('domcontentloaded');
      assert.equal(live.url(), 'https://live.bilibili.com/123'); await live.close();
      await card.scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(out, `${entry}-${theme}.png`) });
      await card.evaluate(el => { el.style.width = '280px'; el.style.boxSizing = 'border-box'; });
      const bounds = await card.boundingBox(), action = await button.boundingBox();
      assert(action.x >= bounds.x && action.x + action.width <= bounds.x + bounds.width + 1, 'reservation button overflowed');
      assert.deepEqual(errors, []);
      results.push(`${entry}-${theme}`); console.log(`PASS ${entry}-${theme}: display, reserve, cancel, retry, nested, ended, navigation and narrow card`);
    }
  }
} finally {
  writeFileSync(join(out, 'results.json'), JSON.stringify({ results, requests, errors }, null, 2));
  await context.close();
}
