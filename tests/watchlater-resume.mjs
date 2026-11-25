import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { installMocks } from './mocks.mjs';

const ext = resolve(process.env.SMOKE_EXT || 'dist');
const browser = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-resume-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, args: [`--load-extension=${ext}`, `--disable-extensions-except=${ext}`],
});
try {
  await installMocks(browser);
  const page = await browser.newPage();
  const id = 'BV14W4B6sET9', sibling = 'BV1kuxM6bE2A';
  const entry = 'https://www.bilibili.com/list/watchlater?bvid=' + id;
  const data = (route, data) => route.fulfill({ json: { code: 0, data },
    headers: { 'access-control-allow-origin':'https://www.bilibili.com', 'access-control-allow-credentials':'true' } });
  page.setDefaultNavigationTimeout(12000);
  await page.route('https://api.bilibili.com/x/web-interface/view?**', route => data(route, {
    bvid: id, pages: [{page:1,cid:10},{page:2,cid:11}], ugc_season:{sections:[{episodes:[{bvid:sibling,cid:20}]}]},
  }));
  let historyCalls = 0;
  await page.route('https://api.bilibili.com/x/web-interface/history/cursor?**', route => {
    historyCalls++;
    return data(route, { list:[{view_at:100,history:{business:'archive', bvid:historyCalls===1?id:sibling,
      page:historyCalls===1?2:1, cid:historyCalls===1?11:20}}] });
  });
  for (const target of [entry + '&p=2', 'https://www.bilibili.com/video/' + sibling + '/']) {
    await page.goto(entry + '&margin_resume=1', {waitUntil:'commit'});
    await page.waitForURL(target);
  }
  await page.goto(entry + '&p=1&margin_resume=1');
  await page.locator('#margin-watch-top').waitFor({state:'attached'});
  assert.equal(new URL(page.url()).searchParams.get('p'),'1');
  assert.equal(historyCalls,2);
  console.log('PASS native queue part, series episode, and explicit episode selection');
} finally { await browser.close(); }
