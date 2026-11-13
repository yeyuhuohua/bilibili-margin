import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { installMocks } from './mocks.mjs';

const ext = resolve(process.env.SMOKE_EXT || 'dist'), out = resolve(process.env.SMOKE_OUT || 'delivery/dynamic-glass-0.6.39');
mkdirSync(out, { recursive: true });
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-dyn-glass-')), {
  channel: 'chromium', headless: true, viewport: { width: 1440, height: 1100 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const results = [], errors = [];
let centerPixelDelta;
const check = async (name, run) => { await run(); results.push({ name, passed: true }); console.log(`PASS ${name}`); };
const item = (id, text) => ({ id_str: id, type: 'DYNAMIC_TYPE_WORD', basic: { comment_type: 17, comment_id_str: id }, modules: {
  module_author: { mid: 1, name: '映间编辑部', face: 'https://i0.hdslb.com/bfs/mock/avatar.jpg', pub_ts: Math.floor(Date.now() / 1000) - 60 },
  module_dynamic: { desc: { text } }, module_stat: { comment: { count: 1 }, like: { count: 2 }, forward: { count: 0 } },
} });
try {
  await installMocks(ctx, async url => {
    const p = new URL(url).pathname;
    if (p.endsWith('/feed/all')) return { code: 0, data: { items: [item('8001', '动态玻璃验证'), { ...item('8002', '转发玻璃验证'), orig: item('8003', '原始内容\n'.repeat(55)) }], has_more: false, offset: '' } };
    if (p === '/x/v2/reply') return { code: 0, data: { replies: [{ rpid: 1, member: { uname: '读者', mid: 2, avatar: 'https://i0.hdslb.com/bfs/mock/avatar.jpg' }, content: { message: '正文、姓名和按钮沿用原配色。' }, ctime: Math.floor(Date.now() / 1000) }], page: { count: 1, size: 8 } } };
  });
  const worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  await worker.evaluate(async () => { await globalThis.marginLocalGlassReady; await chrome.storage.local.set({ 'margin:settings': { intro: false, theme: 'dark', glass: 'liquid', bg: { mode: 'off' } } }); });
  const page = await ctx.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://t.bilibili.com/');
  await page.locator('.fd-list > .dy').nth(1).waitFor();
  const card = page.locator('.fd-list > .dy').first();
  await card.locator('.dy-stat').getByRole('button', { name: /^评论 / }).click();
  const panel = card.locator('.dy-cbox'); await panel.locator('.dy-r').waitFor();
  await page.waitForFunction(() => document.querySelector('#margin-root').shadowRoot.querySelector('.dy-cbox').classList.contains('dy-refract'));
  const styles = () => card.evaluate(el => ['.dy-r-name', '.dy-r p', '.dy-r-meta', '.dy-in', '.dy-send', '.dy-comment-collapse'].map(selector => { const css = getComputedStyle(el.querySelector(selector)); return { color: css.color, background: css.backgroundColor, font: css.font, radius: css.borderRadius }; }));
  const mode = async value => {
    await worker.evaluate(async value => { const s = (await chrome.storage.local.get('margin:settings'))['margin:settings']; await chrome.storage.local.set({ 'margin:settings': { ...s, glass: value } }); }, value);
    await page.waitForFunction(value => document.querySelector('#margin-root').shadowRoot.querySelector('.app').dataset.glass === value, value);
  };
  await check('共用轻度折射滤镜，中心不参与扰动，边缘固定为 8px', async () => {
    assert.equal(await page.locator('#lg-dynamic').count(), 1);
    assert.equal(await page.locator('#lg-dynamic > *').count(), 3);
    assert.equal(await page.locator('#lg-dynamic feDisplacementMap').getAttribute('scale'), '6');
    assert.equal(await panel.evaluate(el => getComputedStyle(el, '::before').filter), 'none');
    assert.match(await panel.evaluate(el => getComputedStyle(el, '::after').filter), /lg-dynamic/);
    assert.equal(await panel.evaluate(el => getComputedStyle(el, '::after').paddingTop), '8px');
  });
  await check('只有背景层折射，正文、输入框和按钮不做滤镜', async () => {
    for (const el of [panel, panel.locator('textarea'), panel.locator('.dy-r p'), panel.locator('.dy-send')]) assert.equal(await el.evaluate(node => getComputedStyle(node).filter), 'none');
    assert.equal(await panel.evaluate(el => getComputedStyle(el, '::before').pointerEvents), 'none');
    for (const el of [panel, page.locator('.dy-orig')]) {
      assert.equal(await el.evaluate(node => getComputedStyle(node, '::after').borderTopWidth), '0px');
      assert.equal(await el.evaluate(node => getComputedStyle(node, '::after').boxShadow), 'none');
      assert.ok(!await el.evaluate(node => getComputedStyle(node).boxShadow.includes('inset')));
    }
  });
  await check('边缘折射有可见效果，中心没有大幅位移或波纹', async () => {
    await panel.evaluate(el => { const style = document.createElement('style'); style.id = 'glass-pixel-background'; style.textContent = '.app { background-image: repeating-linear-gradient(80deg,#383e44 0 12px,#a9afb4 12px 24px); } .app > .bg { display:none!important; }'; el.getRootNode().append(style); });
    await page.evaluate(() => document.fonts.ready);
    const box = await panel.boundingBox();
    const inner = { x: Math.ceil(box.x + 12), y: Math.ceil(box.y + 12), width: Math.floor(box.width - 24), height: Math.floor(box.height - 24) };
    const on = await panel.screenshot({ path: join(out, 'built-pixel-effect.png') });
    const centerOn = await page.screenshot({ clip: inner });
    await page.locator('#lg-dynamic feDisplacementMap').evaluate(el => el.setAttribute('scale', '0'));
    const off = await panel.screenshot(); assert.ok(!on.equals(off));
    const centerOff = await page.screenshot({ clip: inner });
    writeFileSync(join(out, 'center-on.png'), centerOn); writeFileSync(join(out, 'center-off.png'), centerOff);
    centerPixelDelta = await page.evaluate(async ({ on, off }) => {
      const decode = async value => { const image = new Image(); image.src = `data:image/png;base64,${value}`; await image.decode(); return image; };
      const [a, b] = await Promise.all([decode(on), decode(off)]);
      const canvas = document.createElement('canvas'); canvas.width = a.width; canvas.height = a.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(a, 0, 0); const first = ctx.getImageData(0, 0, a.width, a.height).data;
      ctx.clearRect(0, 0, a.width, a.height); ctx.drawImage(b, 0, 0); const second = ctx.getImageData(0, 0, a.width, a.height).data;
      let max = 0, sum = 0;
      for (let i = 0; i < first.length; i++) { const d = Math.abs(first[i] - second[i]); max = Math.max(max, d); sum += d; }
      return { maxChannelDifference: max, meanChannelDifference: sum / first.length };
    }, { on: centerOn.toString('base64'), off: centerOff.toString('base64') });
    // Filtering can change 8-bit compositing rounding; a visible displacement
    // of the high-contrast stripes exceeds this small pixel-error allowance.
    assert.ok(centerPixelDelta.maxChannelDifference <= 6 && centerPixelDelta.meanChannelDifference < 1, JSON.stringify(centerPixelDelta));
    await page.locator('#lg-dynamic feDisplacementMap').evaluate(el => el.setAttribute('scale', '6'));
    await panel.evaluate(el => { el.getRootNode().querySelector('#glass-pixel-background').remove(); });
  });
  await check('液态与平面模式之间，所有前景颜色、字体和控件圆角保持一致', async () => {
    const glass = await styles(); await mode('flat');
    await page.waitForFunction(() => document.querySelector('#margin-root').shadowRoot.querySelector('.app').dataset.glass === 'flat');
    assert.deepEqual(await styles(), glass); assert.equal(await panel.evaluate(el => getComputedStyle(el, '::before').filter), 'none');
    await mode('soft'); await page.waitForTimeout(80);
    assert.match(await panel.evaluate(el => getComputedStyle(el, '::before').backdropFilter), /blur/);
    assert.equal(await panel.evaluate(el => getComputedStyle(el, '::before').filter), 'none');
    await mode('liquid'); await page.waitForTimeout(80);
  });
  await check('评论收起停止折射，重新展开保留草稿与现有纸飞机按钮', async () => {
    await panel.locator('textarea').fill('未发送的内容');
    await panel.getByRole('button', { name: '收起评论', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('#margin-root').shadowRoot.querySelector('.dy-cbox').classList.contains('dy-refract'));
    await card.locator('.dy-stat').getByRole('button', { name: /^评论 / }).click();
    assert.equal(await panel.locator('textarea').inputValue(), '未发送的内容');
    assert.equal(await panel.locator('.m-send-visual').count(), 1);
  });
  await check('转发长文展开后背景跟随卡片，没有贴图重算或尺寸锁定', async () => {
    const original = page.locator('.dy-orig'); await original.scrollIntoViewIfNeeded();
    const height = await original.evaluate(el => el.clientHeight); await original.locator('.dy-more').click();
    assert.ok(await original.evaluate((el, previous) => el.clientHeight > previous, height));
    assert.ok(await original.evaluate(el => el.clientHeight > 1000));
    await page.waitForTimeout(80);
    assert.match(await original.evaluate(el => getComputedStyle(el, '::after').filter), /lg-dynamic/);
    assert.equal(await original.evaluate(el => el.querySelectorAll('canvas, svg, img').length), 0);
    assert.equal(await original.evaluate(el => getComputedStyle(el, '::after').paddingTop), '8px');
    await original.evaluate(el => { const style = document.createElement('style'); style.id = 'glass-long-background'; style.textContent = '.app { background-image: url("data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1800"><defs><linearGradient id="g"><stop stop-color="#bbb"/><stop offset=".5" stop-color="#30343a"/><stop offset="1" stop-color="#999"/></linearGradient></defs><rect width="1000" height="1800" fill="url(#g)"/><path d="M-200 500C500 100 200 1300 1200 1200" fill="none" stroke="#b4b5b6" stroke-width="140"/></svg>') + '"); } .app > .bg { display:none!important; }'; el.getRootNode().append(style); });
    await original.evaluate(el => el.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: join(out, 'long-card-top.png') });
    await original.evaluate(el => el.scrollIntoView({ block: 'end' }));
    await page.screenshot({ path: join(out, 'long-card-bottom.png') });
    await original.evaluate(el => el.getRootNode().querySelector('#glass-long-background').remove());
    await original.locator('.dy-more').click();
  });
  await check('远离视口的面板停止折射，移回后重新启用', async () => {
    await panel.scrollIntoViewIfNeeded();
    await panel.evaluate(el => el.closest('.dy').style.marginBottom = '2200px');
    await page.locator('.dy-orig').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => !document.querySelector('#margin-root').shadowRoot.querySelector('.dy-cbox').classList.contains('dy-refract'));
    await panel.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector('#margin-root').shadowRoot.querySelector('.dy-cbox').classList.contains('dy-refract'));
    await panel.evaluate(el => el.closest('.dy').style.marginBottom = '');
  });
  await check('减少透明度时使用实底且不保留折射或模糊', async () => {
    const session = await ctx.newCDPSession(page);
    await session.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
    assert.equal(await panel.evaluate(el => getComputedStyle(el, '::before').filter), 'none');
    assert.equal(await panel.evaluate(el => getComputedStyle(el, '::before').backdropFilter), 'none');
    await session.send('Emulation.setEmulatedMedia', { features: [] }); await session.detach();
  });
  await check('窄窗口材质不改变面板宽度，输入／收起仍可操作，页面无脚本错误', async () => {
    await page.setViewportSize({ width: 600, height: 1000 }); await panel.scrollIntoViewIfNeeded();
    const width = await panel.evaluate(el => el.getBoundingClientRect().width);
    await mode('flat'); assert.equal(await panel.evaluate(el => el.getBoundingClientRect().width), width);
    await mode('liquid'); await panel.getByRole('button', { name: '收起评论', exact: true }).click();
    await card.locator('.dy-stat').getByRole('button', { name: /^评论 / }).click();
    assert.equal(await panel.locator('textarea').inputValue(), '未发送的内容');
    await panel.screenshot({ path: join(out, 'narrow.png') });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await panel.screenshot({ path: join(out, 'dark.png') });
    await worker.evaluate(async () => { const s = (await chrome.storage.local.get('margin:settings'))['margin:settings']; await chrome.storage.local.set({ 'margin:settings': { ...s, theme: 'light' } }); });
    await page.waitForTimeout(100); await panel.screenshot({ path: join(out, 'light.png') });
    assert.deepEqual(errors, []);
  });
} finally {
  writeFileSync(join(out, 'report.json'), JSON.stringify({ results, errors, centerPixelDelta, scope: 'Actual built extension in isolated Chromium; all HTTP mocked. No real account or comment writes.' }, null, 2));
  await ctx.close();
}
