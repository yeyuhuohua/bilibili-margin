import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
import { installMocks } from './mocks.mjs';

const dist = resolve(process.env.SMOKE_EXT || 'dist');
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-owner-')), {
  channel: 'chromium', headless: true, args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});
try {
  const deletes = [];
  const item = (id, mid, menu) => ({
    id_str: id, type: 'DYNAMIC_TYPE_WORD', basic: { editable: true },
    modules: { module_author: { mid, name: '测试用户' }, module_dynamic: { desc: { text: id } },
      module_more: { three_point_items: menu.map(type => ({ type })) } },
  });
  const menu = ['THREE_POINT_EDIT', 'THREE_POINT_DELETE'];
  await installMocks(ctx, url => {
    if (url.includes('web-dynamic/v1/feed/space')) return { code: 0, data: {
      items: [item('123', 1, menu), item('124', 1, []), item('125', 2, menu)], has_more: false,
    } };
  });
  await ctx.route('**/x/dynamic/feed/operate/remove?*', route => {
    deletes.push(route.request().postDataJSON().dyn_id_str);
    return route.fulfill({ json: { code: deletes.length === 1 ? -1 : 0, message: '操作失败' },
      headers: { 'Access-Control-Allow-Origin': 'https://space.bilibili.com', 'Access-Control-Allow-Credentials': 'true' } });
  });
  const p = await ctx.newPage(); p.setDefaultTimeout(7000);
  await p.goto('https://space.bilibili.com/1/dynamic');
  const remove = p.getByRole('button', { name: '删除', exact: true }); await remove.waitFor();
  assert.equal(await remove.count(), 1);
  const edit = p.getByRole('link', { name: '编辑', exact: true });
  assert.equal(await edit.getAttribute('href'), 'https://t.bilibili.com/123?margin=off#margin-edit');
  p.once('dialog', d => d.dismiss()); await remove.click(); assert.deepEqual(deletes, []);
  p.once('dialog', d => d.accept()); await remove.click(); await p.getByText('操作失败', { exact: true }).waitFor();
  assert(await remove.isEnabled());
  p.once('dialog', d => d.accept()); await remove.click(); await remove.waitFor({ state: 'detached' });
  assert.deepEqual(deletes, ['123','123']);
  await p.goto('https://space.bilibili.com/2/dynamic'); await p.locator('.dy').first().waitFor();
  assert.equal(await p.locator('.dy-manage').count(), 0);
  const dest = 'https://t.bilibili.com/123?margin=off';
  await ctx.route(/^https:\/\/t\.bilibili\.com\/123\?margin=off/, route => route.fulfill({contentType:'text/html; charset=utf-8', body:'<div id="app"><div class="content"><div class="card"><div class="bili-dyn-item"><div class="bili-dyn-item__main"><div class="bili-dyn-item__header"><div class="bili-dyn-more"><button class="bili-dyn-more__btn" onmouseenter="this.nextElementSibling.hidden=false">更多</button><button hidden class="bili-cascader-options__item-label" onclick="document.title=\'编辑器\'">编辑动态</button></div></div></div></div></div></div></div>'}));
  await p.goto(dest+'#margin-edit'); await p.waitForFunction(()=>document.title==='编辑器');
  console.log('PASS owner, visitor, capability, edit handoff, cancel, reject, retry and remove');
} finally { await ctx.close(); }
