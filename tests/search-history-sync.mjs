import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { installMocks } from './mocks.mjs';

const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/search-history-sync');
const profileDir = resolve('.debug/search-history-sync-profile');
mkdirSync(out, { recursive: true });
mkdirSync(resolve('.debug'), { recursive: true });
rmSync(profileDir, { recursive: true, force: true });

const extension = resolve(process.env.SMOKE_EXT || 'dist');
const results = [];
const errors = [];
const context = await chromium.launchPersistentContext(profileDir, {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true,
  args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  viewport: { width: 1440, height: 900 },
  locale: 'zh-CN',
});

function mockSearchHtml(keyword = '') {
  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nativeChips = Array.from({ length: 12 }, (_, i) => `<div class="history-item" tabindex="0"><div class="history-text">原版仅存历史_${i + 1}</div></div>`).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>搜索 - bilibili</title><style>
    .search-header { display: flex; justify-content: center; margin-top: 24px; }
    .search-input-wrap { position: relative; display: flex; align-items: center; width: 640px; }
    .search-input-el { flex: 1; border: 0; outline: none; background: none; }
    .clear-icon { cursor: pointer; }
    .search-panel-popover { position: absolute; top: 100%; left: 0; width: 100%; font: 14px/1.25 -apple-system, system-ui, sans-serif; }
    .search-panel-popover .history .header, .search-panel-popover .trending .header { display: flex; justify-content: space-between; padding: 0 16px; }
    .search-panel-popover .histories-wrap { padding: 0 16px; overflow: hidden; max-height: 92px; }
    .search-panel-popover .histories { display: flex; flex-wrap: wrap; margin-top: 12px; margin-right: -10px; margin-bottom: 4px; }
    .search-panel-popover .history-item { position: relative; box-sizing: border-box; height: 30px; padding: 7px 10px 8px; font-size: 12px; line-height: 15px; border-radius: 4px; margin: 0 10px 10px 0; cursor: pointer; }
    .search-panel-popover .history-item .history-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 96px; }
    .search-panel-popover .history-item .close { display: none; position: absolute; width: 16px; height: 16px; top: -6px; right: -6px; }
    .search-panel-popover .history-item:hover .close { display: block; }
    .search-panel-popover .history-fold-wrap { display: flex; align-items: center; justify-content: center; width: 64px; margin: 0 auto 14px; font-size: 14px; }
    .search-panel-popover .history-fold-wrap .fold-text { width: 48px; font-size: 12px; line-height: 15px; height: 15px; white-space: normal; }
    .search-panel-popover .history-fold-wrap .fold-icon { width: 12px; height: 12px; margin-left: 2px; }
  </style></head><body>
  <div id="app">
    <div class="search-header">
      <div class="search-input-wrap flex_between">
        <svg class="search-icon" viewBox="0 0 24 24" width="24" height="24"></svg>
        <div class="clear-icon" title="清空">×</div>
        <input class="search-input-el" value="${esc(keyword)}" placeholder="输入关键字搜索" aria-label="搜索">
        <button type="button" class="search-button">搜索</button>
        <div class="search-panel search-panel-popover" style="display: none;">
          <div class="history native-history">
            <div class="header"><div class="title">搜索历史</div><div class="clear">清空</div></div>
            <div class="histories-wrap"><div class="histories">${nativeChips}</div></div>
            <div class="history-fold-wrap"><div class="fold-text">展开更多</div><svg class="fold-icon fold" viewBox="0 0 12 12"><path d="M2 4l4 4 4-4"></path></svg></div>
          </div>
          <div class="trending"><div class="header"><div class="title">bilibili热搜</div></div><div class="trendings-double"><div class="trendings-col"><div class="trending-item" tabindex="0"><span class="trendings-rank">1</span><div class="trending-text">来自热搜点击</div></div></div></div></div>
        </div>
      </div>
    </div>
    <div class="search-content"><div class="video-list"><div class="bili-video-card" data-k="normal"><a href="https://www.bilibili.com/video/BV1test00001"><div class="bili-video-card__info--tit">普通搜索结果</div></a><div class="bili-video-card__info--author">正常UP</div></div></div></div>
  </div>
  <script>
    const wrap = document.querySelector('.search-input-wrap');
    const input = wrap.querySelector('.search-input-el');
    const pop = wrap.querySelector('.search-panel-popover');
    const nativeHist = pop.querySelector('.native-history');
    const trending = pop.querySelector('.trending');
    let suggEl = null;
    function syncPanel() {
      const q = input.value.trim();
      if (q && !suggEl) {
        suggEl = document.createElement('div');
        suggEl.className = 'suggestions';
        suggEl.innerHTML = '<div class="suggest-item" tabindex="0"><em class="suggest_high_light">' + q.replace(/</g, '') + '</em>联想词</div>';
        nativeHist.remove();
        trending.remove();
        pop.append(suggEl);
        suggEl.querySelector('.suggest-item').addEventListener('click', () => {
          input.value = '联想词完整查询';
          pop.style.display = 'none';
          history.replaceState(null, '', '/all?keyword=' + encodeURIComponent(input.value));
        });
      } else if (!q && suggEl) {
        suggEl.remove();
        suggEl = null;
        pop.append(nativeHist, trending);
      }
    }
    input.addEventListener('focus', () => { pop.style.display = ''; syncPanel(); });
    input.addEventListener('input', syncPanel);
    wrap.querySelector('.clear-icon').addEventListener('click', () => {
      input.value = '';
      pop.style.display = '';
      syncPanel();
      input.focus();
    });
    wrap.querySelector('.search-button').addEventListener('click', () => {
      const q = input.value.trim();
      pop.style.display = 'none';
      if (q) history.replaceState(null, '', '/all?keyword=' + encodeURIComponent(q));
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim()) {
        pop.style.display = 'none';
        history.replaceState(null, '', '/all?keyword=' + encodeURIComponent(input.value.trim()));
      }
    });
    trending.querySelector('.trending-item').addEventListener('click', () => {
      input.value = '来自热搜点击';
      pop.style.display = 'none';
      history.replaceState(null, '', '/all?keyword=' + encodeURIComponent(input.value));
    });
  </script></body></html>`;
}

try {
  await installMocks(context);
  await context.route(/^https:\/\/search\.bilibili\.com\//, async (route) => {
    const req = route.request();
    if (req.resourceType() === 'document') {
      const kw = new URL(req.url()).searchParams.get('keyword') ?? '';
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: mockSearchHtml(kw) });
    }
    return route.fallback();
  });

  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', (err) => errors.push(err.message));
  const passed = (name) => { results.push(name); console.log(`PASS ${name}`); };

  async function readDynamicPaletteHistory(p) {
    await p.goto('https://t.bilibili.com/', { waitUntil: 'domcontentloaded' });
    await p.locator('#margin-root .top .search').click();
    const list = p.locator('#margin-root .cp[data-open="true"] .cp-list');
    await list.locator('.cp-gt', { hasText: '热搜' }).waitFor();
    return list.evaluate((el) => {
      const group = [...el.querySelectorAll('.cp-group')].find((g) => g.querySelector('.cp-gt')?.textContent?.includes('最近搜索'));
      if (!group) return [];
      return [...group.querySelectorAll('.cp-item .cp-t')].map((n) => n.textContent?.trim() ?? '');
    });
  }

  // 1. searchHistory: false -> native "展开更多" stays on a single line and does not write history
  for (const theme of ['light', 'dark']) {
    await worker.evaluate((t) => chrome.storage.local.set({ 'margin:settings': { intro: false, theme: t, bg: { mode: 'off' }, searchHistory: false } }), theme);
    await worker.evaluate(() => chrome.storage.local.remove('margin:private-search-history'));
    await page.goto('https://search.bilibili.com/all', { waitUntil: 'domcontentloaded' });
    await page.locator('.search-input-el').click();
    await page.locator('.search-panel-popover .history-fold-wrap').waitFor();
    const fold = await page.evaluate(() => {
      const wrap = document.querySelector('.search-panel-popover .history-fold-wrap');
      const text = wrap.querySelector('.fold-text');
      const icon = wrap.querySelector('.fold-icon');
      const range = document.createRange();
      range.selectNodeContents(text.firstChild);
      return {
        attr: document.documentElement.getAttribute('data-margin-search-history'),
        clientRects: range.getClientRects().length,
        textRect: text.getBoundingClientRect().toJSON(),
        iconRect: icon.getBoundingClientRect().toJSON(),
        wrapRect: wrap.getBoundingClientRect().toJSON(),
        whiteSpace: getComputedStyle(text).whiteSpace,
      };
    });
    assert.equal(fold.attr, null);
    assert.equal(fold.clientRects, 1, JSON.stringify(fold));
    assert(fold.textRect.height <= 22, JSON.stringify(fold));
    assert(fold.wrapRect.width >= fold.textRect.width + fold.iconRect.width - 1, JSON.stringify(fold));
    await page.waitForTimeout(350);
    await page.screenshot({ path: join(out, `fold-${theme}.png`) });
    await page.locator('.search-input-el').fill('隐私关闭时搜索');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    assert.equal((await worker.evaluate(() => chrome.storage.local.get('margin:private-search-history')))['margin:private-search-history'], undefined);
    assert.equal(await page.evaluate(() => localStorage.getItem('margin:search-history')), null);
    passed(`fold ${theme} stays single-line and respects searchHistory=false`);
  }

  // 2. searchHistory: true -> Dynamic page and Search page share identical 8-item history
  const baseTime = Date.now();
  const initial8 = ['reka1', 'grok4.8', 'gemini', '纵贯线', '第五条', '第六条', '第七条', '第八条'];
  await worker.evaluate(({ items, base }) => chrome.storage.local.set({
    'margin:settings': { intro: false, theme: 'dark', bg: { mode: 'off' }, searchHistory: true },
    'margin:private-search-history': items.map((text, idx) => ({ text, at: base - idx * 1000 })),
  }), { items: initial8, base: baseTime });

  const dynBefore = await readDynamicPaletteHistory(page);
  assert.deepEqual(dynBefore, initial8);
  passed('dynamic palette shows all 8 MARGIN history entries');

  // Search directly from Dynamic page palette -> should appear first on Search page
  await page.locator('#margin-root .cp-panel .cp-input input').fill('来自_动态页搜索');
  await page.locator('#margin-root .cp-panel .cp-item').first().waitFor();
  const [newTab] = await Promise.all([
    context.waitForEvent('page', { timeout: 2000 }).catch(() => null),
    page.keyboard.press('Enter'),
  ]);
  if (newTab) await newTab.close();
  await page.waitForTimeout(200);

  await page.goto('https://search.bilibili.com/all', { waitUntil: 'domcontentloaded' });
  await page.locator('.search-input-el').click();
  await page.locator('.search-panel-popover .margin-search-history .history-item').first().waitFor();
  const expectedAfterDyn = ['来自_动态页搜索', ...initial8.slice(0, 7)];
  const searchAfterDyn = await page.evaluate(() => ({
    attr: document.documentElement.dataset.marginSearchHistory,
    nativeDisplay: getComputedStyle(document.querySelector('.search-panel-popover .native-history')).display,
    marginItems: [...document.querySelectorAll('.search-panel-popover .margin-search-history .history-text')].map((el) => el.textContent),
  }));
  assert.equal(searchAfterDyn.attr, 'on');
  assert.equal(searchAfterDyn.nativeDisplay, 'none');
  assert.deepEqual(searchAfterDyn.marginItems, expectedAfterDyn);
  await page.waitForTimeout(350);
  const popBox = await page.locator('.search-panel-popover').boundingBox();
  assert(popBox && popBox.height > 80, JSON.stringify(popBox));
  await page.screenshot({ path: join(out, 'search-synced-dark.png') });
  passed('search page hides divergent native history and renders synced MARGIN history');

  // Typing hides MARGIN history during suggestions; clearing restores it
  await page.locator('.search-input-el').type('bil');
  await page.locator('.search-panel-popover .suggestions .suggest-item').waitFor();
  assert.equal(await page.locator('.search-panel-popover .margin-search-history').evaluate((el) => el.hidden), true);
  await page.locator('.search-input-wrap .clear-icon').click();
  await page.locator('.search-panel-popover .margin-search-history .history-item').first().waitFor();
  assert.equal(await page.locator('.search-panel-popover .margin-search-history').evaluate((el) => el.hidden), false);

  // Deleting an item on Search page keeps popover open & removes from Dynamic page too
  const targetChip = page.locator('.search-panel-popover .margin-search-history .history-item').nth(1);
  await targetChip.hover();
  await targetChip.locator('.close').click();
  await page.waitForTimeout(150);
  const afterDelete = await page.evaluate(() => ({
    popDisplay: getComputedStyle(document.querySelector('.search-panel-popover')).display,
    items: [...document.querySelectorAll('.search-panel-popover .margin-search-history .history-text')].map((el) => el.textContent),
  }));
  assert.notEqual(afterDelete.popDisplay, 'none');
  assert.deepEqual(afterDelete.items, expectedAfterDyn.filter((x) => x !== 'reka1'));

  // Searching via Search page input Enter, button click, and chip click all sync to Dynamic page
  await page.locator('.search-input-el').fill('来自_搜索页输入');
  await page.keyboard.press('Enter');
  await page.locator('.search-input-wrap .clear-icon').click();
  await page.locator('.search-panel-popover .margin-search-history .history-item').nth(2).click(); // promotes 'gemini' (index 2: 来自_搜索页输入, 来自_动态页搜索, grok4.8/gemini)
  const promotedWord = await page.evaluate(() => document.querySelector('.search-input-el').value);
  assert.equal(promotedWord, 'grok4.8');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.search-panel-popover')).display), 'none');
  await page.waitForTimeout(150);

  const dynAfterSearchOps = await readDynamicPaletteHistory(page);
  const searchAfterOpsStore = (await worker.evaluate(() => chrome.storage.local.get('margin:private-search-history')))['margin:private-search-history'].map((e) => e.text);
  assert.deepEqual(dynAfterSearchOps, searchAfterOpsStore);
  assert.equal(dynAfterSearchOps[0], 'grok4.8');
  assert.equal(dynAfterSearchOps[1], '来自_搜索页输入');
  assert.equal(dynAfterSearchOps.includes('reka1'), false);
  passed('deletions, submissions and chip clicks on search page sync back to dynamic page');

  // Clearing all on Search page clears Dynamic page too
  await page.goto('https://search.bilibili.com/all', { waitUntil: 'domcontentloaded' });
  await page.locator('.search-input-el').click();
  await page.locator('.search-panel-popover .margin-search-history .clear').click();
  await page.waitForTimeout(150);
  assert.equal(await page.locator('.search-panel-popover .margin-search-history').evaluate((el) => el.hidden), true);
  assert.equal(await page.locator('.search-panel-popover .native-history').evaluate((el) => getComputedStyle(el).display), 'none');
  assert.deepEqual(await readDynamicPaletteHistory(page), []);
  assert.equal(await page.evaluate(() => localStorage.getItem('margin:search-history')), null);
  passed('clearing history on search page clears dynamic page without leaking web localStorage');

  assert.deepEqual(errors, []);
} finally {
  writeFileSync(join(out, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  await context.close();
  rmSync(profileDir, { recursive: true, force: true });
  const debugDir = resolve('.debug');
  if (readdirSync(debugDir).length === 0) rmSync(debugDir, { recursive: true, force: true });
}
