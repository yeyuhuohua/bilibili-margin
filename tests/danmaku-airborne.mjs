// 真实扩展后台 + 原生 video：把弹幕注入到播放器的弹幕层里，验证标记、点击跳转和误判防护。
// 只把 B 站接口替换成离线样本；媒体用一段静音 WAV，交给浏览器真正解码和 seek。
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { installMocks } from './mocks.mjs';

const bvid = 'BV1mdxN68E7F', watch = `https://www.bilibili.com/video/${bvid}/`;
/** 「03:20」= 200 秒，视频得比它长，否则浏览器会把 seek 夹到时长尽头 */
const seconds = 300;
const dir = mkdtempSync(join(tmpdir(), 'margin-danmaku-test-'));
const ext = resolve(process.env.SMOKE_EXT || 'dist');
const ctx = await chromium.launchPersistentContext(dir, {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, viewport: { width: 1440, height: 900 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--autoplay-policy=no-user-gesture-required'],
});
try {
  await installMocks(ctx, () => null);
  await ctx.addInitScript(() => sessionStorage.setItem('margin:intro-played', '1'));
  // 五分钟静音 WAV，浏览器真正解码、播放并 seek，不覆盖媒体属性或事件。
  const wav = Buffer.alloc(44 + seconds * 8000 * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  await ctx.route('https://www.bilibili.com/margin-test.wav', (route) => {
    const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range ?? '');
    const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), wav.length - 1) : wav.length - 1;
    return route.fulfill({ status: range ? 206 : 200, contentType: 'audio/wav',
      headers: { 'accept-ranges': 'bytes', ...(range ? { 'content-range': `bytes ${start}-${end}/${wav.length}` } : {}) }, body: wav.subarray(start, end + 1) });
  });
  const page = ctx.pages()[0];
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const sw = ctx.serviceWorkers()[0] ?? await ctx.waitForEvent('serviceworker');
  const settings = (patch) => sw.evaluate(async (p) => {
    const current = (await chrome.storage.local.get('margin:settings'))['margin:settings'] ?? {};
    await chrome.storage.local.set({ 'margin:settings': { ...current, ...p } });
  }, patch);
  // 不写 danmakuAirborne，验证新装与旧设置默认关闭。
  await settings({ bg: { mode: 'off' }, intro: false });
  const stored = await sw.evaluate(async () => (await chrome.storage.local.get('margin:settings'))['margin:settings'] ?? {});
  assert.equal(stored.danmakuAirborne, undefined, '测试前置不该预写这个开关');
  await page.goto(watch, { waitUntil: 'domcontentloaded' });
  await page.locator('#margin-watch-top header.top').waitFor();
  await page.evaluate(async () => {
    const v = document.querySelector('.bpx-player-video-wrap video');
    v.src = '/margin-test.wav'; v.load();
    await new Promise((done) => v.addEventListener('loadedmetadata', done, { once: true }));
  });
  await page.waitForFunction(() => { const v = document.querySelector('video'); return v.readyState >= 2 && v.seekable.length && v.seekable.end(0) > 210; });
  const time = () => page.evaluate(() => document.querySelector('.bpx-player-video-wrap video').currentTime);
  assert.equal(await time(), 0);
  assert.equal(await page.evaluate(() => document.querySelector('.bpx-player-video-wrap video').paused), true);
  console.log('PASS offline watch page keeps the real player and a seekable native video');

  // 往播放器的弹幕层里注入两条弹幕：一条能读成「03:20」，一条是 233 大笑不该被标记。
  await page.evaluate(() => {
    const wrap = document.createElement('div');
    wrap.className = 'bpx-player-row-dm-wrap';
    wrap.style.cssText = 'position:relative;display:block;width:100%;height:100%;pointer-events:none';
    wrap.innerHTML = '<div class="bili-danmaku-x-dm" id="dm-air" style="position:absolute;left:80px;top:60px"><span>03:20</span></div>'
      + '<div class="bili-danmaku-x-dm" id="dm-laugh" style="position:absolute;left:80px;top:140px"><span>233</span></div>'
      + '<div class="bili-danmaku-x-dm" id="dm-bad" style="position:absolute;left:80px;top:220px"><span>3:99</span></div>';
    document.querySelector('.bpx-player-container').append(wrap);
  });
  await page.waitForTimeout(1200);
  assert.equal(await page.locator('.margin-dm-air').count(), 0);
  assert.equal(await page.evaluate(() => performance.getEntriesByType('resource').some(entry => entry.name.includes('/pages/danmaku-airborne.js'))), false);
  console.log('PASS default off: no marks or feature module loaded');
  await settings({ danmakuAirborne: true });
  await page.waitForFunction(() => document.getElementById('dm-air')?.classList.contains('margin-dm-air'), null, { timeout: 15000 });
  assert.equal(await page.locator('.margin-dm-air').count(), 1);
  assert.equal(await page.locator('#dm-laugh.margin-dm-air').count(), 0);
  // 秒数超出的畸形时间（3:99）算不出来，别标记
  assert.equal(await page.locator('#dm-bad.margin-dm-air').count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('margin-airborne')), true);
  const style = await page.evaluate(() => {
    const air = getComputedStyle(document.querySelector('#dm-air span'));
    const laugh = getComputedStyle(document.querySelector('#dm-laugh span'));
    return { airDeco: air.textDecorationLine, airEvents: air.pointerEvents, laughDeco: laugh.textDecorationLine, laughEvents: laugh.pointerEvents };
  });
  assert.match(style.airDeco, /underline/);
  assert.equal(style.airEvents, 'auto');
  assert.equal(style.laughDeco, 'none');
  assert.equal(style.laughEvents, 'none');
  console.log('PASS enabling marks only recognized times with underline and pointer events');

  // 真实鼠标点击标记过的弹幕：document 捕获阶段的监听把点击落到 video.currentTime 上。
  await page.locator('#dm-air span').click();
  await page.waitForFunction(() => Math.abs(document.querySelector('.bpx-player-video-wrap video').currentTime - 200) < 2, null, { timeout: 8000 });
  let now = await time();
  assert.ok(now >= 198 && now <= 202, `clicking 03:20 seeked to ${now}`);
  assert.equal(await page.evaluate(() => document.querySelector('.bpx-player-video-wrap video').paused), true);
  console.log(`PASS clicking an underlined danmaku seeks a paused video to ${now.toFixed(2)}s`);
  await page.locator('#margin-danmaku-airborne').getByRole('button', { name: '撤销跳转' }).click();
  await page.waitForFunction(() => document.querySelector('.bpx-player-video-wrap video').currentTime < 0.5);
  assert.equal(await page.locator('#margin-danmaku-airborne').count(), 0);
  assert.equal(await page.evaluate(() => document.querySelector('video').paused), true);
  await page.locator('#dm-air span').click();
  await page.waitForFunction(() => Math.abs(document.querySelector('video').currentTime - 200) < 0.5);
  console.log('PASS undo restores the exact previous position without changing paused state');

  // 点没被标记的弹幕（233）不该跳：鼠标原地点击会被弹幕层放行，元素派发也只走同一个监听。
  const before = await time();
  const box = await page.locator('#dm-laugh span').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.evaluate(() => document.getElementById('dm-laugh').click());
  await page.waitForTimeout(300);
  assert.ok(Math.abs((await time()) - before) < 0.5, `unmarked danmaku moved playback to ${await time()}`);
  assert.equal(await page.locator('#dm-laugh.margin-dm-air').count(), 0);
  console.log('PASS clicking a danmaku without a time (233) never seeks');

  // 弹幕元素会被复用：只换文字节点时也要重新判定标记。
  await page.evaluate(() => { document.querySelector('#dm-laugh span').textContent = '1:10'; });
  await page.waitForFunction(() => document.getElementById('dm-laugh').classList.contains('margin-dm-air'), null, { timeout: 15000 });
  await page.locator('#dm-laugh span').click();
  await page.waitForFunction(() => Math.abs(document.querySelector('.bpx-player-video-wrap video').currentTime - 70) < 2, null, { timeout: 8000 });
  now = await time();
  assert.ok(now >= 68 && now <= 72, `reused danmaku element seeking to ${now}`);
  console.log(`PASS a reused danmaku element that turns into 1:10 gets marked and seeks to ${now.toFixed(2)}s`);

  await page.evaluate(() => { document.querySelector('#dm-bad span').textContent = '6:00'; });
  await page.waitForFunction(() => document.getElementById('dm-bad').classList.contains('margin-dm-air'));
  await page.locator('#dm-bad span').click();
  assert.ok(Math.abs((await time()) - 70) < 0.5, 'out-of-range time must not seek to the video end');
  await page.locator('#margin-danmaku-airborne').getByRole('button', { name: '撤销跳转' }).click();
  await page.waitForFunction(() => Math.abs(document.querySelector('video').currentTime - 200) < 0.5);
  console.log('PASS out-of-range time does not seek or replace the last valid undo');

  await page.evaluate(() => document.querySelector('video').play());
  await page.locator('#dm-laugh span').click();
  assert.equal(await page.evaluate(() => document.querySelector('video').paused), false);
  await page.locator('#margin-danmaku-airborne').getByRole('button', { name: '撤销跳转' }).click();
  assert.equal(await page.evaluate(() => document.querySelector('video').paused), false);
  await page.evaluate(() => document.querySelector('video').pause());
  console.log('PASS playing video keeps playing through seek and undo');

  await page.locator('#dm-air span').click();
  await page.evaluate(() => {
    const video = document.querySelector('video');
    video.removeAttribute('src'); video.load();
  });
  await page.waitForFunction(() => !document.getElementById('margin-danmaku-airborne'));
  await page.locator('#dm-air span').click();
  assert.equal(await page.locator('#margin-danmaku-airborne').count(), 0);
  console.log('PASS replacing media clears undo and unknown duration cannot seek');

  // 关掉开关：标记、下划线和监听一起撤掉，再点也不跳。
  await settings({ danmakuAirborne: false });
  await page.waitForFunction(() => !document.getElementById('dm-air').classList.contains('margin-dm-air'), null, { timeout: 8000 });
  assert.equal(await page.locator('.margin-dm-air').count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('margin-airborne')), false);
  const afterOff = await time();
  await page.evaluate(() => document.getElementById('dm-air').click());
  await page.waitForTimeout(300);
  assert.ok(Math.abs((await time()) - afterOff) < 0.5, 'disabled switch still seeks');
  assert.deepEqual(errors, []);
  console.log('PASS turning the switch off clears every mark and stops seeking');
  await settings({ danmakuAirborne: true });
  await page.waitForFunction(() => document.getElementById('dm-air').classList.contains('margin-dm-air'));
  await page.evaluate(() => {
    const old = document.querySelector('.bpx-player-row-dm-wrap');
    window.removedDanmaku = old;
    const fresh = old.cloneNode(true);
    fresh.querySelectorAll('.margin-dm-air').forEach(el => el.classList.remove('margin-dm-air'));
    old.replaceWith(fresh);
  });
  await page.waitForFunction(() => document.getElementById('dm-air').classList.contains('margin-dm-air') && !window.removedDanmaku.querySelector('.margin-dm-air'));
  await page.evaluate(() => history.pushState({}, '', '/'));
  await page.waitForFunction(() => !document.querySelector('.margin-dm-air'));
  await page.evaluate(() => history.pushState({}, '', '/video/BV1mdxN68E7F/'));
  await page.waitForFunction(() => document.getElementById('dm-air').classList.contains('margin-dm-air'));
  assert.deepEqual(errors, []);
  console.log('PASS remounted layers and SPA route changes clean old marks and recover');
} finally {
  await ctx.close();
  assert.equal(dirname(dir), resolve(tmpdir()));
  assert.ok(basename(dir).startsWith('margin-danmaku-test-'));
  rmSync(dir, { recursive: true, force: true });
}
