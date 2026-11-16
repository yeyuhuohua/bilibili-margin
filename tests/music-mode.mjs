import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { installMocks } from './mocks.mjs';

const ext = resolve(process.env.SMOKE_EXT || 'dist'), out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/music-mode');
mkdirSync(out, { recursive: true });
const sr = 16000, samples = sr * 70, wav = Buffer.alloc(44 + samples * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sr, 24); wav.writeUInt32LE(sr * 2, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 330 / sr) * 4000), 44 + i * 2);
const chunk = readdirSync(join(ext, 'pages')).find(name => name.endsWith('.js') && readFileSync(join(ext, 'pages', name), 'utf8').includes('margin-music'));
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-listen-install-')), {
  channel: 'chromium', headless: true, viewport: { width: 1440, height: 900 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const results = [], errors = [], requests = [];
try {
  context.on('request', r => requests.push(r.url()));
  await installMocks(context);
  await context.route('https://www.bilibili.com/tone.wav', route => {
    const range = route.request().headers().range?.match(/bytes=(\d+)-(\d*)/), start = Number(range?.[1] || 0), end = range?.[2] ? Math.min(Number(range[2]), wav.length - 1) : wav.length - 1;
    return route.fulfill({ status: range ? 206 : 200, contentType: 'audio/wav', headers: { 'accept-ranges': 'bytes', ...(range ? { 'content-range': `bytes ${start}-${end}/${wav.length}` } : {}) }, body: wav.subarray(start, end + 1) });
  });
  await context.route('https://www.bilibili.com/video/BV1mock00001/', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html><head><meta charset="utf-8"><meta property="og:image" content="https://i0.hdslb.com/bfs/mock/cover.jpg"></head><body>
    <div class="video-container-v1"><div class="left-container"><h1 class="video-title">当前作品 · 双视图安装回归</h1><p class="up-name">测试作者</p>
    <div class="bpx-player-container" data-screen="normal"><div class="bpx-player-video-wrap"><video id="native-video" src="/tone.wav" controls></video></div><div class="bpx-player-row-dm-wrap"><span class="bili-danmaku-x-dm">保留原生弹幕</span></div></div></div></div>
    <button id="native-play">原生播放</button><script>window.nativeVideo=document.querySelector('video');window.nativeFrame=document.querySelector('.bpx-player-container');window.nativeParent=nativeFrame.parentElement;window.nativeDM=document.querySelector('.bpx-player-row-dm-wrap');document.querySelector('#native-play').onclick=()=>nativeVideo.play();</script></body></html>` }));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': { intro: false, theme: 'dark', bg: { mode: 'fixed', shader: 'ice', intensity: .8 }, weather: false, footprint: false, wide: false, autoWeb: false } }));
  const page = await context.newPage(); page.setDefaultTimeout(6000); page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://www.bilibili.com/video/BV1mock00001/');
  const entry = page.locator('#margin-watch-top').getByRole('button', { name: '听歌', exact: true });
  await entry.waitFor(); assert(chunk); assert(!requests.some(u => u.endsWith('/pages/' + chunk)));
  const favoriteEntry = page.locator('#margin-watch-top').getByRole('button', { name: '收藏', exact: true });
  const entryBox = await entry.boundingBox(), favoriteBox = await favoriteEntry.boundingBox();
  assert.equal(entryBox.width, favoriteBox.width, 'icon-only listening entry must match neighboring shortcuts');
  assert.equal(entryBox.height, favoriteBox.height);
  assert.equal(await entry.locator('svg [data-iconmcp="headphones"]').count(), 1);
  assert.equal(await entry.getAttribute('data-tip'), '听歌模式');
  await worker.evaluate(async () => { const s=(await chrome.storage.local.get('margin:settings'))['margin:settings']; await chrome.storage.local.set({'margin:settings':{...s,headLabels:true}}); });
  await page.waitForFunction(() => document.querySelector('#margin-watch-top').shadowRoot.querySelector('.et-labels'));
  await page.waitForFunction(() => document.querySelector('#margin-watch-top').shadowRoot.querySelector('[aria-label="听歌"] > span').getBoundingClientRect().width > 20);
  await worker.evaluate(async () => { const s=(await chrome.storage.local.get('margin:settings'))['margin:settings']; await chrome.storage.local.set({'margin:settings':{...s,headLabels:false}}); });
  await page.waitForFunction(() => !document.querySelector('#margin-watch-top').shadowRoot.querySelector('.et-labels'));
  await page.waitForFunction(() => document.querySelector('#margin-watch-top').shadowRoot.querySelector('[aria-label="听歌"] > span').getBoundingClientRect().width === 0);
  await page.locator('#margin-watch-top').screenshot({path:join(out,'header-unified.png')});
  results.push('headphones shortcut matches sibling dimensions and follows shared icon/label preferences');
  await page.locator('#native-play').click(); await page.waitForFunction(() => nativeVideo.currentTime > .1 && nativeVideo.seekable.length);
  const shaderTime = selector => page.evaluate(selector => {
    const host = document.querySelector(selector), canvas = host?.shadowRoot?.querySelector(selector === '#margin-bg' ? 'canvas' : '.fv-ambient');
    const gl = canvas?.getContext('webgl'), program = gl?.getParameter(gl.CURRENT_PROGRAM);
    if (!program) return null;
    return gl.getUniform(program, gl.getUniformLocation(program, selector === '#margin-bg' ? 'u_t' : 'u_time'));
  }, selector);
  await page.evaluate(() => { window.sharedBackground = document.querySelector('#margin-bg'); window.sharedCanvas = sharedBackground.shadowRoot.querySelector('.bg canvas'); });
  const ordinaryBefore = await shaderTime('#margin-bg'); await page.waitForTimeout(180); const ordinaryAfter = await shaderTime('#margin-bg');
  await entry.click();
  const panel = page.locator('#margin-music');
  await panel.getByRole('tab', { name: '视频视图', exact: true }).waitFor({ timeout: 3000 });
  await panel.getByRole('tab', { name: '聆听视图', exact: true }).waitFor();
  assert.equal(await panel.locator('.mm-grid').count(), 0);
  assert(requests.some(u => u.endsWith('/pages/' + chunk)));
  results.push('the installed entry loads the new dual-view module, not the old cover/lyrics layout');
  await panel.getByText('原生视频与弹幕 · 实时音频频谱', { exact: true }).waitFor();
  const canvas = panel.locator('canvas[aria-label="实时音频频谱"]'), first = await canvas.evaluate(el => el.toDataURL());
  await page.waitForTimeout(180); assert.notEqual(await canvas.evaluate(el => el.toDataURL()), first);
  results.push('playing native media automatically enables real spectrum without an enable click');
  await panel.getByRole('tab', { name: '声波样式', exact: true }).click();
  assert.equal(await panel.getByRole('tab', { name: '声波样式', exact: true }).getAttribute('aria-selected'), 'true');
  assert.equal(await panel.locator('.fv-ambient').count(), 0);
  assert(await page.evaluate(() => document.querySelector('#margin-bg') === sharedBackground && sharedBackground.shadowRoot.querySelector('.bg canvas') === sharedCanvas));
  assert.equal(await panel.locator('.fv-app').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');
  assert.equal(await page.locator('#margin-bg').evaluate(el => getComputedStyle(el).zIndex), '2147482999');
  results.push('the original background canvas is reused under the glass surface with no second renderer');
  const setBg = async bg => {
    await worker.evaluate(async bg => { const r=await chrome.storage.local.get('margin:settings'); await chrome.storage.local.set({'margin:settings':{...r['margin:settings'],bg}}); },bg);
    try {await page.waitForFunction(bg => { const el=sharedBackground.shadowRoot.querySelector('.bg'); return el.dataset.mode===bg.mode && (bg.mode!=='fixed'||el.dataset.shader===bg.shader) && Math.abs(Number(el.style.getPropertyValue('--bg-o'))-bg.intensity)<.001; },bg,{polling:50,timeout:30000});} catch(error) { console.log('BG_SYNC_DIAGNOSTIC',JSON.stringify({wanted:bg,actual:await page.evaluate(()=>({html:sharedBackground.shadowRoot.querySelector('.bg').outerHTML,connected:sharedBackground.isConnected})),stored:await worker.evaluate(()=>chrome.storage.local.get('margin:settings'))}));throw error; }
  };
  for (const shader of ['aurora','silk','mesh','grain','ice','veil','smoke','neuro','flow','rays','blend','flux','gate']) {
    await setBg({mode:'fixed',shader,intensity:.55});
    assert(await page.evaluate(() => sharedBackground.shadowRoot.querySelector('.bg canvas') === sharedCanvas));
  }
  results.push('all 13 home shader choices and intensity update live without replacing the renderer');
  await setBg({mode:'random',shader:'ice',pool:['grain'],intensity:.65});
  assert.equal(await page.locator('#margin-bg').locator('.bg').getAttribute('data-shader'),'grain');
  await panel.getByRole('button',{name:'返回普通播放',exact:true}).click();await entry.click();
  assert.equal(await page.locator('#margin-bg').locator('.bg').getAttribute('data-shader'),'grain');
  results.push('random background uses the selected pool and is not rerolled on entering or exiting listening mode');
  await worker.evaluate(()=>chrome.storage.local.set({'margin:bg-image':'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><path fill="teal" d="M0 0h4v4H0z"/></svg>')}));
  await setBg({mode:'image',shader:'ice',intensity:.45});
  assert.equal(await page.locator('#margin-bg').locator('.bg-img').evaluate(el=>getComputedStyle(el).display),'block');
  await page.waitForFunction(()=>getComputedStyle(sharedBackground.shadowRoot.querySelector('.bg-img')).backgroundImage.includes('data:image/svg+xml'),undefined,{polling:50});
  await setBg({mode:'off',shader:'ice',intensity:.45});
  assert.equal(await page.locator('#margin-bg').locator('.bg').evaluate(el=>getComputedStyle(el).display),'none');
  assert.equal(await page.locator('#margin-bg').evaluate(el=>getComputedStyle(el).display),'block');
  results.push('image and off modes stay in sync, with an opaque base so native page content cannot bleed through');
  await panel.getByRole('button',{name:'切换明暗主题',exact:true}).click();
  await page.waitForFunction(()=>document.documentElement.dataset.marginTheme==='light');
  assert(await panel.locator('.fv-app').evaluate(el=>el.classList.contains('fv-light')));
  await page.waitForTimeout(150);
  assert.equal(await worker.evaluate(async()=> (await chrome.storage.local.get('margin:settings'))['margin:settings'].theme),'light');
  await panel.getByRole('button',{name:'切换明暗主题',exact:true}).click();
  await page.waitForFunction(()=>document.documentElement.dataset.marginTheme==='dark');
  await setBg({mode:'fixed',shader:'ice',intensity:.8});
  results.push('the listening theme control updates the same persisted theme used by the home page');
  await page.evaluate(() => { const area=document.createElement('div');area.className='bpx-player-sending-area';area.textContent='晚挂载的原生弹幕发送栏';nativeFrame.append(area); });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.bpx-player-sending-area')).display === 'none', undefined, { timeout: 2500 });
  await panel.getByRole('button', { name: '展开弹幕输入', exact: true }).click();
  assert.notEqual(await page.locator('.bpx-player-sending-area').evaluate(el => getComputedStyle(el).display), 'none');
  await panel.getByRole('button', { name: '收起弹幕输入', exact: true }).click();
  assert.equal(await page.locator('.bpx-player-sending-area').evaluate(el => getComputedStyle(el).display), 'none');
  results.push('late native sending controls stay hidden until explicitly expanded in listening view');
  const identity = () => page.evaluate(() => ({ video: document.querySelector('video') === nativeVideo, frame: document.querySelector('.bpx-player-container') === nativeFrame, parent: nativeFrame.parentElement === nativeParent, dm: nativeFrame.contains(nativeDM), count: document.querySelectorAll('video').length }));
  const original = await identity(); assert.deepEqual(original, { video: true, frame: true, parent: true, dm: true, count: 1 });
  await panel.getByRole('button', { name: '暂停', exact: true }).click();
  await page.evaluate(() => { nativeVideo.currentTime = 12; nativeVideo.volume = .4; nativeVideo.playbackRate = 1.25; });
  const media = () => page.evaluate(() => ({ time: nativeVideo.currentTime, paused: nativeVideo.paused, volume: nativeVideo.volume, rate: nativeVideo.playbackRate }));
  const before = await media();
  for (const name of ['视频视图', '聆听视图']) { await panel.getByRole('tab', { name, exact: true }).click(); assert.deepEqual(await media(), before); assert.deepEqual(await identity(), original); }
  results.push('view switches preserve the same player, video, parent, danmaku, time, pause, volume and rate');
  await panel.getByLabel('本地歌词文件').setInputFiles({ name: 'local.lrc', mimeType: 'text/plain', buffer: Buffer.from('[00:00]第一句\n[00:12]当前句\n[00:24]跳转目标') });
  await panel.locator('button.lv-line').filter({ hasText: '跳转目标' }).click();
  assert.equal(await page.evaluate(() => nativeVideo.currentTime), 24);
  await page.waitForFunction(()=>document.querySelector('#margin-music').shadowRoot.querySelector('.lv-line[aria-current=true]')?.textContent==='跳转目标');
  results.push('local LRC remains editable and seeks the original timeline');
  await panel.getByRole('tab', { name: '视频视图', exact: true }).click();
  await page.addStyleTag({ content: '.left-container.late-sticky{position:sticky!important;top:0}' });
  await page.evaluate(() => nativeParent.classList.add('late-sticky'));
  assert(await page.evaluate(() => { const r=nativeFrame.getBoundingClientRect();return nativeFrame.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)); }), 'late native sticky positioning must not trap the video underneath the listening overlay');
  const slot = await panel.locator('.fv-stage').boundingBox(), frame = await page.locator('.bpx-player-container').boundingBox();
  for (const key of ['x', 'y', 'width', 'height']) assert(Math.abs(slot[key] - frame[key]) < 2);
  assert.equal(await page.locator('video').evaluate(el => getComputedStyle(el).opacity), '1');
  assert(await page.locator('.bili-danmaku-x-dm').isVisible());
  assert(frame.width > 1000 && frame.height > 400);
  await page.screenshot({ path: join(out, 'video-view.png'), animations: 'disabled' });
  results.push('desktop video view fills the main stage with the original video and native danmaku');
  await panel.getByRole('tab', { name: '聆听视图', exact: true }).click();
  await panel.locator('.lv-cover:not([hidden])').waitFor();
  await panel.locator('.lv-lyrics').evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)));
  await page.screenshot({ path: join(out, 'listening-view.png'), animations: 'disabled' });
  for (const width of [1920, 1440, 1024, 820]) {
    await page.setViewportSize({ width, height: 900 }); await page.waitForTimeout(100);
    assert(await panel.getByRole('button', { name: '返回普通播放', exact: true }).isVisible());
    const dock = await panel.locator('.fv-dock').boundingBox(); assert(dock.x >= 0 && dock.x + dock.width <= width + 1 && dock.y + dock.height <= 900);
  }
  results.push('desktop and narrow desktop windows retain accessible return and glass playback controls');
  await panel.getByRole('button', { name: '返回普通播放', exact: true }).click();
  assert(await panel.isHidden()); assert.deepEqual(await identity(), original);
  assert.equal(await page.locator('#margin-bg').evaluate(el=>getComputedStyle(el).zIndex),'-1');
  assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('margin-listening-bg')),false);
  const resumed = await shaderTime('#margin-bg'); await page.waitForTimeout(180);
  if (ordinaryBefore !== null && ordinaryAfter > ordinaryBefore) assert((await shaderTime('#margin-bg')) > resumed);
  assert.notEqual(await page.locator('.bpx-player-container').evaluate(el => getComputedStyle(el).position), 'fixed');
  await entry.click(); assert(await page.evaluate(() => nativeVideo.paused));
  await panel.getByRole('button', { name: '播放', exact: true }).click();
  await panel.getByText('原生视频与弹幕 · 实时音频频谱', { exact: true }).waitFor();
  await page.keyboard.press('Escape'); assert(await panel.isHidden());
  results.push('exit restores native layout; reopening keeps pause state and restarts analysis on playback');
  assert.deepEqual(errors, []);
  console.log(`PASS ${results.length} installed listening-mode groups`);
} finally {
  writeFileSync(join(out, 'report.json'), JSON.stringify({ results, errors, scope: 'Actual built/installed extension with offline native-media fixtures and a generated test tone; no account actions.' }, null, 2));
  await context.close();
}
