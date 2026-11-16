import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { apiBody, installMocks } from './mocks.mjs';
const out=resolve(process.env.SMOKE_OUT||'delivery/issues-181-184/favorite-transfer');mkdirSync(out,{recursive:true});
const ext=resolve(process.env.SMOKE_EXT||'dist'),checks=[],posts=[];let fail=false,release;
const context=await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(),'margin-transfer-')),{channel:'chromium',headless:true,viewport:{width:1440,height:1000},args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
try{
 await installMocks(context,url=>{
  if(url.includes('fav/resource/list')){const data=apiBody(url);data.data.medias.forEach((v,i)=>v.id=1000+i);return data;}
 });
 await context.route('**/x/v3/fav/resource/{move,copy}',async r=>{
  posts.push({url:r.request().url(),body:Object.fromEntries(new URLSearchParams(r.request().postData()))});
  if(release!==undefined)await new Promise(resolve=>release=resolve);
  await r.fulfill({json:fail?{code:-400,message:'目标收藏夹不可用'}:{code:0},headers:{'access-control-allow-origin':'https://www.bilibili.com','access-control-allow-credentials':'true'}});
 });
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 await worker.evaluate(()=>chrome.storage.local.set({'margin:settings':{intro:false,theme:'dark',bg:{mode:'off'},favDirect:true}}));
 const page=await context.newPage();await page.goto('https://www.bilibili.com/');await page.locator('#margin-root .top').waitFor();
 await page.evaluate(()=>dispatchEvent(new Event('margin:open-fav',{cancelable:true})));
 const sheet=page.getByRole('dialog',{name:'收藏夹',exact:true});await sheet.locator('.fav-grid .card').first().waitFor();
 const card=sheet.locator('.fav-grid .card').first();
 const originalCount=await sheet.locator('.fav-grid .card').count();
 await card.getByRole('button',{name:'复制到…',exact:true}).click();
 assert.equal(await card.getByRole('combobox',{name:'目标收藏夹'}).locator('option').count(),2);
 await card.getByRole('combobox').selectOption('202');
 await card.getByRole('button',{name:'确认复制',exact:true}).click();
 await card.getByText('已复制到「动效参考」',{exact:true}).waitFor();
 assert.equal(await sheet.locator('.fav-grid .card').count(),originalCount);
 assert.equal(posts.length,1);assert.equal(posts[0].body.src_media_id,'101');assert.equal(posts[0].body.tar_media_id,'202');assert.equal(posts[0].body.resources,'1000:2');
 checks.push('copy targets another owned folder and retains source video');
 fail=true;
 await card.getByRole('button',{name:'移动到…',exact:true}).click();await card.getByRole('combobox').selectOption('303');
 await card.getByRole('button',{name:'确认移动',exact:true}).click();await card.getByRole('alert').filter({hasText:'移动失败'}).waitFor();
 assert.equal(await sheet.locator('.fav-grid .card').count(),originalCount);assert.equal(posts.length,2);
 checks.push('failed move retains video, selected destination and retry form');
 fail=false;release=null;
 await card.getByRole('button',{name:'确认移动',exact:true}).click();
 await page.waitForTimeout(100);
 assert.equal(await card.getByRole('button',{name:'确认移动',exact:true}).isDisabled(),true);
 assert.equal(posts.length,3);release();release=undefined;
 await page.waitForFunction(n=>document.querySelector('#margin-root').shadowRoot.querySelectorAll('.fav-grid .card').length===n,originalCount-1);
 checks.push('successful move removes source only after server confirmation and blocks duplicate submission');
 await sheet.screenshot({path:join(out,'favorites.png')});
 await worker.evaluate(()=>chrome.storage.local.set({'margin:settings':{intro:false,weather:false,footprint:false,bg:{mode:'off'},cols:4,homeHide:['author','views','danmaku','ago','dur','reason']}}));
 await page.reload();await page.locator('.home-grid .card:not(.sk)').first().waitFor();
 assert.equal(await page.locator('.home-grid .author,.home-grid .stat,.home-grid .pubtime,.home-grid .dur,.home-grid .reason').count(),0);
 const columns=await page.locator('.home-grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length);
 assert.equal(columns,4);checks.push('184 existing settings persist hidden metadata and four larger cards per row');
 await page.screenshot({path:join(out,'minimal-home.png')});
}finally{await context.close();writeFileSync(join(out,'report.json'),JSON.stringify({checks,posts},null,2));}
console.log(JSON.stringify({checks}));
