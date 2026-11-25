import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { installMocks } from './mocks.mjs';
const ext=resolve(process.env.SMOKE_EXT || 'dist'),out=resolve(process.env.WATCH_LATER_OUT || 'delivery/watchlater-surface');
mkdirSync(out,{recursive:true});
const wallpaper = 'url("data:image/svg+xml;base64,' + readFileSync(new URL('./fixtures/glass-wallpaper.svg', import.meta.url)).toString('base64') + '")';
const baseline = process.env.WATCH_LATER_BASELINE === '1';
const fixture=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
.watchlater-list{padding-top:24px;--layout-padding:48px}.watchlater-list-title{max-width:1280px;margin:auto;padding:0 48px;display:flex;justify-content:space-between;line-height:40px}.watchlater-list-title-left{display:flex;gap:8px}.watchlater-list-title h1{font-size:24px;margin:0}
.watchlater-list-nav{background:var(--bg1);margin:16px 0}.breadcrums-nav{max-width:1280px;margin:auto;padding:12px 48px;background:var(--bg1);display:flex;align-items:center;gap:12px}.watchlater-list-container{max-width:1280px;margin:auto;padding:0 48px;background:var(--bg1)}
.watchlater-list-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:32px 16px}.bili-video-card__cover{display:block;aspect-ratio:16/9;overflow:hidden;border-radius:6px}.bili-video-card__cover img{width:100%;height:100%;object-fit:cover}.bili-video-card__details{margin-top:10px}.bili-video-card__title{color:var(--text1);font-size:15px;line-height:22px;height:44px;overflow:hidden}.bili-video-card__subtitle{color:var(--text3);font-size:12px;margin-top:4px}
.list-header{width:100%;padding:20px 0}.list-header-main,.list-header-filter,.list-header-options{display:flex;align-items:center}.list-header-filter{width:100%;gap:8px}.list-header-options{gap:12px}.list-header-filter__btn,.action-btn{min-width:64px;white-space:nowrap}.breadcrums-nav{display:block;padding-block:0}.watchlater-list-nav{margin:10px 0}.order-btn{cursor:pointer;border:0;background:var(--bg1);border-radius:6px;color:var(--text1)}.watchlater-list-title__count{color:var(--text2)}
button,input{font:inherit;color:inherit}.watchlater-list button{cursor:pointer}.action-btn,.vui_button,.search-bar{border:1px solid var(--line_regular);border-radius:7px;padding:7px 10px;background:var(--bg1)}.search-bar{width:140px}.search-bar input{width:100%;background:transparent;border:0}.list-header-filter__btn{border:0;background:transparent}.list-header-filter__btn.active{color:var(--brand_blue);background:var(--bg1)}
</style></head><body><div id="app"><main class="watchlater-list"><div class="watchlater-list-title"><div class="watchlater-list-title-left"><h1>稍后再看</h1><span class="watchlater-list-title__count">· 49</span></div><button class="order-btn">最近添加</button></div><div class="watchlater-list-nav"><div class="breadcrums-nav"><div class="list-header"><div class="list-header-main"><div class="list-header-filter"><button id="progress" class="list-header-filter__btn active">全部进度</button><button class="list-header-filter__btn">未看完</button><div class="list-header-filter__more"><button class="vui_button">更多筛选</button></div></div><div class="list-header-options"><label class="search-bar"><input aria-label="搜索稍后再看" placeholder="搜索稍后再看"></label><button class="action-btn">清除已看完</button><button class="action-btn" id="manage">批量管理</button><button class="action-btn" id="play">播放全部</button></div></div></div></div></div><div class="watchlater-list-container"><div class="watchlater-list-grid">${Array.from({length:8},(_,i)=>`<article class="bili-card-checkbox"><div class="bili-video-card"><a class="bili-video-card__cover" href="https://www.bilibili.com/video/BV1kuxM6bE2A/"><img src="https://i0.hdslb.com/bfs/archive/watchlater-${i}.jpg"></a><div class="bili-video-card__details"><div class="bili-video-card__title">稍后再看测试视频 ${i+1} · 保留原生网格与播放链接</div><div class="bili-video-card__subtitle">测试作者 · 2026-11-09</div></div></div></article>`).join('')}</div></div></main></div><script>window.nativeActions=[];for(const id of ['progress','manage','play'])document.getElementById(id).addEventListener('click',()=>window.nativeActions.push(id));window.originalGrid=document.querySelector('.watchlater-list-grid');</script></body></html>`;
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
    await page.evaluate(wallpaper=>{document.documentElement.classList.add('margin-has-bg');document.body.style.setProperty('background',wallpaper+' center / cover fixed','important')}, wallpaper);
    for (const width of [1440, 760]) {
      await page.setViewportSize({ width, height: 900 });
    const row=await page.evaluate(()=>Object.fromEntries(['.watchlater-list-nav','.watchlater-list-container','.breadcrums-nav','.watchlater-list-title-left','.list-header-filter','.list-header-options','.bili-video-card'].map(selector=>{
      const el=document.querySelector(selector),s=getComputedStyle(el);return[selector,{background:s.backgroundColor,shape:s.getPropertyValue('corner-shape'),radius:s.borderTopLeftRadius}];
    })));
    const clip = await page.locator('.watchlater-list-nav').boundingBox();
      const title = await page.locator('.watchlater-list-title').boundingBox();
      await page.screenshot({path:join(out,theme+'-'+width+'.png'),clip:{x:0,y:title.y,width,height:Math.ceil(clip.y+clip.height-title.y+24)}});
      if (!baseline) {
        const filters=await page.locator('.list-header-filter').boundingBox(),actions=await page.locator('.list-header-options').boundingBox();
        assert(filters.width < width * .8 && actions.width < width * .85);
        assert(actions.x >= 0 && actions.x+actions.width <= width && (filters.y+filters.height <= actions.y+1 || filters.x+filters.width <= actions.x+1));
      }
      results.push({theme,width,styles:row});
    }
  }
  await page.getByRole('textbox',{name:'搜索稍后再看'}).fill('音乐');
  assert.equal(await page.getByRole('textbox',{name:'搜索稍后再看'}).inputValue(),'音乐');
  for(const id of ['progress','manage','play'])await page.locator('#'+id).click();
  assert.deepEqual(await page.evaluate(()=>window.nativeActions),['progress','manage','play']);
  assert.ok(await page.evaluate(()=>window.originalGrid===document.querySelector('.watchlater-list-grid')));
  if (!baseline) {
    const audit = [];
    for (const [name,url,selector] of [
      ['历史记录','https://www.bilibili.com/account/history','.hi-bar'],
      ['空间收藏夹','https://space.bilibili.com/2/favlist','.sp-bar .bar-row'],
      ['动态列表','https://t.bilibili.com/','.fd-bar'],
      ['首页收藏抽屉','https://www.bilibili.com/','.fav-body > .seg'],
    ]) {
      await page.goto(url);
      await page.locator('#margin-root .app').waitFor();
      if (selector.includes('fav-body')) await page.evaluate(()=>dispatchEvent(new Event('margin:open-fav')));
      const bar = page.locator('#margin-root '+selector);
      await bar.waitFor({timeout:12000});
      for (const theme of ['dark','light']) {
        await worker.evaluate(theme=>chrome.storage.local.set({'margin:settings':{intro:false,theme,glass:'liquid',bg:{mode:'off'}}}),theme);
        const app=page.locator('#margin-root .app[data-theme="'+theme+'"]');
        await app.waitFor();
        await app.evaluate((el,wallpaper)=>el.style.setProperty('background',wallpaper+' center / cover fixed','important'),wallpaper);
        for (const width of [1440,760]) {
          await page.setViewportSize({width,height:900});
          const row = await bar.evaluate(el=>{
            const s=getComputedStyle(el), parent=el.parentElement;
            return {background:s.backgroundColor, image:s.backgroundImage, width:el.getBoundingClientRect().width, available:parent.clientWidth};
          });
          const compactOrClear=row.width<row.available*.85 || (row.background==='rgba(0, 0, 0, 0)' && row.image==='none');
          audit.push({name,theme,width,compactOrClear,...row});
        }
      }
    }
    writeFileSync(join(out,'related-pages.json'),JSON.stringify(audit,null,2));
    assert.deepEqual(audit.filter(row=>!row.compactOrClear),[]);
  }
}finally{
  writeFileSync(join(out,'report.json'),JSON.stringify({results,scope:'Full extension with native-shaped authenticated-list fixture; sample content and actions only, no real account writes.'},null,2));
  await context.close();
}
for(const row of results){
  assert.equal(row.styles['.watchlater-list-nav'].background,'rgba(0, 0, 0, 0)','full-width native toolbar background must be transparent');
  assert.equal(row.styles['.watchlater-list-container'].background,'rgba(0, 0, 0, 0)','large list backing must be transparent');
  for (const selector of ['.breadcrums-nav','.watchlater-list-title-left'])
    assert.equal(row.styles[selector].background === 'rgba(0, 0, 0, 0)', !baseline, selector);
  if (!baseline) for (const selector of ['.list-header-options','.list-header-filter'])
    assert.notEqual(row.styles[selector].background,'rgba(0, 0, 0, 0)', selector);
  assert.notEqual(row.styles['.bili-video-card'].background,'rgba(0, 0, 0, 0)','video text retains a readable local surface');
}
console.log(JSON.stringify({themes:results.length,nativeActions:3,nativeGridPreserved:true}));
