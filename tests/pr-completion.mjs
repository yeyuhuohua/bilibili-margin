import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { installMocks } from './mocks.mjs';
const extension = resolve(process.env.SMOKE_EXT || 'dist');
const out = resolve(process.env.SMOKE_OUT || 'artifacts/pr-completion'); mkdirSync(out, { recursive: true });
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(),'margin-pr-final-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless:true, viewport:{width:1440,height:1000}, args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],
});
const results=[], errors=[];
try {
 await installMocks(context);
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 const page=await context.newPage(); page.on('pageerror',error=>errors.push(error.message));
 const seed=patch=>worker.evaluate(async patch=>{const saved=(await chrome.storage.local.get('margin:settings'))['margin:settings'];await chrome.storage.local.set({'margin:settings':{...saved,intro:false,bg:{mode:'off'},...patch}});},patch);
 for(const [name,url,host] of [['home','https://www.bilibili.com/','#margin-root'],['watch','https://www.bilibili.com/video/BV1mdxN68E7F/','#margin-watch-top']]) {
   await seed({searchStyle:'classic',homeHide:['search'],glass:'liquid'}); await page.goto(url);
   const input=page.locator(`${host} .top .search`); await input.waitFor();
   await page.waitForFunction(host=>document.querySelector(host).shadowRoot.querySelector('.top .search')?.style.backdropFilter.includes('url('),host);
   assert.equal(await input.locator('button').count(),0);
   assert.equal(await input.locator('kbd').textContent(),'/');
   assert.equal(await input.locator('input').getAttribute('placeholder'),'搜索视频、UP 主');
   assert.equal(await input.evaluate(el=>el.classList.contains('has-hot')),false);
   await page.screenshot({path:join(out,`${name}-classic.png`)});
   await input.click(); const cp=page.locator(`${host} .cp[data-open="true"]`); await cp.waitFor();
   assert.equal(await cp.evaluate(el=>el.classList.contains('cp-clipping')),false);
   await page.locator(`${host} .cp-input input`).fill('映间');
   const popup=page.waitForEvent('popup'); await page.locator(`${host} .cp-list .cp-item`).first().click();
   const target=await popup; assert.equal(new URL(target.url()).searchParams.get('keyword'),'映间'); await target.close();
   await seed({searchStyle:'new'}); await input.click();
   await page.locator(`${host} .cp[data-open="true"]`).waitFor();
   assert.equal(await cp.evaluate(el=>el.classList.contains('cp-clipping')),true);
   await page.screenshot({path:join(out,`${name}-new.png`)});
   await seed({searchStyle:'classic'}); await page.locator(`${host} .cp[data-open="false"]`).waitFor();
   assert.equal(await input.locator('.search-ph').count(),0);
   await seed({searchStyle:'new'});
   assert.equal(await page.locator(`${host} .app`).evaluate(el=>el.classList.contains('hs-open')),false);
   const word=page.locator(`${host} .search-ph-w:not(.out)`); await word.waitFor(); const first=await word.textContent();
   assert.equal(await input.locator('input').evaluate(el=>getComputedStyle(el,'::placeholder').color),'rgba(0, 0, 0, 0)');
   await page.waitForFunction(({host,first})=>document.querySelector(host).shadowRoot.querySelector('.search-ph-w:not(.out)')?.textContent!==first,{host,first});
   assert.equal(await page.locator(`${host} svg[data-margin-glass-filters]`).evaluate(el=>el.parentNode===el.getRootNode()),true);
   results.push(`${name} classic search, new panel and live switching`);
 }
 for (const radius of [0, 100, 150]) {
   await seed({radius, searchStyle:'new', theme:'dark'});
   await page.goto('https://www.bilibili.com/video/BV1mdxN68E7F/');
   const form=page.locator('#margin-watch-top .top .search'); await form.waitFor();
   await page.waitForFunction(radius=>Math.abs(parseFloat(getComputedStyle(document.querySelector('#margin-watch-top').shadowRoot.querySelector('.top .search')).borderTopLeftRadius)-999*radius/100)<1,radius);
   const origin=await form.evaluate(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return{radius:Math.min(parseFloat(s.borderTopLeftRadius)||0,Math.min(r.width,r.height)/2),shape:s.getPropertyValue('corner-shape').trim()};});
   const panel=await page.locator('#margin-watch-top .cp-panel').evaluate(el=>{const s=getComputedStyle(el);return{radius:parseFloat(s.borderTopLeftRadius)||0,shape:s.getPropertyValue('corner-shape').trim()};});
   const sample=()=>page.evaluate(()=>{
     const shell=document.querySelector('#margin-watch-top').shadowRoot.querySelector('.cp-shell');
     const anims=shell.getAnimations(); const snap=()=>{const s=getComputedStyle(shell);return{radius:parseFloat(s.borderTopLeftRadius)||0,shape:s.getPropertyValue('corner-shape').trim()};};
     anims.forEach(a=>a.pause()); anims.forEach(a=>{a.currentTime=0;}); const start=snap();
     anims.forEach(a=>{a.currentTime=a.effect.getTiming().duration;}); const end=snap();
     anims.forEach(a=>a.cancel()); return{start,end,count:anims.length};
   });
   await page.locator('#margin-watch-top .top .search input').click();
   await page.waitForFunction(()=>document.querySelector('#margin-watch-top').shadowRoot.querySelector('.cp').classList.contains('cp-clipping'));
   const keys=await page.evaluate(()=>{const root=document.querySelector('#margin-watch-top').shadowRoot;const m=root.querySelector('.cp-morph-kbd'),p=root.querySelector('.cp-input kbd');return{text:m.textContent,shown:getComputedStyle(m).display,panel:getComputedStyle(p).display};});
   assert.equal(keys.text,'Esc');
   assert.equal(keys.shown,'block');
   assert.equal(keys.panel,'none');
   const opening=await sample();
   assert.ok(opening.count>0,'morph transitions exist');
   assert.ok(Math.abs(opening.start.radius-origin.radius)<.6,`open start ${opening.start.radius} vs ${origin.radius}`);
   assert.equal(opening.start.shape,origin.shape);
   assert.ok(Math.abs(opening.end.radius-panel.radius)<.1,`open end ${opening.end.radius} vs ${panel.radius}`);
   assert.equal(opening.end.shape,panel.shape);
   await page.waitForFunction(()=>!document.querySelector('#margin-watch-top').shadowRoot.querySelector('.cp').classList.contains('cp-clipping'));
   await page.keyboard.press('Escape');
   await page.waitForFunction(()=>document.querySelector('#margin-watch-top').shadowRoot.querySelector('.cp').classList.contains('cp-clipping'));
   const closeKeys=await page.evaluate(()=>{const root=document.querySelector('#margin-watch-top').shadowRoot;const m=root.querySelector('.cp-morph-kbd'),p=root.querySelector('.cp-input kbd');return{text:m.textContent,shown:getComputedStyle(m).display,panel:getComputedStyle(p).display};});
   assert.equal(closeKeys.text,'/');
   assert.equal(closeKeys.shown,'block');
   assert.equal(closeKeys.panel,'none');
   const closing=await sample();
   assert.ok(Math.abs(closing.start.radius-panel.radius)<.6);
   assert.equal(closing.start.shape,panel.shape);
   assert.ok(Math.abs(closing.end.radius-origin.radius)<.1);
   assert.equal(closing.end.shape,origin.shape);
   await page.waitForFunction(()=>document.querySelector('#margin-watch-top').shadowRoot.querySelector('.cp').hidden);
 }
 results.push('palette morph matches search and panel radii at 0/100/150');
 await seed({radius:100,searchStyle:'new',paletteSpeed:50,theme:'dark'});
 await page.goto('https://www.bilibili.com/video/BV1mdxN68E7F/');
 await page.locator('#margin-watch-top .top .search input').click();
 await page.waitForFunction(()=>{const root=document.querySelector('#margin-watch-top').shadowRoot;return root.querySelector('.cp').dataset.open==='true'&&!root.querySelector('.cp').classList.contains('cp-clipping');});
 await page.evaluate(()=>{
   const root=document.querySelector('#margin-watch-top').shadowRoot, cp=root.querySelector('.cp');
   window.closeTiming={};
   document.addEventListener('keydown',event=>{if(event.key==='Escape')window.closeTiming.start=performance.now();},{capture:true,once:true});
   const observer=new MutationObserver(()=>{if(cp.hidden){window.closeTiming.end=performance.now();observer.disconnect();}});
   observer.observe(cp,{attributes:true,attributeFilter:['hidden']});
 });
 await page.keyboard.press('Escape');
 const duration=await page.locator('#margin-watch-top .cp-shell').evaluate(el=>Math.max(...getComputedStyle(el).transitionDuration.split(',').map(value=>parseFloat(value)*1000)));
 assert.ok(duration>0,'closing must have a configured transition');
 await page.waitForFunction(()=>document.querySelector('#margin-watch-top').shadowRoot.querySelector('.cp').hidden);
 const elapsed=await page.evaluate(()=>window.closeTiming.end-window.closeTiming.start);
 console.log({closingElapsed:elapsed,transitionDuration:duration});
 assert.ok(elapsed+25>=duration,`close hid after ${elapsed}ms before ${duration}ms transition finished`);
 results.push('palette closing keeps the shell visible through its full configured transition');
 const escapedBeforeFocus=await page.evaluate(()=>{
   const root=document.querySelector('#margin-watch-top').shadowRoot;
   root.querySelector('.top .search').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
   document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
   return root.querySelector('.cp').dataset.open==='false';
 });
 assert.equal(escapedBeforeFocus,true,'Escape must close during the opening frame, before input focus');
 await page.waitForFunction(()=>document.querySelector('#margin-watch-top').shadowRoot.querySelector('.cp').hidden);
 await page.locator('#margin-watch-top .top .search input').click();
 await page.waitForFunction(()=>document.querySelector('#margin-watch-top').shadowRoot.querySelector('.cp').classList.contains('cp-clipping'));
 await page.keyboard.press('Escape'); await page.waitForTimeout(40); await page.keyboard.press('Control+k');
 await page.waitForTimeout(1100);
 assert.equal(await page.locator('#margin-watch-top .cp').evaluate(el=>!el.hidden&&el.dataset.open==='true'),true);
 await page.keyboard.press('Escape');
 await page.waitForFunction(()=>document.querySelector('#margin-watch-top').shadowRoot.querySelector('.cp').hidden);
 assert.notEqual(await page.locator('#margin-watch-top .top .search').evaluate(el=>getComputedStyle(el).visibility),'hidden');
 results.push('rapid close and reopen cancels stale hide timers and restores the original search');
 await page.goto('https://www.bilibili.com/video/BV1mdxN68E7F/'); await page.locator('#margin-watch-top').waitFor();
 await page.evaluate(()=>{
   const comments=document.createElement('bili-comments'); const root=comments.attachShadow({mode:'open'});
   const renderer=document.createElement('bili-comment-renderer'); renderer.data={reply_control:{location:'IP属地：浙江'}};
   const sr=renderer.attachShadow({mode:'open'}); const actions=document.createElement('bili-comment-action-buttons-renderer');
   actions.attachShadow({mode:'open'}).innerHTML='<style>:host{font:13px/20px Arial}</style><div id="pubdate"><span>15分钟前</span></div><button>回复</button>';
   sr.append(actions);root.append(renderer);document.querySelector('#commentapp').append(comments);
 });
 const label=page.locator('[data-margin-location-label]'); await label.waitFor(); assert.equal(await label.textContent(),'IP属地：浙江');
 for(const theme of ['light','dark']) {
   await seed({theme});
   await page.waitForFunction(theme=>document.documentElement.dataset.marginTheme===theme,theme);
   for(const size of [13,15]) {
     const metrics=await label.evaluate((el,size)=>{
       const row=el.parentElement;row.style.fontSize=size+'px';
       const reference=row.querySelector('span:not([data-margin-location-label])');
       return {font:getComputedStyle(el).fontSize,referenceFont:getComputedStyle(reference).fontSize,line:getComputedStyle(el).lineHeight,referenceLine:getComputedStyle(reference).lineHeight,top:el.getBoundingClientRect().top,referenceTop:reference.getBoundingClientRect().top};
     },size);
     assert.equal(metrics.font,metrics.referenceFont,`${theme} IP font follows the metadata row`);
     assert.equal(metrics.line,metrics.referenceLine);
     assert.ok(Math.abs(metrics.top-metrics.referenceTop)<1,JSON.stringify(metrics));
   }
 }
 results.push('140 location inherits metadata typography in both themes and font sizes');
 await page.evaluate(()=>document.querySelector('bili-comments').shadowRoot.querySelector('bili-comment-renderer').data.reply_control.location='<b>浙江</b>');
 await page.waitForFunction(()=>document.querySelector('bili-comments').shadowRoot.querySelector('bili-comment-renderer').shadowRoot.querySelector('bili-comment-action-buttons-renderer').shadowRoot.querySelector('[data-margin-location-label]')?.textContent==='<b>浙江</b>');
 assert.equal(await label.locator('b').count(),0);
 await page.evaluate(()=>document.querySelector('bili-comments').shadowRoot.querySelector('bili-comment-renderer').data={reply_control:{}});
 await label.waitFor({state:'detached'});
 results.push('native isolated-world location, recycled rows, escaped text and missing data');
 assert.deepEqual(errors,[]); console.log(results);
} finally {writeFileSync(join(out,'results.json'),JSON.stringify({results,errors},null,2));await context.close();}
