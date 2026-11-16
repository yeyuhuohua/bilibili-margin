import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { installMocks } from './mocks.mjs';
const ext = resolve(process.env.SMOKE_EXT || 'dist'), out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/music-cover'); mkdirSync(out, { recursive:true });
const good = 'https://i0.hdslb.com/bfs/mock/good-cover.png', bad = 'https://i0.hdslb.com/bfs/mock/broken-cover.jpg';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(),'margin-cover-')),{channel:'chromium',headless:true,viewport:{width:1280,height:900},args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
const results=[], errors=[], images=[]; let mode='broken-poster', failGood=false;
try {
  await installMocks(context, raw=>new URL(raw).pathname==='/x/web-interface/view' ? mode==='bad-api' ? {code:0,data:{title:'封面测试',pic:bad}} : {code:-500,message:'模拟视频信息接口暂不可用'} : undefined);
  await context.route(good, route=>{images.push(good);return failGood ? route.fulfill({status:503,body:'temporary failure'}) : route.fulfill({contentType:'image/png',body:png});});
  await context.route(bad, route=>{images.push(bad);return route.fulfill({status:404,body:'missing'});});
  await context.route('https://www.bilibili.com/video/BV1mock00001/',route=>route.fulfill({contentType:'text/html;charset=utf-8',body:`<!doctype html><html><head><meta charset="utf-8">${mode==='late-cover'?'':`<meta property="og:image" content="${good}">`}</head><body><h1 class="video-title">封面测试</h1><div class="bpx-player-container"><div class="bpx-player-video-wrap"><video ${mode==='broken-poster'?`poster="${bad}"`:mode==='blob-poster'?'poster="blob:https://www.bilibili.com/unavailable"':''}></video></div></div></body></html>`}));
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await worker.evaluate(()=>chrome.storage.local.set({'margin:settings':{intro:false,theme:'dark',bg:{mode:'off'},weather:false,footprint:false}}));
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  for (mode of ['broken-poster','blob-poster','bad-api','late-cover']) {
    await page.goto('https://www.bilibili.com/video/BV1mock00001/');await page.locator('#margin-watch-top').getByRole('button',{name:'听歌',exact:true}).click();
    const panel=page.locator('#margin-music');
    if(mode==='late-cover')await page.evaluate(url=>{const meta=document.createElement('meta');meta.setAttribute('property','og:image');meta.content=url;document.head.append(meta);},good);
    await page.waitForFunction(()=>{const img=document.querySelector('#margin-music')?.shadowRoot.querySelector('.lv-cover');return img&&!img.hidden&&img.complete&&img.naturalWidth>0;},{},{timeout:6000});
    assert.equal(await panel.locator('.lv-cover').getAttribute('src'),good);
    await page.waitForTimeout(300);
    assert(await panel.locator('.lv-cover').evaluate(img=>!img.hidden&&img.complete&&img.naturalWidth>0));
    results.push(mode);console.log(`PASS ${mode}`);await panel.getByRole('button',{name:'返回普通播放',exact:true}).click();
  }
  mode='retry';failGood=true;
  await page.goto('https://www.bilibili.com/video/BV1mock00001/');await page.locator('#margin-watch-top').getByRole('button',{name:'听歌',exact:true}).click();
  const panel=page.locator('#margin-music');await panel.getByRole('button',{name:'重试封面',exact:true}).waitFor();
  const before=images.length;await page.waitForTimeout(1300);assert.equal(images.length,before,'failed image should not be polled repeatedly');
  failGood=false;await panel.getByRole('button',{name:'重试封面',exact:true}).click();
  await page.waitForFunction(()=>{const img=document.querySelector('#margin-music').shadowRoot.querySelector('.lv-cover');return !img.hidden&&img.complete&&img.naturalWidth>0;});results.push('explicit retry after failure without automatic request loop');
  assert.deepEqual(errors,[]);
} finally {writeFileSync(join(out,'report.json'),JSON.stringify({results,errors,images,scope:'Built extension with deterministic failed image requests and decoded local PNG; no account operations.'},null,2));await context.close();}
