import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {installMocks} from './mocks.mjs';
const ext=resolve(process.env.SMOKE_EXT||'dist'),out=resolve('delivery/favorites-loading');mkdirSync(out,{recursive:true});
const results=[],errors=[],requests=[];let active=0,peak=0;
const ctx=await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(),'margin-fav-load-')),{channel:'chromium',headless:true,viewport:{width:1440,height:1000},args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
const check=async(name,fn)=>{try{await fn();results.push({name,passed:true});}catch(e){results.push({name,passed:false,error:e.message});}console.log(JSON.stringify(results.at(-1)));};
try{
 await installMocks(ctx,async url=>{
  const u=new URL(url);
  if(u.pathname.includes('/fav/folder/created/list'))return {code:0,data:{list:Array.from({length:50},(_,i)=>({id:60000+i,title:'收藏 '+i,media_count:4,attr:2,cover:'https://i0.hdslb.com/mock.jpg'}))}};
  if(u.pathname.includes('/fav/folder/collected/list'))return {code:0,data:{has_more:false,list:Array.from({length:50},(_,i)=>({id:70000+i,title:'订阅 '+i,media_count:4,type:21,cover:'https://i0.hdslb.com/mock.jpg'}))}};
  if(u.pathname.includes('/fav/resource/list')||u.pathname.includes('/fav/season/list')){requests.push(u.searchParams.get('media_id')||u.searchParams.get('season_id'));active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,250));active--;return {code:0,data:{has_more:false,medias:[]}};}
 });
 const worker=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');await worker.evaluate(async()=>{await globalThis.marginLocalGlassReady;await chrome.storage.local.set({'margin:settings':{intro:false,theme:'dark',glass:'liquid',bg:{mode:'off'}}});});
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));await page.emulateMedia({reducedMotion:'reduce'});await page.goto('https://www.bilibili.com/');await page.locator('#margin-root .top').waitFor();await page.evaluate(()=>dispatchEvent(new Event('margin:open-fav')));
 const dialog=page.getByRole('dialog',{name:'收藏夹',exact:true}),body=dialog.locator('.sheet-body');await dialog.locator('.gf-root').nth(49).waitFor();
 await check('deep folders appear promptly instead of waiting for global stagger index',async()=>{
  const last=dialog.locator('.gf-root').nth(49);await last.scrollIntoViewIfNeeded();await page.waitForFunction(el=>el.hasAttribute('data-entered'),await last.elementHandle(),{timeout:450});
 });
 await check('return to top works inside My Favorites without moving outer page',async()=>{
  const y=await page.evaluate(()=>scrollY);await dialog.getByRole('button',{name:'返回顶部',exact:true}).click({timeout:1000});await page.waitForFunction(()=>document.getElementById('margin-root').shadowRoot.querySelector('.fav-body').scrollTop<2);assert.equal(await page.evaluate(()=>scrollY),y);
 });
 await dialog.getByRole('radio',{name:'订阅内容',exact:true}).click();await dialog.locator('.gf-root').filter({hasText:'订阅 49'}).waitFor();
 await check('subscription viewport has a fixed bottom return button',async()=>{await dialog.locator('.gf-root').nth(40).scrollIntoViewIfNeeded();await dialog.getByRole('button',{name:'返回顶部',exact:true}).click({timeout:1000});await page.waitForFunction(()=>document.getElementById('margin-root').shadowRoot.querySelector('.fav-body').scrollTop<2);});
 await check('previews warm beyond the immediate viewport',async()=>{
  const id=await dialog.locator('.gf-root').evaluateAll(els=>{const v=els[0].closest('.sheet-body').getBoundingClientRect();return els.find(e=>{const r=e.getBoundingClientRect();return r.top>v.bottom+200&&r.top<v.bottom+650;})?.dataset.id;});assert(id,'fixture must include a folder below the viewport');
  const end=Date.now()+1800;while(!requests.includes(id)&&Date.now()<end)await page.waitForTimeout(50);assert(requests.includes(id),'folder below viewport was not warmed ahead of scrolling');
 });
 await check('preview concurrency is bounded while rapid scrolling discards old queued work',async()=>{for(const n of [40,4,45,12]){await dialog.locator('.gf-root').nth(n).scrollIntoViewIfNeeded();await page.waitForTimeout(40);}await page.waitForTimeout(350);assert(peak<=5,'peak preview requests='+peak);});
 assert.deepEqual(errors,[]);
}finally{writeFileSync(join(out,'report.json'),JSON.stringify({results,errors,peakPreviewRequests:peak,previewRequests:requests.length,scope:'Actual built extension with 50 folders per tab and 250ms mocked previews; arrival marker, prefetch, concurrency and container scrolling.'},null,2));await ctx.close();}
if(results.some(r=>!r.passed)||errors.length)process.exitCode=1;
