// Native Bilibili music detail and mini player, not MARGIN listening mode.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { installMocks } from './mocks.mjs';
const out=resolve(process.env.SMOKE_OUT||'delivery/issues-181-184/native-overlays');mkdirSync(out,{recursive:true});
const ext=resolve(process.env.SMOKE_EXT||'dist'),checks=[];
const context=await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(),'margin-native-overlays-')),{channel:'chromium',headless:true,viewport:{width:1440,height:1000},args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
try{
 await installMocks(context);
 await context.route('https://www.bilibili.com/video/**',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><html><head><style>
 body{margin:0}.video-container-v1{width:1200px;margin:80px auto;display:flex;gap:24px}.left-container{width:850px;flex:none}.right-container{position:relative;width:326px;background:#333;min-height:1800px}
 #playerWrap{height:480px}.bpx-player-container{height:480px;background:#111}.bpx-player-container[data-screen=mini]{position:fixed;right:20px;bottom:20px;width:400px;height:225px;z-index:100}
 .video-toolbar-container,.video-desc-container,.video-tag-container{height:50px}#commentapp{height:1800px}
 #bgm-entry{position:absolute;width:326px;left:calc(100% + 24px);z-index:99}#musicApp{height:100%;background:#444;border-radius:6px;overflow:hidden}.mainWarp{height:100%;border-radius:6px}
 </style></head><body><div id=app><div class=video-container-v1><div class=left-container>
 <div class=video-info-container><h1 class=video-title>原生浮层回归</h1></div><div id=playerWrap><div class=bpx-player-container data-screen=normal><video muted></video></div></div>
 <div class=video-toolbar-container>操作</div><div class=video-desc-container>简介</div><div id=bgm-entry style="top:60px;height:480px;z-index:99"><div id=musicApp><div class=mainWarp>音乐详情</div></div></div><div class=video-tag-container>标签</div><div id=commentapp></div>
 </div><div class=right-container><div class=up-panel-container>UP 卡片</div><div id=danmukuBox>弹幕列表</div></div></div></div></body></html>`}));
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 await worker.evaluate(()=>chrome.storage.local.set({'margin:settings':{intro:false,wide:false,autoWeb:false,theme:'dark',radius:100,bg:{mode:'off'}}}));
 const page=await context.newPage();await page.goto('https://www.bilibili.com/video/BV1mdxN68E7F/');await page.locator('#margin-watch-top .top').waitFor();
 const hit=selector=>page.locator(selector).evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));});
 assert(await hit('#musicApp'),'native music panel is covered by sidebar');checks.push('native music panel receives pointer hits above sidebar');
 for(const radius of [0,50,100,150]){
  await worker.evaluate(radius=>chrome.storage.local.set({'margin:settings':{intro:false,wide:false,autoWeb:false,theme:'dark',radius,bg:{mode:'off'}}}),radius);
  await page.waitForFunction(expected=>parseFloat(getComputedStyle(document.querySelector('#musicApp')).borderTopLeftRadius)===expected,radius/100*20);
 }
 checks.push('native music detail follows all four radius settings');
 await page.screenshot({path:join(out,'native-music.png')});
 await page.evaluate(()=>{document.getElementById('bgm-entry').remove();document.querySelector('.bpx-player-container').dataset.screen='mini';window.scrollTo(0,800);});
 await page.waitForTimeout(250);assert(await hit('.bpx-player-container'),'mini player is covered by recommendations');
 checks.push('mini player remains above right column after scroll');
 await page.screenshot({path:join(out,'native-mini.png')});
 await page.evaluate(()=>{document.querySelector('.bpx-player-container').dataset.screen='normal';window.scrollTo(0,0);});
 await page.waitForTimeout(100);
 assert.equal(await page.locator('.left-container').evaluate(el=>getComputedStyle(el).zIndex),'auto');
 checks.push('normal player restores original column stacking');
}finally{await context.close();writeFileSync(join(out,'report.json'),JSON.stringify({checks},null,2));}
console.log(JSON.stringify({checks}));
