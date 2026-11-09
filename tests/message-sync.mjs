import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installMocks } from './mocks.mjs';

const extension = resolve(process.env.SMOKE_EXT || 'dist');
const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/message-sync');
mkdirSync(out, { recursive: true });
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-message-sync-')), {
  headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`], viewport: { width: 1440, height: 1000 },
});
let unread = 3, ackFails = true, ackCalls = 0, unreadCalls = 0;
const errors = [], results = [];
try {
  await installMocks(context, raw => {
    const path = new URL(raw).pathname;
    if (path.endsWith('msgfeed/unread')) { unreadCalls++; return { code: 0, data: { reply: 0, at: 0, like: 0, sys_msg: 0 } }; }
    if (path.endsWith('single_unread')) return { code: 0, data: { follow_unread: unread, unfollow_unread: 0 } };
    if (path.endsWith('get_sessions')) return { code: 0, data: { session_list: [{ talker_id: 991001, session_type: 1, unread_count: 3, session_ts: 1000, last_msg: { msg_type: 1, content: '{"content":"待阅读消息"}' } }] } };
    if (path.endsWith('fetch_session_msgs')) return { code: 0, data: { messages: [{ sender_uid: 991001, msg_type: 1, content: '{"content":"待阅读消息"}', msg_seqno: 10, msg_key: 'k', timestamp: 1000 }] } };
    if (path.endsWith('update_ack')) { ackCalls++; if (ackFails) return { code: -1, message: 'rejected' }; unread = 1; return { code: 0 }; }
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': { intro: false, theme: 'dark', msgRemind: true, bg: { mode: 'off' } } }));
  const home = context.pages()[0];
  const watch = await context.newPage();
  const message = await context.newPage();
  for (const page of [home, watch, message]) { page.on('pageerror', e => errors.push(e.message)); page.setDefaultTimeout(7000); }
  await home.goto('https://www.bilibili.com/');
  await watch.goto('https://www.bilibili.com/video/BV1mdxN68E7F/');
  const badge = page => page.locator('.et-btn[href^="https://message.bilibili.com"] .et-badge');
  await badge(home).getByText('3', { exact: true }).waitFor();
  await badge(watch).getByText('3', { exact: true }).waitFor();
  const entry = home.locator('.et-btn[href^="https://message.bilibili.com"]');
  await entry.evaluate(el => el.addEventListener('click', event => event.preventDefault()));
  await entry.click(); await home.waitForTimeout(150);
  assert.equal(await badge(home).textContent(), '3');
  results.push('opening message entry does not clear unread');
  await message.goto('https://message.bilibili.com/#/whisper');
  const session = message.locator('.wh-s').first();
  await session.waitFor();
  await session.click();
  await message.locator('.wh-log').getByText('待阅读消息', { exact: true }).waitFor();
  await message.waitForTimeout(300);
  assert.ok(ackCalls > 0);
  assert.equal(await session.locator('.wh-dot').textContent(), '3');
  assert.equal(await badge(home).textContent(), '3');
  results.push('failed ACK preserves unread dot and other-tab counts');
  ackFails = false;
  unreadCalls = 0;
  await session.click();
  await badge(home).getByText('1', { exact: true }).waitFor();
  await badge(watch).getByText('1', { exact: true }).waitFor();
  await message.locator('.ms-item[data-view="whisper"] .ms-n').getByText('1', { exact: true }).waitFor();
  results.push('successful ACK synchronizes remaining unread across three tabs');
  unread = 0;
  await badge(home).waitFor({ state: 'detached' });
  await badge(watch).waitFor({ state: 'detached' });
  await message.waitForFunction(() => document.querySelector('#margin-root').shadowRoot.querySelector('.ms-item[data-view="whisper"] .ms-n').textContent === '');
  assert.ok(unreadCalls <= 12, `excessive re-fetches: ${unreadCalls}`);
  results.push('delayed server update corrected with bounded retries');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ results, ackCalls, unreadCalls }));
} finally {
  writeFileSync(join(out, 'results.json'), JSON.stringify({ results, ackCalls, unreadCalls, errors }, null, 2));
  await context.close();
}
