import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const out=resolve(process.env.SMOKE_OUT||'delivery/search-glass-live');mkdirSync(out,{recursive:true});
const ext=resolve(process.env.SMOKE_EXT||'dist'),results=[],errors=[];
const ctx=await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(),'margin-native-glass-')),{channel:'chromium',headless:true,viewport:{width:1440,height:1000},locale:'zh-CN',args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
try{
 const worker=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');
 await worker.evaluate(()=>chrome.storage.local.set({'margin:settings':{intro:false,theme:'dark',glass:'liquid',bg:{mode:'off'}}}));
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto('https://search.bilibili.com/video?keyword=lpl',{waitUntil:'domcontentloaded',timeout:30000});
 const tabs=page.locator('.search-tabs .vui_tabs--nav[data-margin-search-controls]');await tabs.waitFor({timeout:15000});
 const sorting=page.locator('.conditions-order .search-condition-row[data-margin-search-controls]').first();await sorting.waitFor({timeout:10000});
 await page.waitForFunction(()=>document.querySelector('.search-input-wrap')?.dataset.material==='lens'&&document.querySelector('.search-input-wrap')?.style.backdropFilter.includes('url('),{},{timeout:3000});
 results.push('visible native search input receives the live lens filter in liquid mode');
 const wallpaper=readFileSync(new URL('./fixtures/glass-wallpaper.svg',import.meta.url)).toString('base64');
 await page.addStyleTag({content:`html.margin-search body{background:url("data:image/svg+xml;base64,${wallpaper}") center/cover fixed!important}`});
 await page.waitForFunction(()=>!!document.querySelector('.vui_tabs--nav')?.style.getPropertyValue('--ms-w'));
 const geometry=await page.evaluate(()=>{
   const outer=document.querySelector('.search-tabs'),inner=outer.querySelector('.vui_tabs--nav');
   const sortOuter=document.querySelector('.search-conditions'),sort=sortOuter.querySelector('.search-condition-row');
   return {tabs:{outer:outer.getBoundingClientRect().width,inner:inner.getBoundingClientRect().width,bg:getComputedStyle(outer).backgroundColor,glass:getComputedStyle(inner).backdropFilter},sort:{outer:sortOuter.getBoundingClientRect().width,inner:sort.getBoundingClientRect().width,bg:getComputedStyle(sortOuter).backgroundColor},selected:getComputedStyle(inner,'::before').width};
 });
 assert.equal(geometry.tabs.bg,'rgba(0, 0, 0, 0)');assert.equal(geometry.sort.bg,'rgba(0, 0, 0, 0)');
 assert(geometry.tabs.inner<geometry.tabs.outer*.8);assert(geometry.sort.inner<geometry.sort.outer*.8);results.push('real native page has compact surfaces and transparent outer bars');
 await page.waitForTimeout(400);
 const crop=async name=>{const a=await page.locator('.search-tabs').boundingBox(),b=await page.locator('.search-conditions').boundingBox();await page.screenshot({path:join(out,name),clip:{x:Math.max(0,a.x-12),y:a.y-10,width:Math.min(1420,a.width+24),height:Math.min(700,b.y+b.height-a.y+30)}});};
 await crop('dark.png');
 assert.equal(await page.locator('.vui_tabs--nav-link').first().evaluate(el=>getComputedStyle(el).paddingLeft),'14px');
 assert(await page.locator('.vui_tabs--nav-slider').isHidden());results.push('native first-tab padding and underline no longer conflict');
 const play=sorting.getByRole('button',{name:'最多播放',exact:true});await play.click();
 await page.waitForFunction(()=>[...document.querySelectorAll('.conditions-order .vui_button--active')].some(el=>el.textContent.includes('最多播放')));
 results.push('native sorting click still updates active state');
 await page.locator('.i_button_more').click();await page.waitForTimeout(400);
 assert(await page.locator('.more-conditions').isVisible());results.push('native more-filters interaction retained');
 const alignment=await page.evaluate(()=>{
   const rows=[document.querySelector('.vui_tabs--nav'),...document.querySelectorAll('.search-conditions .search-condition-row')].filter(el=>el&&el.getBoundingClientRect().height);
   const boxes=rows.slice(0,4).map(el=>{const b=el.getBoundingClientRect();return {x:b.x,h:b.height};});
   const dates=[...document.querySelectorAll('.date-trigger')].map(el=>{const b=el.getBoundingClientRect();return {h:b.height,center:b.y+b.height/2};});
   const badge=document.querySelector('.vui_tabs--nav-item-active .vui_tabs--nav-num');
   return {boxes,dates,badge:badge?{text:badge.textContent,color:getComputedStyle(badge).color,bg:getComputedStyle(badge).backgroundColor}:null};
 });
 assert(alignment.boxes.length===4);assert(alignment.boxes.every(b=>Math.abs(b.x-alignment.boxes[0].x)<=1&&Math.abs(b.h-42)<=1));assert(alignment.dates.length===2&&alignment.dates.every(d=>d.h===32)&&Math.abs(alignment.dates[0].center-alignment.dates[1].center)<1);
 results.push('four native control rows align at one left edge and 42px height; date inputs centered at 32px');
 writeFileSync(join(out,'alignment.json'),JSON.stringify(alignment,null,2));
 await crop('dark-expanded.png');
 await worker.evaluate(()=>chrome.storage.local.set({'margin:settings':{intro:false,theme:'light',glass:'liquid',bg:{mode:'off'}}}));await page.waitForTimeout(400);await crop('light-expanded.png');
 results.push('real native expanded filters rendered in both themes');
 await page.setViewportSize({width:390,height:850});await page.waitForTimeout(300);
 const width=await page.evaluate(()=>({document:document.documentElement.scrollWidth,viewport:innerWidth,tabs:document.querySelector('.vui_tabs--nav').getBoundingClientRect().width,sort:document.querySelector('.conditions-order .search-condition-row').getBoundingClientRect().width}));
 assert(width.tabs<=390&&width.sort<=390);results.push('control surfaces remain bounded in narrow viewport');await page.screenshot({path:join(out,'narrow.png')});
 writeFileSync(join(out,'report.json'),JSON.stringify({passed:results.length,results,geometry,narrow:width,pageErrors:errors,scope:'Live anonymous Bilibili search; no auth, mocks or changes to user data. Native page errors recorded separately.'},null,2));
 console.log(JSON.stringify({passed:results.length,geometry,narrow:width,pageErrors:errors}));
}finally{await ctx.close();}
