import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installMocks } from './mocks.mjs';

const extension = resolve(process.env.SMOKE_EXT || 'dist');
const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/danmaku-jump');
mkdirSync(out, { recursive: true });
const results = [], errors = [], calls = [];
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-danmaku-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, viewport: { width: 1440, height: 900 },
  args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--autoplay-policy=no-user-gesture-required'],
});
try {
  await installMocks(context, url => url.includes('/x/web-interface/view?') ? { code: 0, data: { pages: [1, 2, 3, 4].map(page => ({ page, cid: 100 + page, duration: 120 })) } } : null);
  let dmDelay = 0;
  await context.route('https://api.bilibili.com/x/v1/dm/list.so*', async route => {
    const cid = new URL(route.request().url()).searchParams.get('oid');
    calls.push({ cid, cookie: route.request().headers().cookie });
    const text = cid === '101' ? '空降 01:30' : '跳伞 01:00';
    const authors = cid === '104' ? ['a123', 'a123', 'b234'] : ['a123', 'b234', 'c345'];
    const body = `<?xml version="1.0"?><i><chatid>${cid === '103' ? '999' : cid}</chatid>${authors.map((author, i) => `<d p="10,1,25,16777215,1234,0,${author},${i}">${text}</d>`).join('')}</i>`;
    if (dmDelay) await new Promise(resolve => setTimeout(resolve, dmDelay));
    await route.fulfill({ contentType: 'text/xml', headers: { 'access-control-allow-origin': '*' }, body }).catch(() => {});
  });
  const wav = Buffer.alloc(44 + 120 * 8000 * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  await context.route('https://www.bilibili.com/margin-danmaku.wav', route => {
    const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range ?? '');
    const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), wav.length - 1) : wav.length - 1;
    return route.fulfill({ status: range ? 206 : 200, contentType: 'audio/wav', body: wav.subarray(start, end + 1),
      headers: { 'accept-ranges': 'bytes', ...(range ? { 'content-range': `bytes ${start}-${end}/${wav.length}` } : {}) } });
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const settings = patch => worker.evaluate(async patch => {
    const current = (await chrome.storage.local.get('margin:settings'))['margin:settings'] ?? {};
    await chrome.storage.local.set({ 'margin:settings': { ...current, ...patch } });
  }, patch);
  await settings({ intro: false, bg: { mode: 'off' }, sponsorSkip: false });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(8000);
  let jumpModules = 0;
  page.on('request', request => { if (request.url().endsWith('/pages/danmaku-jump.js')) jumpModules++; });
  const time = () => page.evaluate(() => document.querySelector('video').currentTime);
  const playAt = async value => {
    await page.evaluate(async value => { const video = document.querySelector('video'); video.currentTime = value; await video.play(); }, value);
  };
  const part = async value => {
    await page.evaluate(value => history.pushState({}, '', `?p=${value}`), value);
    await page.waitForTimeout(1300);
  };
  const passed = name => { results.push({ name, ok: true }); console.log(`PASS ${name}`); };
  await page.goto('https://www.bilibili.com/video/BV14W4B6sET9/');
  await page.locator('#margin-watch-top .top').waitFor();
  await page.evaluate(async () => {
    const video = document.querySelector('video'); video.src = '/margin-danmaku.wav'; video.load();
    await new Promise(resolve => video.addEventListener('loadedmetadata', resolve, { once: true }));
  });
  await page.waitForFunction(() => { const video = document.querySelector('video'); return video.readyState === 4 && video.seekable.length && video.seekable.end(0) >= 120; });
  await page.waitForTimeout(1100);
  assert.equal(calls.length, 0); assert.equal(jumpModules, 0);
  passed('default off leaves the module and danmaku unloaded');
  await page.locator('#margin-watch-top .top [aria-label="设置"]').click();
  const toggle = page.getByRole('switch', { name: '弹幕跳转建议', exact: true });
  assert.equal(await toggle.getAttribute('aria-checked'), 'false');
  const firstResponse = page.waitForResponse(response => response.url().includes('/x/v1/dm/list.so'));
  await toggle.click(); await page.keyboard.press('Escape');
  await firstResponse;
  await playAt(11);
  const notice = page.locator('#margin-danmaku-jump');
  await notice.getByRole('button', { name: '跳转', exact: true }).waitFor();
  assert((await time()) < 20, 'suggestion sought before user click');
  assert.match(await notice.locator('[role=status]').innerText(), /3 人/);
  assert.equal(calls[0].cookie, undefined);
  await page.screenshot({ path: join(out, 'candidate.png') });
  passed('three independent senders show a candidate without seeking');
  await notice.getByRole('button', { name: '跳转', exact: true }).click();
  assert((await time()) >= 90 && (await time()) < 94);
  await notice.getByRole('button', { name: '撤销跳转', exact: true }).click();
  assert((await time()) >= 11 && (await time()) < 20);
  await page.waitForTimeout(400); assert.equal(await notice.count(), 0);
  passed('click seeks real media, undo restores the previous time once');
  await part(2); await playAt(11);
  await notice.getByRole('button', { name: '跳转', exact: true }).waitFor();
  assert.match(await notice.locator('[role=status]').innerText(), /1:00/);
  await notice.getByRole('button', { name: '忽略本次建议' }).click();
  await page.waitForTimeout(300); assert.equal(await notice.count(), 0);
  assert.equal(calls.length, 2);
  passed('part changes query matching CID, dismiss prevents repeat prompts');
  for (const invalid of [3, 4]) {
    await part(invalid); await playAt(11); await page.waitForTimeout(300);
    assert.equal(await notice.count(), 0); assert((await time()) < 20);
  }
  passed('wrong CID and repeated sender votes never become suggestions');
  dmDelay = 1200;
  const incoming = page.waitForRequest(request => request.url().includes('dm/list.so?oid=101'));
  await page.evaluate(() => history.pushState({}, '', '?p=1'));
  await incoming;
  await settings({ danmakuJump: false });
  await page.waitForTimeout(1500); await playAt(11); await page.waitForTimeout(300);
  assert.equal(await notice.count(), 0);
  const before = calls.length;
  await part(2); assert.equal(calls.length, before);
  passed('disable aborts in-flight work and stops further part queries');
  dmDelay = 0;
  await part(1); await settings({ danmakuJump: true }); await playAt(11);
  await notice.getByRole('button', { name: '跳转', exact: true }).waitFor();
  await context.route('https://bsbsb.top/api/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify([
    { videoID: 'BV14W4B6sET9', segments: [{ cid: '101', category: 'sponsor', actionType: 'skip', segment: [10, 20], videoDuration: 120, votes: 2 }] },
  ]) }));
  await settings({ sponsorSkip: true, privacyExternal: true });
  await page.locator('#margin-sponsor-notice button').waitFor();
  assert.equal(await notice.count(), 0, 'two notices overlap');
  assert((await time()) >= 20);
  passed('community skip replaces an earlier suggestion without overlapping controls');
  assert.deepEqual(errors, []);
} finally {
  writeFileSync(join(out, 'results.json'), JSON.stringify({ results, errors, calls }, null, 2));
  await context.close();
}
