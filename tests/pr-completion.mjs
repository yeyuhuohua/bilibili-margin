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
   await page.waitForFunction(({host,first})=>document.querySelector(host).shadowRoot.querySelector('.search-ph-w:not(.out)')?.textContent!==first,{host,first});
   assert.equal(await page.locator(`${host} svg[data-margin-glass-filters]`).evaluate(el=>el.parentNode===el.getRootNode()),true);
   results.push(`${name} classic search, new panel and live switching`);
 }
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
