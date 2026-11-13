import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { installMocks } from './mocks.mjs';

const out=resolve(process.env.SMOKE_OUT||'delivery/comment-detail');mkdirSync(out,{recursive:true});
const ext=resolve(process.env.SMOKE_EXT||'dist'),results=[],errors=[];
const ctx=await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(),'margin-comment-detail-')),{channel:'chromium',headless:true,viewport:{width:1000,height:850},args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
try{
 await installMocks(ctx);
 await ctx.route('https://www.bilibili.com/blackboard/comment-detail.html?**',r=>r.fulfill({contentType:'text/html',body:`<!doctype html><html><head><style>html,body{margin:0;background:white}body{height:550px;font:14px system-ui}.comment{background:var(--bg1,#1a1a1c);color:var(--text1,#fff);padding:24px}img{width:100px;height:100px}button{color:inherit}</style></head><body><div class="comment"><p>原生评论正文与图片</p><img alt="评论图片" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect fill='teal' width='100' height='100'/%3E%3C/svg%3E"><button id="reply">回复</button></div><script>window.replies=0;document.querySelector('#reply').onclick=()=>window.replies++;</script></body></html>`}));
 const worker=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');
 await worker.evaluate(()=>chrome.storage.local.set({'margin:settings':{intro:false,theme:'dark',bg:{mode:'off'}}}));
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto('https://www.bilibili.com/video/BV1mdxN68E7F/');await page.locator('#margin-watch-top .top').waitFor();
 await page.evaluate(()=>{
  const popup=document.createElement('bili-comments-popup');popup.style.cssText='position:fixed;inset:0;display:grid;place-items:center;z-index:2000';
  const root=popup.attachShadow({mode:'open'});root.innerHTML='<style>#wrap{width:600px;background:var(--bg1);border-radius:6px;overflow:hidden}#header{height:50px;display:flex;align-items:center;justify-content:space-between;color:var(--text1);padding:0 20px}#content{height:550px}::slotted(iframe){width:100%;height:100%;border:0}</style><div id="wrap"><div id="header">评论详情<button id="close">关闭</button></div><div id="content"><slot></slot></div></div>';
  window.closedDetails=0;root.querySelector('#close').onclick=()=>{window.closedDetails++;popup.remove();};
  const frame=document.createElement('iframe');frame.src='https://www.bilibili.com/blackboard/comment-detail.html?id=123&theme=dark';popup.append(frame);document.body.append(popup);
 });
 const frame=page.frameLocator('bili-comments-popup iframe');await frame.locator('#reply').waitFor();
  for(let n=0;n<10;n++){if(await frame.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor)==='rgb(26, 26, 28)')break;await page.waitForTimeout(100);}
  await page.screenshot({path:join(out,'dark.png')});
 const before=await frame.locator('img').getAttribute('src');
 assert.equal(await frame.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(26, 26, 28)');results.push('late body-portal detail iframe has a dark background across its full height');
 await page.screenshot({path:join(out,'dark.png')});
 await frame.locator('#reply').click();assert.equal(await frame.locator('body').evaluate(()=>window.replies),1);results.push('native reply click preserved');
 await worker.evaluate(()=>chrome.storage.local.set({'margin:settings':{intro:false,theme:'light',bg:{mode:'off'}}}));
 await page.waitForFunction(()=>document.documentElement.dataset.marginTheme==='light');
 await frame.locator('body').evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert.equal(await frame.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)');
 assert.equal(await frame.locator('body').evaluate(el=>getComputedStyle(el).color),'rgb(23, 24, 26)');results.push('open detail iframe follows subsequent theme changes');
 assert.equal(await frame.locator('img').getAttribute('src'),before);results.push('native images and their source URLs remain unchanged');
 await page.screenshot({path:join(out,'light.png')});
 await page.locator('bili-comments-popup #close').click();assert.equal(await page.evaluate(()=>window.closedDetails),1);results.push('native close event remains intact');
 assert.equal(errors.length,0);results.push('no uncaught errors');
}finally{writeFileSync(join(out,'report.json'),JSON.stringify({passed:results.length,results,errors,scope:'Loaded extension; same-origin iframe fixture follows native bili-comments-popup #wrap/#content/slot structure verified in Bilibili comment SDK. No real reply submission.'},null,2));await ctx.close();}
console.log(JSON.stringify({passed:results.length,errors}));
