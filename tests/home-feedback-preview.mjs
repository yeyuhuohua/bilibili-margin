import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { installMocks } from './mocks.mjs';

const ext = resolve(process.env.SMOKE_EXT || 'dist');
const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/home-feedback');
mkdirSync(out, { recursive: true });
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-home-feedback-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, viewport: { width: 1680, height: 920 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});

const topics = [
  ['沿着山路，看见冰川', '山间记录', 'mountains'],
  ['雾中的海岸', '海边放映室', 'coast'],
  ['森林里的光', '慢慢看', 'forest'],
  ['日落之前', '日常取景', 'dusk'],
];
const upload = (i, late = false) => {
  const [title, author, cover] = topics[i % topics.length];
  return {
    id_str: String(8100 + i), type: 'DYNAMIC_TYPE_AV',
    modules: {
      module_author: { mid: i + 100, name: author, face: 'https://i0.hdslb.com/bfs/margin-preview/forest.webp', pub_ts: 1795062800 - i * 1800 },
      module_dynamic: { major: { archive: {
        bvid: `BV1follow${String(i).padStart(3, '0')}`, title: late ? '下一页的投稿' : title,
        cover: `https://i0.hdslb.com/bfs/margin-preview/${cover}.webp`,
        duration_text: '12:08', stat: i ? { play: '1.2万' } : { play: '1.2万', danmaku: 0 },
      } } },
    },
  };
};
const requests = [];
try {
  await installMocks(ctx, address => {
    const url = new URL(address);
    if (!url.pathname.endsWith('/feed/all') || url.searchParams.get('type') !== 'video') return;
    const offset = url.searchParams.get('offset');
    requests.push(offset);
    if (offset) return { code: 0, data: { items: [upload(36, true)], has_more: true, offset } };
    const notUpload = { ...upload(90), type: 'DYNAMIC_TYPE_FORWARD' };
    const ad = upload(91);
    ad.modules.module_dynamic.major.archive.is_ad = true;
    return { code: 0, data: { items: [notUpload, ad, ...Array.from({ length: 36 }, (_, i) => upload(i))], has_more: true, offset: 'next-follow-page' } };
  });
  if (process.env.PREVIEW_COVERS) {
    await ctx.route('https://i0.hdslb.com/bfs/margin-preview/**', route => {
      const asset = /\/(mountains|coast|forest|dusk)\.webp/.exec(new URL(route.request().url()).pathname)?.[1];
      if (!asset) return route.abort();
      return route.fulfill({ contentType: 'image/webp', body: readFileSync(join(process.env.PREVIEW_COVERS, asset + '.webp')) });
    });
  }
  const worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': {
    intro: false, theme: 'dark', weather: false, footprint: false, glass: 'liquid', cols: 4, bg: { mode: 'off' },
  } }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://www.bilibili.com/');
  const app = page.locator('#margin-root .app.home');
  const grid = app.locator('.home-grid');
  const cards = grid.locator('.card:not(.sk)');
  const original = app.locator('.top .et-btn[aria-label="原版"]');
  const ranking = app.getByRole('link', { name: '打开 B 站排行榜', includeHidden: true });
  await cards.first().waitFor();
  assert.equal(await app.locator('.home-exit').count(), 0);
  assert.equal(await original.isVisible(), true);
  assert.equal(requests.length, 0, 'homepage must not prefetch the following tab');
  assert.equal(await ranking.isVisible(), false);
  await app.getByRole('tab', { name: '热门', exact: true }).click();
  await cards.first().waitFor();
  assert.equal(await ranking.getAttribute('href'), 'https://www.bilibili.com/v/popular/rank/all');
  assert.equal(await ranking.isVisible(), true);
  await app.getByRole('tab', { name: '关注', exact: true }).click();
  await cards.first().getByText('沿着山路，看见冰川', { exact: true }).waitFor();
  assert.equal(await ranking.isVisible(), false);
  assert.equal(await cards.count(), 36, 'reposts and sponsored archive entries must stay out of the grid');
  assert.equal(await cards.first().locator('.dur').textContent(), '12:08');
  assert.equal(await cards.first().locator('[aria-label="0 弹幕"]').count(), 1);
  assert.equal(await cards.nth(1).locator('[aria-label$=" 弹幕"]').count(), 0);
  assert.equal(await cards.first().locator('.meta > .pubtime').count(), 1);
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(out, 'following.png') });
  await app.locator('.top .user.in').hover();
  await app.locator('.idcl-front').waitFor();
  const accountCard = await app.locator('.idcl-card').evaluate(el => ({
    cssWidth: el.offsetWidth, actualWidth: el.getBoundingClientRect().width,
  }));
  assert.equal(accountCard.cssWidth, 260);
  assert(Math.abs(accountCard.actualWidth - accountCard.cssWidth) < 1, 'account card is painted at native display size');
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(out, 'account-card.png') });
  await page.mouse.move(40, 60);
  await app.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await grid.getByText('下一页的投稿', { exact: true }).waitFor();
  assert.deepEqual(requests, ['', 'next-follow-page'], 'read the next cursor once and terminate on a repeated cursor');
  await app.getByRole('tab', { name: '热门', exact: true }).click();
  await app.getByRole('tab', { name: '关注', exact: true }).click();
  await grid.getByText('下一页的投稿', { exact: true }).waitFor();
  assert.equal(requests.length, 2, 'switching back reuses the prior following list and cursor');

  const sticky = await app.evaluate(async el => {
    const mark = el.querySelector('.bar-mark');
    const bar = el.querySelector('.bar');
    const top = mark.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 72;
    const seq = [];
    for (const point of [-3, 12, 5, 1, 5, -3]) {
      el.scrollTop = top + point;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      seq.push(bar.classList.contains('stuck'));
    }
    return seq;
  });
  assert.deepEqual(sticky, [false, true, true, true, true, false], 'small scroll changes within the sticky threshold retain the current state');
  await page.setViewportSize({ width: 410, height: 740 });
  const tabs = app.locator('.bar .tabs');
  assert(await tabs.evaluate(el => el.getBoundingClientRect().right <= innerWidth));

  await page.setViewportSize({ width: 1500, height: 930 });
  await page.goto('https://www.bilibili.com/video/BV1mdxN68E7F/');
  await page.locator('#margin-watch-top').waitFor();
  await page.evaluate(() => {
    const popup = document.createElement('div');
    popup.className = 'usercard-wrap';
    popup.style.cssText = 'position:fixed;z-index:12000;top:120px;right:90px;width:320px';
    popup.innerHTML = '<div class="user-card-m-exp"><div class="bg" style="background-image:linear-gradient(130deg,#3c515d,#73968f)"></div>'
      + '<div class="user-info-wrapper"><div class="face" style="background:#56857e"></div><div class="info">'
      + '<div class="user"><a class="name">山间记录</a></div><div class="sign">记录路上遇见的山、河和人。更新长途徒步与独立纪录片。</div>'
      + '<div class="social"><span><span>24.6万</span><span class="tip_text">粉丝</span></span><span><span>128</span><span class="tip_text">投稿</span></span></div>'
      + '<div class="btn-box"><a class="follow-btn">关注</a><a class="message-btn">发消息</a></div></div></div></div>';
    document.body.append(popup);
  });
  const profile = page.locator('.usercard-wrap .user-card-m-exp');
  assert.equal(await profile.locator('.social').evaluate(el => getComputedStyle(el).display), 'grid');
  assert.equal(await profile.locator('.sign').evaluate(el => getComputedStyle(el).webkitLineClamp), '2');
  await profile.screenshot({ path: join(out, 'creator-card.png') });

  await page.evaluate(() => {
    for (const [outer, inner] of [['', 'collection-m-exp'], ['follow-dialog-wrap-exp', 'follow-dialog-window']]) {
      const root = document.createElement('div');
      root.className = outer;
      const dialog = document.createElement('div');
      dialog.className = inner;
      dialog.style.cssText = 'background:rgb(83, 16, 15);border-radius:3px';
      dialog.innerHTML = '<div class="title">原生弹窗</div><div class="content"><label><input type="checkbox">选择列表</label></div><div class="bottom"><button class="btn submit-move" disabled>确定</button></div>';
      if (outer) { root.append(dialog); document.body.append(root); }
      else document.body.append(dialog);
    }
  });
  const dialogs = page.locator('.collection-m-exp, .follow-dialog-window');
  const skins = await dialogs.evaluateAll(els => els.map(el => ({
    radius: parseFloat(getComputedStyle(el).borderTopLeftRadius),
    bg: getComputedStyle(el).backgroundColor,
    disabled: el.querySelector('button').disabled,
  })));
  assert(skins.length === 2 && skins.every(style => style.radius >= 16 && style.bg !== 'rgb(83, 16, 15)' && style.disabled));
  await dialogs.first().locator('input[type=checkbox]').check();
  assert(await dialogs.first().locator('input[type=checkbox]').isChecked());
  assert.deepEqual(errors, []);
  console.log('PASS: following feed, cursor/cache, ranking, card layout, sticky threshold, compact return button and native popup styles');
} finally {
  await ctx.close();
}
