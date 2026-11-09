import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installMocks } from './mocks.mjs';

const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/native-watch-feedback');
mkdirSync(out, { recursive: true });
const extension = resolve(process.env.SMOKE_EXT || 'dist'), results = [], errors = [];
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-native-feedback-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  viewport: { width: 1440, height: 900 }, locale: 'zh-CN',
});
try {
  await installMocks(context);
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const patch = value => worker.evaluate(async value => {
    const key = 'margin:settings', stored = await chrome.storage.local.get(key);
    await chrome.storage.local.set({ [key]: { ...stored[key], ...value } });
  }, value);
  await patch({ intro: false, theme: 'dark', bg: { mode: 'off' }, wide: false, autoWeb: false });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = '.video-toolbar-left-main{position:relative;display:flex;gap:16px;margin:50px 180px} .video-toolbar-left-item{display:flex;align-items:center;position:relative} .svga-container{position:absolute;z-index:99999} .svga-top{width:120px;height:120px} .video-like .svga-top{left:-32px;top:-100px} .svga-center{width:92px;height:92px} .video-like .svga-center{left:-18px;top:-26px}';
    document.head.append(style);
    const bar = document.createElement('div'); bar.className = 'video-toolbar-left-main';
    for (const kind of ['like', 'coin', 'fav']) {
      const button = document.createElement('button'); button.className = `video-${kind} video-toolbar-left-item`;
      const icon = document.createElement('img'); icon.className = 'video-toolbar-item-icon';
      icon.src = 'https://i0.hdslb.com/bfs/archive/native-icon.png'; icon.width = icon.height = 28;
      const count = document.createElement('span'); count.className = 'video-toolbar-item-text'; count.textContent = '123';
      button.append(icon, count); bar.append(button);
    }
    document.querySelector('.video-info-container').after(bar);
    const comments = document.createElement('bili-comments'), root = comments.attachShadow({ mode: 'open' });
    root.innerHTML = '<div id="contents"><bili-comment-thread-renderer></bili-comment-thread-renderer></div>';
    const thread = root.querySelector('bili-comment-thread-renderer').attachShadow({ mode: 'open' });
    thread.innerHTML = '<bili-comment-replies-renderer></bili-comment-replies-renderer>';
    const replies = thread.firstElementChild.attachShadow({ mode: 'open' });
    // Native commentpc loading overlay, verified from bili-comments.js.
    replies.innerHTML = '<style>#expander-contents{position:relative;min-height:160px}#spinner{position:absolute;left:0;top:0;width:100%;height:100%;background:rgba(var(--bg1_rgb),.85);display:flex;align-items:center;justify-content:center}</style><div id="expander-contents"><bili-comment-reply-renderer>回复正文</bili-comment-reply-renderer><div id="expander-footer"><button id="expand">展开回复</button><button id="next">下一页</button></div></div>';
    window.loadingFrames = [];
    for (const button of replies.querySelectorAll('button')) button.addEventListener('click', () => {
      const spinner = document.createElement('div'); spinner.id = 'spinner'; spinner.textContent = '加载中';
      replies.querySelector('#expander-contents').append(spinner);
      requestAnimationFrame(() => window.loadingFrames.push({ action:button.id, color:getComputedStyle(spinner).backgroundColor }));
      setTimeout(() => spinner.remove(), 200);
    });
    document.querySelector('#commentapp').append(comments);
  }));
  await page.goto('https://www.bilibili.com/video/BV1mdxN68E7F/');
  await page.locator('html.margin-triple').waitFor({ state: 'attached' });
  const check = async (name, run) => {
    try { const evidence = await run(); results.push({ name, ok:true, evidence }); console.log(`PASS ${name}`); }
    catch (error) { results.push({ name, ok:false, error:error.stack }); console.error(`FAIL ${name}: ${error.message}`); }
  };
  for (const zoom of [1, .8, 1.2]) await check(`91-native-like-position-${zoom}`, async () => {
    await page.evaluate(zoom => document.body.style.zoom = zoom, zoom);
    await page.locator('.video-like').scrollIntoViewIfNeeded();
    const evidence = await page.evaluate(() => {
      const button = document.querySelector('.video-like'), buttonBox = button.getBoundingClientRect(), results = [];
      for (const mode of ['top','center']) {
        const animation = document.createElement('div'); animation.className = `svga-container svga-${mode}`;
        button.append(animation);
        const before = animation.getBoundingClientRect(), display = getComputedStyle(animation).display;
        // Native SVGA measures the child first, then reparents it to body using document coordinates.
        animation.style.left = `${scrollX + before.left}px`; animation.style.top = `${scrollY + before.top}px`;
        document.body.append(animation);
        results.push({ mode, display, width:before.width, x:before.x, y:before.y, buttonX:buttonBox.x, buttonY:buttonBox.y });
        button.append(animation); animation.remove();
      }
      return { animations:results, iconDisplay:getComputedStyle(button.querySelector('img')).display };
    });
    for (const animation of evidence.animations) {
      assert.notEqual(animation.display, 'none');
      assert(animation.width > 60, JSON.stringify(animation));
      assert(Math.abs(animation.x - animation.buttonX) < 180 && Math.abs(animation.y - animation.buttonY) < 180, JSON.stringify(animation));
    }
    assert.notEqual(evidence.iconDisplay, 'none');
    return evidence;
  });
  await page.evaluate(() => document.body.style.zoom = '');
  for (const theme of ['dark','light','dark']) await check(`90-comment-loading-${theme}-${results.length}`, async () => {
    await patch({ theme });
    await page.locator(`html[data-margin-theme="${theme}"]`).waitFor({ state: 'attached' });
    await page.evaluate(() => window.loadingFrames = []);
    for (const action of ['expand','next','next']) {
      await page.locator(`bili-comments #${action}`).click();
      await page.locator('bili-comments #spinner').waitFor({ state:'detached' });
    }
    const frames = await page.evaluate(() => window.loadingFrames);
    assert.equal(frames.length, 3);
    const expected = theme === 'dark' ? 'rgba(26, 26, 28, 0.85)' : 'rgba(255, 255, 255, 0.85)';
    assert(frames.every(frame => frame.color === expected), JSON.stringify(frames));
    return frames;
  });
  assert.deepEqual(errors, []);
} finally { writeFileSync(join(out,'results.json'),JSON.stringify({results,errors},null,2)); await context.close(); }
if (results.some(result => !result.ok)) process.exitCode = 1;
