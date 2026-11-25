import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { installMocks } from './mocks.mjs';

const ext = resolve(process.env.SMOKE_EXT || 'dist');
const context = await chromium.launchPersistentContext('', {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
try {
  let signedIn = false;
  await installMocks(context, url => {
    if (!signedIn && url.includes('/x/web-interface/nav')) return { code: -101, data: { isLogin: false } };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const more = page.getByRole('button', { name: '更多操作', exact: true });
  const report = page.getByRole('menuitem', { name: '前往原版空间举报' });
  for (const mid of [2, 3]) {
    if (mid === 3) {
      signedIn = true;
      await context.addCookies([{ name: 'bili_jct', value: 'test', domain: '.bilibili.com', path: '/' }]);
    }
    await page.goto(`https://space.bilibili.com/${mid}`);
    await more.click();
    await report.waitFor();
    assert(await report.evaluate(el => el.matches(':focus')));
    await report.press('Escape');
    assert(await more.evaluate(el => el.matches(':focus')));
    await more.click();
    const [original] = await Promise.all([context.waitForEvent('page'), report.click()]);
    await original.waitForURL(`https://space.bilibili.com/${mid}?margin=off`);
    await original.waitForLoadState();
    assert.equal(await original.locator('#margin-root').count(), 0);
    await original.close();
    assert.equal(await report.count(), 0);
  }
  await page.goto('https://space.bilibili.com/1');
  await page.getByRole('link', { name: '原版本人视角' }).waitFor();
  assert.equal(await more.count(), 0);
  console.log('PASS guest and signed-in report handoffs, target UID, native page, Escape focus and own space');
} finally { await context.close(); }
