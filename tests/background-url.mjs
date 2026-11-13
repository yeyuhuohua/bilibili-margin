import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installMocks } from './mocks.mjs';
const out=resolve(process.env.SMOKE_OUT || 'delivery/background-url');mkdirSync(out,{recursive:true});
const ext=resolve(process.env.SMOKE_EXT || 'dist');
const ctx=await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(),'margin-bg-url-')),{channel:'chromium',headless:true,viewport:{width:1440,height:1000},args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
const checks=[],errors=[];
try{
 await installMocks(ctx);
 await ctx.route('https://wallpaper.test/**',async route=>{
  if(route.request().url().includes('/broken'))return route.fulfill({status:404,body:'missing'});
  if(route.request().url().includes('/slow'))await new Promise(resolve=>setTimeout(resolve,500));
  return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#6c8496"/></svg>'});
 });
 const worker=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');
 await worker.evaluate(()=>chrome.storage.local.set({'margin:settings':{intro:false,weather:false,footprint:false,bg:{mode:'off'}}}));
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('https://www.bilibili.com/');
 const watch=await ctx.newPage();await watch.goto('https://www.bilibili.com/video/BV1mdxN68E7F/');await watch.locator('#margin-watch-top').waitFor();
 await page.bringToFront();await page.locator('#margin-root .top [aria-label="设置"]').click();await page.getByRole('tab',{name:'外观',exact:true}).click();
 await page.locator('.sd-head').filter({hasText:'强度与自定义图片'}).click();
 const input=page.getByRole('textbox',{name:'背景图片 URL',exact:true}),preview=page.getByRole('button',{name:'预览',exact:true}),apply=page.getByRole('button',{name:'应用链接',exact:true});
 for(const invalid of ['javascript:alert(1)','https://user:password@wallpaper.test/image','http://wallpaper.test/image','not a URL']){
  await input.fill(invalid);await preview.click();assert(await apply.isDisabled());assert.equal((await worker.evaluate(()=>chrome.storage.local.get('margin:bg-image')))['margin:bg-image'],undefined);
 }
 checks.push('invalid URL schemes, credentials and malformed input are rejected before storage');
 const first='https://wallpaper.test/image?name=%22sample%22';await input.fill(first);await input.press('Enter');await apply.waitFor({state:'visible'});
 await page.getByAltText('背景图片预览').waitFor();assert(await apply.isEnabled());assert.equal((await worker.evaluate(()=>chrome.storage.local.get('margin:bg-image')))['margin:bg-image'],undefined);
 await apply.click();await page.waitForFunction(url=>document.querySelector('#margin-root').shadowRoot.querySelector('.bg-img').style.backgroundImage.includes(url),first);
 await watch.waitForFunction(url=>document.querySelector('#margin-bg').shadowRoot.querySelector('.bg-img')?.style.backgroundImage.includes(url),first);
 checks.push('preview does not change background; applying switches to image mode on both pages');
 await input.fill('https://wallpaper.test/broken');await preview.click();await page.getByText('图片加载失败，请检查直链或防盗链限制',{exact:true}).waitFor();assert(await apply.isDisabled());
 assert.equal((await worker.evaluate(()=>chrome.storage.local.get('margin:bg-image')))['margin:bg-image'],first);
 checks.push('failed image preserves saved background');
 await input.fill('https://wallpaper.test/slow');await preview.click();await input.fill('https://wallpaper.test/second');await preview.click();await page.getByAltText('背景图片预览').waitFor();await page.waitForTimeout(600);
 assert((await page.getByAltText('背景图片预览').getAttribute('src')).endsWith('/second'));await apply.click();
 await watch.waitForFunction(()=>document.querySelector('#margin-bg').shadowRoot.querySelector('.bg-img').style.backgroundImage.includes('/second'));
 checks.push('late preview cannot override changed input; replacement syncs while already in image mode');
 await page.reload();await page.locator('#margin-root .bg-img').waitFor({state:'attached'});await page.waitForFunction(()=>document.querySelector('#margin-root').shadowRoot.querySelector('.bg-img').style.backgroundImage.includes('/second'));
 await page.locator('#margin-root .top [aria-label="设置"]').click();await page.getByRole('tab',{name:'外观',exact:true}).click();await page.locator('.sd-head').filter({hasText:'强度与自定义图片'}).click();assert.equal(await input.inputValue(),'https://wallpaper.test/second');
 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=4;return c.toDataURL('image/png').split(',')[1]});
 await page.getByLabel('选择背景图片',{exact:true}).setInputFiles({name:'local.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
 await page.waitForFunction(()=>document.querySelector('#margin-root').shadowRoot.querySelector('.bg-img').style.backgroundImage.includes('data:image/jpeg'));
  await input.scrollIntoViewIfNeeded();await page.screenshot({path:join(out,'url-settings.png')});
 checks.push('reload persists URL and local file upload still replaces background');assert.deepEqual(errors,[]);
}finally{await ctx.close();writeFileSync(join(out,'report.json'),JSON.stringify({checks,errors},null,2))}
console.log(JSON.stringify({checks}));
