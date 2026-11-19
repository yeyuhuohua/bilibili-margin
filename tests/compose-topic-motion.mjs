import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { installMocks } from './mocks.mjs';

const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/compose-topic-motion');
const debugShots = process.env.TOPIC_DEBUG_DIR ? resolve(process.env.TOPIC_DEBUG_DIR) : '';
const profileDir = resolve('.debug/compose-topic-motion-profile');
mkdirSync(out, { recursive: true });
if (debugShots) mkdirSync(debugShots, { recursive: true });
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

function composeWithNativeTransitionsHtml() {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>发动态 - bilibili</title><style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
    .bili-dyn-publishing { background: #fff; }
    .bili-dyn-publishing__topic { position: relative; }
    .bili-dyn-publishing__title { height: 24px; overflow: hidden; padding-right: 48px; }
    .bili-rich-textarea__inner { height: 52px; min-height: 24px; }
    .bili-topic-search { transition: opacity .3s ease; }
    .bili-topic-search__popover {
      position: absolute; top: 0; left: 0; display: flex; width: 96px; height: 24px; z-index: 11;
      background: #1a1a1c; border: 1px solid #2c2c30; border-radius: 14px;
      transition: all .3s ease;
    }
    .bili-topic-search__popover.active { top: -12px; left: 0; }
    .bili-topic-search__input { height: 22px; box-sizing: border-box; cursor: text; transition: all .3s ease; }
    .bili-topic-search__input__inner { display: none; border: 0; outline: 0; width: 100%; }
    .bili-topic-search__popover.active .bili-topic-search__input { height: 32px; margin: 16px 16px 12px; }
    .bili-topic-search__popover.active .bili-topic-search__input__text { display: none; }
    .bili-topic-search__popover.active .bili-topic-search__input__inner { display: block; }
    .bili-topic-search__result { height: 0; overflow: hidden auto; transition: height .3s ease; }
    .bili-topic-search__loading { padding: 14px 16px; text-align: center; color: #8a8b90; font-size: 13px; }
    .bili-topic-item__cloud { padding: 10px 16px; cursor: pointer; }
    .bili-topic-item__cloud__info { padding-left: 20px; }
    .bili-topic-item__cloud__name { height: 20px; overflow: hidden; color: #ededee; font-size: 14px; }
    .bili-topic-item__cloud__desc { height: 17px; overflow: hidden; color: #8a8b90; font-size: 12px; }
    .bili-topic-selector__bulletin { position: relative; transition: opacity .3s ease; }
    .bili-topic-item__normal { display: inline-flex; align-items: center; gap: 6px; height: 32px; color: #00aeec; font-size: 14px; }
    .bili-topic-selector__bulletin__clear { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; cursor: pointer; }
  </style></head><body><div id="bili-header-container"></div><div id="app"><div class="bgc"></div><div class="bg"></div><div class="bili-dyn-home--member"><aside class="left"></aside><main>
  <section><div class="bili-dyn-publishing"><div class="bili-dyn-publishing__topic"><div class="bili-topic-search"><div class="bili-topic-search__popover"><div class="bili-topic-search__input"><span class="bili-topic-search__input__text">选择话题</span><input class="bili-topic-search__input__inner" placeholder="搜索话题"></div><div class="bili-topic-search__result"></div></div></div></div>
  <div class="bili-dyn-publishing__title"><input class="bili-dyn-publishing__title__input" placeholder="好的标题更容易获得支持，选填20字"></div>
  <div class="bili-dyn-publishing__input"><div class="bili-rich-textarea"><div class="bili-rich-textarea__inner empty" contenteditable="true" placeholder="有什么想和大家分享的？">\u200b</div></div></div>
  <div class="bili-dyn-publishing__control"><div class="bili-dyn-publishing__tools"><div class="bili-dyn-publishing__tools__item emoji"><svg><path d="M0 0h22v22H0z"/></svg></div></div><div class="bili-dyn-publishing__headquarters"><div class="bili-dyn-publishing__hint">0</div><div class="bili-dyn-publishing__action launcher disabled">发布</div></div></div>
  </div></section></main><aside class="right"></aside><div class="bili-dyn-sidebar"></div></div></div>
  <script>
    const topicHost = document.querySelector('.bili-dyn-publishing__topic');
    const searchWrap = document.querySelector('.bili-topic-search');
    const popover = document.querySelector('.bili-topic-search__popover');
    const result = document.querySelector('.bili-topic-search__result');
    let fetchTimer = 0, leaveTimer = 0;

    function bindTopics() {
      result.querySelectorAll('.bili-topic-item__cloud').forEach((item) => item.addEventListener('click', () => {
        clearTimeout(fetchTimer);
        popover.classList.remove('active');
        topicHost.querySelector('.bili-topic-selector__bulletin')?.remove();
        const selected = document.createElement('div');
        selected.className = 'bili-topic-selector__bulletin';
        selected.innerHTML = '<div class="bili-topic-item__normal"><span class="bili-topic-item__normal__name">'
          + item.querySelector('.bili-topic-item__cloud__name').textContent
          + '</span><div class="bili-topic-selector__bulletin__clear">×</div></div>';
        selected.querySelector('.bili-topic-selector__bulletin__clear').addEventListener('click', () => {
          clearTimeout(leaveTimer);
          selected.remove();
          searchWrap.style.display = '';
        });
        topicHost.append(selected);
        // Simulate Bilibili Vue leave window where .bili-topic-search remains in DOM briefly
        leaveTimer = setTimeout(() => { searchWrap.style.display = 'none'; }, 300);
      }));
    }

    document.querySelector('.bili-topic-search__input').addEventListener('click', () => {
      if (popover.classList.contains('active')) return;
      popover.classList.add('active');
      result.innerHTML = '<div class="bili-topic-search__loading">搜索中</div>';
      clearTimeout(fetchTimer);
      fetchTimer = setTimeout(() => {
        result.innerHTML = '<div class="bili-topic-search__list">' + Array.from({ length: 8 }, (_, i) =>
          '<div class="bili-topic-item cloud"><div class="bili-topic-item__cloud"><div class="bili-topic-item__cloud__info">'
          + '<div class="bili-topic-item__cloud__title"><div class="bili-topic-item__cloud__name">' + (i === 1 ? '巴黎最前线' : '测试话题 ' + (i + 1)) + '</div></div>'
          + '<div class="bili-topic-item__cloud__desc">8.5亿浏览·95.1万讨论</div></div></div></div>').join('') + '</div>';
        bindTopics();
      }, 90);
    });

    document.querySelector('.bili-dyn-publishing__title__input').addEventListener('click', () => {
      clearTimeout(fetchTimer);
      popover.classList.remove('active');
    });
  </script></body></html>`;
}

function passed(name) {
  results.push(name);
  console.log(`PASS ${name}`);
}

try {
  await installMocks(context);
  await context.route('https://t.bilibili.com/?compose=1*', (route) => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: composeWithNativeTransitionsHtml(),
  }));

  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': { intro: false, theme: 'dark', bg: { mode: 'off' } } }));

  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('https://t.bilibili.com/?compose=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.classList.contains('margin-compose')
    && getComputedStyle(document.querySelector('.bili-dyn-publishing')).backgroundColor === 'rgb(26, 26, 28)', null, { timeout: 15_000 });

  if (debugShots) await page.screenshot({ path: join(debugShots, '01-idle.png') });

  // 1. Open topic popover: immediately solid, full width, GPU animation, no native transition bleed
  const openLoading = await page.evaluate(() => {
    const input = document.querySelector('.bili-topic-search__input');
    const popover = document.querySelector('.bili-topic-search__popover');
    const result = document.querySelector('.bili-topic-search__result');
    input.click();
    const ps = getComputedStyle(popover);
    const rs = getComputedStyle(result);
    return {
      active: popover.classList.contains('active'),
      transitionDuration: ps.transitionDuration,
      resultTransitionDuration: rs.transitionDuration,
      bg: ps.backgroundColor,
      opacity: parseFloat(ps.opacity),
      animationName: ps.animationName,
      popoverWidth: popover.offsetWidth,
      popoverHeight: popover.offsetHeight,
      resultHeight: result.offsetHeight,
    };
  });
  assert.equal(openLoading.active, true);
  assert.equal(openLoading.transitionDuration, '0s', 'native transition on popover should be disabled');
  assert.equal(openLoading.resultTransitionDuration, '0s', 'native transition on result container should be disabled');
  assert.equal(openLoading.bg, 'rgb(26, 26, 28)', 'popover must be immediately opaque on open');
  assert(openLoading.opacity >= 0.2, `popover starts too faint (blank flash): ${openLoading.opacity}`);
  assert.equal(openLoading.animationName, 'm-topic-pop-in');
  assert(openLoading.popoverWidth >= 320, `popover opened too narrow: ${openLoading.popoverWidth}`);
  if (debugShots) await page.screenshot({ path: join(debugShots, '02-open-loading.png') });
  passed('opening popover is immediately opaque and full-width with GPU entrance animation');

  // 2. Async topic list loads with zero container height jump
  await page.waitForSelector('.bili-topic-search__list');
  const openLoaded = await page.evaluate(() => {
    const popover = document.querySelector('.bili-topic-search__popover');
    const result = document.querySelector('.bili-topic-search__result');
    const list = document.querySelector('.bili-topic-search__list');
    return {
      popoverHeight: popover.offsetHeight,
      resultHeight: result.offsetHeight,
      scrollHeight: result.scrollHeight,
      clientHeight: result.clientHeight,
      listAnim: getComputedStyle(list).animationName,
    };
  });
  assert(Math.abs(openLoaded.popoverHeight - openLoading.popoverHeight) <= 2,
    `popover height jumped from ${openLoading.popoverHeight} to ${openLoaded.popoverHeight}`);
  assert(Math.abs(openLoaded.resultHeight - openLoading.resultHeight) <= 2,
    `result height jumped from ${openLoading.resultHeight} to ${openLoaded.resultHeight}`);
  assert(openLoaded.scrollHeight > openLoaded.clientHeight, 'topic list should remain scrollable');
  assert.equal(openLoaded.listAnim, 'm-topic-list-in');
  await page.waitForTimeout(240);
  if (debugShots) await page.screenshot({ path: join(debugShots, '03-open-loaded.png') });
  passed('async topic list arrival keeps stable height with smooth list entrance');

  // 3. Selecting a topic suppresses lingering popover overlap immediately during leave window
  const duringLeave = await page.evaluate(() => {
    const item = document.querySelectorAll('.bili-topic-item__cloud')[1];
    item.click();
    const searchWrap = document.querySelector('.bili-topic-search');
    const popover = document.querySelector('.bili-topic-search__popover');
    const bulletin = document.querySelector('.bili-topic-selector__bulletin');
    const clear = document.querySelector('.bili-topic-selector__bulletin__clear');
    const clearRect = clear.getBoundingClientRect();
    const hit = document.elementFromPoint(clearRect.left + clearRect.width / 2, clearRect.top + clearRect.height / 2);
    return {
      popoverOpacity: getComputedStyle(popover).opacity,
      popoverVisibility: getComputedStyle(popover).visibility,
      popoverPointerEvents: getComputedStyle(popover).pointerEvents,
      searchOpacity: getComputedStyle(searchWrap).opacity,
      searchTransition: getComputedStyle(searchWrap).transitionDuration,
      bulletinTransition: getComputedStyle(bulletin).transitionDuration,
      bulletinChildAnim: getComputedStyle(bulletin.firstElementChild).animationName,
      bulletinChildOpacity: parseFloat(getComputedStyle(bulletin.firstElementChild).opacity),
      clearHit: !!hit?.closest('.bili-topic-selector__bulletin__clear'),
    };
  });
  assert.equal(duringLeave.popoverOpacity, '0', 'inactive popover must hide immediately when topic is selected');
  assert.equal(duringLeave.popoverVisibility, 'hidden');
  assert.equal(duringLeave.popoverPointerEvents, 'none');
  assert.equal(duringLeave.searchOpacity, '0');
  assert.equal(duringLeave.searchTransition, '0s');
  assert.equal(duringLeave.bulletinTransition, '0s');
  assert.equal(duringLeave.bulletinChildAnim, 'm-topic-tag-in');
  assert(duringLeave.bulletinChildOpacity >= 0.2, `selected tag starts too faint (blank flash): ${duringLeave.bulletinChildOpacity}`);
  assert.equal(duringLeave.clearHit, true, 'clear button must not be covered by leaving popover');
  if (debugShots) await page.screenshot({ path: join(debugShots, '04-selected-during-leave.png') });
  await page.waitForTimeout(240);
  if (debugShots) await page.screenshot({ path: join(debugShots, '05-selected-settled.png') });
  passed('selecting a topic prevents ghost overlap and animates the selected topic tag cleanly');

  // 4. Clearing selected topic restores the trigger cleanly with aligned left edge and pointer cursor
  await page.locator('.bili-topic-selector__bulletin__clear').click();
  const afterClear = await page.evaluate(() => {
    const popover = document.querySelector('.bili-topic-search__popover');
    const input = document.querySelector('.bili-topic-search__input');
    const ps = getComputedStyle(popover);
    const is = getComputedStyle(input);
    return {
      popoverOpacity: ps.opacity,
      popoverVisibility: ps.visibility,
      cursor: is.cursor,
      paddingLeft: is.paddingLeft,
      inputAnim: is.animationName,
    };
  });
  assert.equal(afterClear.popoverOpacity, '1');
  assert.equal(afterClear.popoverVisibility, 'visible');
  assert.equal(afterClear.cursor, 'pointer');
  assert.equal(afterClear.paddingLeft, '0px');
  assert.equal(afterClear.inputAnim, 'm-topic-trigger-in');
  passed('clearing selected topic restores the topic trigger cleanly');

  // 5. Clicking outside dismisses popover cleanly without shrinking ghost
  await page.locator('.bili-topic-search__input').click();
  await page.waitForSelector('.bili-topic-search__list');
  await page.locator('.bili-dyn-publishing__title__input').click();
  const afterOutside = await page.evaluate(() => {
    const popover = document.querySelector('.bili-topic-search__popover');
    const ps = getComputedStyle(popover);
    return {
      active: popover.classList.contains('active'),
      bg: ps.backgroundColor,
      borderWidth: ps.borderWidth,
      transitionDuration: ps.transitionDuration,
    };
  });
  assert.equal(afterOutside.active, false);
  assert.equal(afterOutside.bg, 'rgba(0, 0, 0, 0)');
  assert.equal(afterOutside.borderWidth, '0px');
  assert.equal(afterOutside.transitionDuration, '0s');
  passed('outside click closes topic popover cleanly without lingering styles');

  // 6. Reduced motion disables animations
  await page.evaluate(() => document.documentElement.classList.add('margin-reduce'));
  await page.locator('.bili-topic-search__input').click();
  await page.waitForSelector('.bili-topic-search__list');
  const reducedAnim = await page.evaluate(() => ({
    pop: getComputedStyle(document.querySelector('.bili-topic-search__popover')).animationName,
    list: getComputedStyle(document.querySelector('.bili-topic-search__list')).animationName,
  }));
  assert.equal(reducedAnim.pop, 'none');
  assert.equal(reducedAnim.list, 'none');
  passed('reduced motion disables topic animations');

  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: results.length }));
} finally {
  writeFileSync(join(out, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  await context.close();
  rmSync(profileDir, { recursive: true, force: true });
  const debugDir = resolve('.debug');
  if (readdirSync(debugDir).length === 0) rmSync(debugDir, { recursive: true, force: true });
}
