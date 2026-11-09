import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installMocks } from './mocks.mjs';

const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/live-home-theme');
mkdirSync(out, { recursive:true });
const extension = resolve(process.env.SMOKE_EXT || 'dist'), results = [], errors = [];
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-live-home-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath:process.env.CHROMIUM_PATH } : { channel:'chromium' }),
  headless:true, args:['--headless=new','--no-sandbox',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],
  viewport:{width:1440,height:1000}, locale:'zh-CN',
});
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  :root{--Ga1:#f7f7f7;--Ga2:#e3e5e7;--Ga6:#61666d;--Ga9:#18191c;--bg1_float:#fff;--text3:#61666d;--brand_blue:#00aeec}
  *{box-sizing:border-box}body{margin:0;background:var(--Ga1)}.link-navbar{height:64px;display:flex;gap:32px;align-items:center;padding:0 40px;background:#fff}
  .search-bar{width:240px;height:40px;border:1px solid #ddd;border-radius:8px;padding:8px}.nav-search-content{border:0;width:100%;height:100%;background:none}
  .player-area-ctnr{width:1160px;height:420px;margin:24px auto;display:grid;grid-template-columns:960px 176px;gap:24px}
  #live-player{background:#000;color:#fff}.aside-item{background:#164d6b;color:#fff}.highlight-areas-ctnr{width:1160px;margin:24px auto;display:flex;gap:24px}
  .highlight-area-item{display:block;width:180px;height:64px;background:var(--bg1_float);color:var(--Ga9)}.grid-area-ctnr{width:1160px;margin:auto;display:grid;grid-template-columns:2fr 1fr;gap:24px}
  .room-card-wrapper{height:240px}.cover-ctnr{height:180px;background:#164d6b}.text-info-ctnr.body-bg{background:var(--Ga1)}.room-card-ctnr .room-title{color:var(--Ga9)}
  .rank-ctnr{background:var(--bg1_float);height:240px;padding:20px}.rank-ctnr .room-anchor{color:var(--Ga9)}.tab-item{color:var(--Ga6)}.tab-item.activated{color:var(--brand_blue)}
  button{cursor:pointer}a{text-decoration:none}.room-anchor{margin:16px 0}.link-footer{margin-top:40px;padding:32px}
</style></head><body><nav class="link-navbar"><a class="nav-item" href="/p/eden/area-tags?parentAreaId=2"><span class="label">网游</span></a><div class="search-bar"><input class="nav-search-content" placeholder="搜索直播"></div><button class="startlive-btn">我要开播</button></nav>
<main><div class="player-area-ctnr"><div id="live-player"><video></video><span style="animation:danmaku 6s linear infinite">原生弹幕</span></div><div class="player-aside"><div class="aside-item">原生推荐</div></div></div>
<div class="highlight-areas-ctnr"><a class="highlight-area-item" href="/p/eden/area-tags?parentAreaId=2"><span class="area-name">网游</span></a><a class="highlight-area-item" href="/p/eden/area-tags?parentAreaId=9">虚拟主播</a></div>
<div class="grid-area-ctnr"><div class="room-card-wrapper"><a class="room-card-ctnr" href="/3"><div class="cover-ctnr"></div><div class="text-info-ctnr body-bg"><h3 class="room-title">直播标题</h3><span class="room-anchor">主播名称</span></div></a></div>
<aside class="rank-ctnr"><button class="tab-item activated">人气榜</button><button class="tab-item">大航海</button><button class="more-ctnr">刷新</button><div class="room-anchor">榜单主播</div></aside></div></main><footer class="link-footer">哔哩哔哩直播</footer>
<script>window.nativeVideo=document.querySelector('video');window.refreshes=0;document.querySelector('.more-ctnr').onclick=()=>window.refreshes++;for(const button of document.querySelectorAll('.tab-item'))button.onclick=()=>{document.querySelectorAll('.tab-item').forEach(b=>b.classList.remove('activated'));button.classList.add('activated')};</script></body></html>`;
try {
  await installMocks(context);
  await context.route('https://live.bilibili.com/**', route => new URL(route.request().url()).pathname === '/' ? route.fulfill({contentType:'text/html; charset=utf-8',body:html}) : route.fallback());
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const patch = value => worker.evaluate(async value => {
    const key='margin:settings', old=await chrome.storage.local.get(key);
    await chrome.storage.local.set({[key]:{...old[key],...value}});
  },value);
  await patch({watch:false,intro:false,theme:'dark',bg:{mode:'off'}});
  const page = await context.newPage(); page.on('pageerror',error=>errors.push(error.message));
  await page.goto('https://live.bilibili.com/');
  const geometry = () => page.evaluate(() => ['.link-navbar','.player-area-ctnr','#live-player','.highlight-areas-ctnr','.grid-area-ctnr','.rank-ctnr'].map(selector=>{
    const r=document.querySelector(selector).getBoundingClientRect();return{selector,x:r.x,y:r.y,w:r.width,h:r.height};
  }));
  await page.waitForTimeout(300);
  const before = await geometry();
  await patch({watch:true});
  await page.locator('html.margin-live-home').waitFor({state:'attached',timeout:5000});
  for(const theme of ['dark','light']) {
    await patch({theme});
    await page.locator(`html[data-margin-theme="${theme}"]`).waitFor({state:'attached'});
    assert.deepEqual(await geometry(),before,'native layout moved');
    const styles=await page.evaluate(()=>{
      const css=selector=>getComputedStyle(document.querySelector(selector));
      return {background:css('.rank-ctnr').backgroundColor,text:css('.rank-ctnr .room-anchor').color,radius:css('.cover-ctnr').borderRadius,
        playerColor:css('#live-player').color,danmaku:css('#live-player span').animationDuration,sameVideo:window.nativeVideo===document.querySelector('video')};
    });
    assert.equal(styles.background,theme==='dark'?'rgb(26, 26, 28)':'rgb(255, 255, 255)');
    assert.equal(styles.text,theme==='dark'?'rgb(237, 237, 238)':'rgb(23, 24, 26)');
    assert.equal(styles.radius,'16px');assert.equal(styles.playerColor,'rgb(255, 255, 255)');assert.equal(styles.danmaku,'6s');assert(styles.sameVideo);
    await page.screenshot({path:join(out,`${theme}.png`)});
    results.push({theme,styles}); console.log(`PASS ${theme} live home theme preserves native layout and media`);
  }
  await page.getByRole('button',{name:'大航海',exact:true}).click();
  assert.match(await page.getByRole('button',{name:'大航海',exact:true}).getAttribute('class'),/activated/);
  await page.getByRole('button',{name:'刷新',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.refreshes),1);
  await patch({accent:'pink',radius:50,theme:'auto',uiEffects:false});
  await page.emulateMedia({colorScheme:'dark'});
  await page.locator('html[data-margin-theme="dark"].margin-ui-still').waitFor({state:'attached'});
  assert.equal(await page.locator('.cover-ctnr').evaluate(el=>getComputedStyle(el).borderRadius),'8px');
  assert.equal(await page.locator('.tab-item.activated').evaluate(el=>getComputedStyle(el).color),'rgb(185, 47, 100)');
  assert.equal(await page.locator('#live-player span').evaluate(el=>getComputedStyle(el).animationDuration),'6s');
  await page.emulateMedia({colorScheme:'light'});
  await page.locator('html[data-margin-theme="light"]').waitFor({state:'attached'});
  assert.equal(await page.locator('#margin-watch-top').count(),0);
  assert.equal(await page.evaluate(()=>performance.getEntriesByType('resource').some(e=>e.name.includes('/pages/watch.js'))),false);
  console.log('PASS native tabs, refresh, accent, radius, auto theme and independent motion settings');
  await patch({watch:false});
  await page.locator('html.margin-live-home').waitFor({state:'detached'});
  assert.equal(await page.locator('.rank-ctnr').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)');
  await patch({watch:true});
  await page.goto('https://live.bilibili.com/?margin=off');
  await page.waitForTimeout(250);
  assert.equal(await page.locator('html.margin-live-home').count(),0);
  await page.goto('https://live.bilibili.com/');
  await page.locator('html.margin-live-home').waitFor({state:'attached'});
  await page.locator('.room-card-ctnr').click();
  await page.waitForURL('https://live.bilibili.com/3');
  await page.locator('html.margin-live').waitFor({state:'attached'});
  await page.locator('#margin-watch-top').waitFor({state:'attached'});
  await page.goto('https://live.bilibili.com/blackboard/activity');
  assert.equal(await page.locator('html.margin-live-home').count(),0);
  console.log('PASS native room navigation, disable restoration and bypass/activity routing');
  assert.deepEqual(errors,[]);
} finally {writeFileSync(join(out,'results.json'),JSON.stringify({results,errors},null,2));await context.close();}
