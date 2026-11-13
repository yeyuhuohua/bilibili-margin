import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { installMocks } from './mocks.mjs';
const ext=resolve(process.env.SMOKE_EXT || 'dist'),out=resolve(process.env.WATCH_LATER_OUT || 'delivery/watchlater-surface');
mkdirSync(out,{recursive:true});
const fixture=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
.watchlater-list{padding-top:24px;--layout-padding:48px}.watchlater-list-title{max-width:1280px;margin:auto;padding:0 48px;display:flex;justify-content:space-between;line-height:40px}.watchlater-list-title-left{display:flex;gap:8px}.watchlater-list-title h1{font-size:24px;margin:0}
.watchlater-list-nav{background:var(--bg1);margin:16px 0}.breadcrums-nav{max-width:1280px;margin:auto;padding:12px 48px;background:var(--bg1);display:flex;align-items:center;gap:12px}.watchlater-list-container{max-width:1280px;margin:auto;padding:0 48px;background:var(--bg1)}
.watchlater-list-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:32px 16px}.bili-video-card__cover{display:block;aspect-ratio:16/9;overflow:hidden;border-radius:6px}.bili-video-card__cover img{width:100%;height:100%;object-fit:cover}.bili-video-card__details{margin-top:10px}.bili-video-card__title{color:var(--text1);font-size:15px;line-height:22px;height:44px;overflow:hidden}.bili-video-card__subtitle{color:var(--text3);font-size:12px;margin-top:4px}
</style></head><body><div id="app"><main class="watchlater-list"><div class="watchlater-list-title"><div class="watchlater-list-title-left"><h1>稍后再看</h1><span>53</span></div><button>最近添加</button></div><div class="watchlater-list-nav"><div class="breadcrums-nav"><button id="progress">全部进度</button><button>未看完</button><button>更多筛选</button><button id="manage">批量管理</button><button id="play">播放全部</button></div></div><div class="watchlater-list-container"><div class="watchlater-list-grid">${Array.from({length:8},(_,i)=>`<article class="bili-card-checkbox"><div class="bili-video-card"><a class="bili-video-card__cover" href="https://www.bilibili.com/video/BV1kuxM6bE2A/"><img src="https://i0.hdslb.com/bfs/archive/watchlater-${i}.jpg"></a><div class="bili-video-card__details"><div class="bili-video-card__title">稍后再看测试视频 ${i+1} · 保留原生网格与播放链接</div><div class="bili-video-card__subtitle">测试作者 · 2026-11-09</div></div></div></article>`).join('')}</div></div></main></div><script>window.nativeActions=[];for(const id of ['progress','manage','play'])document.getElementById(id).addEventListener('click',()=>window.nativeActions.push(id));window.originalGrid=document.querySelector('.watchlater-list-grid');</script></body></html>`;
const context=await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(),'margin-watchlater-')),{
  executablePath:'C:/Users/asus/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe',headless:true,
  viewport:{width:1440,height:1000},args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`],
});
const results=[];
try{
  await installMocks(context);
  await context.route('https://www.bilibili.com/watchlater/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:fixture}));
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await worker.evaluate(()=>chrome.storage.local.set({'margin:settings':{intro:false,theme:'dark',bg:{mode:'off'}}}));
  const page=await context.newPage();
  await page.goto('https://www.bilibili.com/watchlater/list',{waitUntil:'domcontentloaded'});
  await page.locator('#margin-watch-top').waitFor();
  for(const theme of ['dark','light']){
    await worker.evaluate(theme=>chrome.storage.local.set({'margin:settings':{intro:false,theme,bg:{mode:'off'}}}),theme);
    await page.waitForFunction(theme=>document.documentElement.dataset.marginTheme===theme,theme);
    await page.evaluate(()=>{document.documentElement.classList.add('margin-has-bg');document.body.style.setProperty('background','linear-gradient(110deg,#d8d4c9,#17191e 48%,#d8d4c9) fixed','important')});
    const row=await page.evaluate(()=>Object.fromEntries(['.watchlater-list-nav','.watchlater-list-container','.breadcrums-nav','.bili-video-card'].map(selector=>{
      const el=document.querySelector(selector),s=getComputedStyle(el);return[selector,{background:s.backgroundColor,shape:s.getPropertyValue('corner-shape'),radius:s.borderTopLeftRadius}];
    })));
    await page.screenshot({path:join(out,theme+'.png')});results.push({theme,styles:row});
  }
  for(const id of ['progress','manage','play'])await page.locator('#'+id).click();
  assert.deepEqual(await page.evaluate(()=>window.nativeActions),['progress','manage','play']);
  assert.ok(await page.evaluate(()=>window.originalGrid===document.querySelector('.watchlater-list-grid')));
}finally{
  writeFileSync(join(out,'report.json'),JSON.stringify({results,scope:'Full extension with native-shaped authenticated-list fixture; sample content and actions only, no real account writes.'},null,2));
  await context.close();
}
for(const row of results){
  assert.equal(row.styles['.watchlater-list-nav'].background,'rgba(0, 0, 0, 0)','full-width native toolbar background must be transparent');
  assert.equal(row.styles['.watchlater-list-container'].background,'rgba(0, 0, 0, 0)','large list backing must be transparent');
  assert.notEqual(row.styles['.breadcrums-nav'].background,'rgba(0, 0, 0, 0)','toolbar text retains a readable local surface');
  assert.notEqual(row.styles['.bili-video-card'].background,'rgba(0, 0, 0, 0)','video text retains a readable local surface');
}
console.log(JSON.stringify({themes:results.length,nativeActions:3,nativeGridPreserved:true}));
