import { draftValue } from './message-draft.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { installMocks } from './mocks.mjs';
const out=resolve(process.env.SMOKE_OUT||'artifacts/issues-20261109/regression');mkdirSync(out,{recursive:true});
const ext=resolve(process.env.SMOKE_EXT||'dist');
const ctx=await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(),'margin-november-')),{
 ...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{channel:'chromium'}),headless:true,
 viewport:{width:2560,height:1400},args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`],
});
const results=[],errors=[];
const check=async(name,run)=>{try{await run();results.push({name,ok:true});console.log('PASS '+name);}catch(e){results.push({name,ok:false,error:e.message});console.log('FAIL '+name+': '+e.message);}};
try {
 await installMocks(ctx,u=>{
  if(u.includes('/x/relation/relations'))return {code:0,data:Object.fromEntries(new URL(u).searchParams.get('fids').split(',').map(mid=>[mid,{attribute:2}]))};
  if(u.includes('/fetch_session_msgs'))return {code:0,data:{messages:[{sender_uid:2,msg_type:1,content:JSON.stringify({content:'[支持][罗小黑_鼓掌]'}),timestamp:1,msg_key:'november-emotes',msg_seqno:1}],e_infos:[{text:'[支持]',url:'//i0.hdslb.com/support.png',size:1},{text:'[罗小黑_鼓掌]',url:'//i0.hdslb.com/large.gif',size:2}]}};
  if(u.includes('/x/emote/user/panel/web'))return {code:0,data:{packages:[{id:1,text:'默认表情',emote:[{text:'[支持]',url:'//i0.hdslb.com/support.png',flags:{unlocked:0}},{text:'[加油]',url:'//i0.hdslb.com/still.png',gif_url:'//i0.hdslb.com/animate.gif',meta:{size:2}}]},{id:2,text:'颜文字',emote:[{text:'(｀・ω・´)',type:4}]}]}};
 });
 const worker=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');
 await worker.evaluate(()=>chrome.storage.local.set({'margin:settings':{theme:'dark',intro:false,bg:{mode:'off'}}}));
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto('https://message.bilibili.com/#/whisper');
 await page.locator('#margin-root .wh-s').first().click();
 const input=page.locator('#margin-root .wh-input');await input.waitFor();
 await check('134-url-only-chat-emotes-and-complete-picker',async()=>{
  const images=page.locator('#margin-root .wh-inline-emote');await images.first().waitFor();assert.equal(await images.count(),2);
  assert.equal((await images.last().boundingBox()).width,50);
  await page.locator('#margin-root [aria-label="选择表情"]').click();const panel=page.locator('#margin-root .wh-emoji-panel');
  await panel.getByRole('button',{name:'[支持]',exact:true}).waitFor();assert.equal(await panel.getByRole('tab').count(),2);
  assert((await panel.getByRole('button',{name:'[加油]',exact:true}).locator('img').getAttribute('src')).endsWith('animate.gif'));
  await panel.getByRole('tab',{name:'颜文字'}).click();await panel.getByRole('button',{name:'(｀・ω・´)',exact:true}).click();assert.equal(await draftValue(input),'(｀・ω・´)');await input.fill('');
 });
 await check('131-composer-grows-to-eight-lines',async()=>{
  const before=await input.boundingBox();await input.fill(Array.from({length:12},()=> '这是一段需要完整查看的长消息').join('\n'));
  await page.waitForTimeout(100);
  const after=await input.boundingBox();assert(after.height>before.height+80,'long message remains a small textarea');
  const metrics=await input.evaluate(el=>({height:el.clientHeight,scroll:el.scrollHeight,line:parseFloat(getComputedStyle(el).lineHeight),padding:parseFloat(getComputedStyle(el).paddingTop)+parseFloat(getComputedStyle(el).paddingBottom)}));
  assert(metrics.height<=metrics.line*8+metrics.padding+2,'composer exceeds eight visible lines');
  assert(metrics.scroll>metrics.height,'long message should scroll after eight lines');
  await input.fill('短消息');assert((await input.boundingBox()).height<=before.height+2,'composer does not shrink');
 });
 await check('132-message-categories-keep-navigation-position',async()=>{
  const before=await page.locator('#margin-root .ms-nav').boundingBox();
  await page.locator('#margin-root .ms-item[data-view="reply"]').click();
  const after=await page.locator('#margin-root .ms-nav').boundingBox();
  assert(Math.abs(before.x-after.x)<2,`navigation moves ${after.x-before.x}px`);
  assert(Math.abs(before.width-after.width)<2,'navigation width changes between categories');
 });
 await page.goto('https://live.bilibili.com/1');await page.locator('#margin-watch-top').waitFor();
 await check('133-live-top-controls-clear-fixed-header',async()=>{
  await page.evaluate(()=>{const nav=document.createElement('nav');nav.id='november-live-switch';nav.textContent='直播间切换';nav.style.cssText='height:40px;margin-top:16px';document.body.prepend(nav);});
  const top=await page.locator('#margin-watch-top').boundingBox();const nav=await page.locator('#november-live-switch').boundingBox();
  assert(nav.y>=top.y+top.height,`live controls at ${nav.y}px overlap header ending at ${top.y+top.height}px`);
 });
 await page.goto('https://www.bilibili.com/video/BV1mdxN68E7F/');await page.locator('#margin-watch-top').waitFor();
 await check('130-player-corners-toggle-keeps-other-corners',async()=>{
  await page.locator('.bpx-player-container').evaluate(el=>{const video=document.createElement('div');video.className='bpx-player-video-area';el.append(video);});
  const video=page.locator('.bpx-player-video-area');assert(parseFloat(await video.evaluate(el=>getComputedStyle(el).borderTopLeftRadius))>0);
  await worker.evaluate(()=>chrome.storage.local.get('margin:settings').then(s=>chrome.storage.local.set({'margin:settings':{...s['margin:settings'],playerCorners:false}})));
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.bpx-player-video-area')).borderTopLeftRadius==='0px');
  assert(parseFloat(await page.locator('#commentapp').evaluate(el=>getComputedStyle(el).borderTopLeftRadius))>0);
 });
 await worker.evaluate(()=>chrome.storage.local.get('margin:settings').then(s=>chrome.storage.local.set({'margin:settings':{...s['margin:settings'],weather:true,privacyExternal:false}})));
 await page.goto('https://www.bilibili.com/');await page.locator('#margin-root .wx-empty').waitFor();
 await check('101-real-follow-status-without-recommendation-hint',async()=>{
  await page.locator('#margin-root .card .card-followed').first().waitFor();
  assert(await page.locator('#margin-root .card .card-followed').count()>1);
 });
 await check('128-weather-permission-explained-without-enabling-it',async()=>{
  await page.locator('#margin-root .wx-empty').getByRole('button',{name:'天气联网设置'}).click();
  await page.locator('#margin-root [aria-label="允许外部辅助服务"]').waitFor();
  assert.equal(await worker.evaluate(async()=> (await chrome.storage.local.get('margin:settings'))['margin:settings'].privacyExternal),false);
  await page.keyboard.press('Escape');
 });
 await check('129-capsule-rim-across-reported-pages',async()=>{
  for(const url of ['https://www.bilibili.com/','https://www.bilibili.com/video/BV1mdxN68E7F/','https://message.bilibili.com/#/whisper','https://space.bilibili.com/2/video']){
   await page.goto(url);const capsule=page.locator('#margin-root .top .et,#margin-watch-top .top .et');await capsule.waitFor();
   assert.equal(await capsule.evaluate(el=>getComputedStyle(el).outlineStyle),'solid');
   assert.equal(await capsule.evaluate(el=>getComputedStyle(el.closest('.top')).backgroundColor),'rgba(0, 0, 0, 0)');
  }
 });
 assert.deepEqual(errors,[]);
} finally {writeFileSync(join(out,'results.json'),JSON.stringify({results,errors},null,2));await ctx.close();}
if(results.some(r=>!r.ok))process.exitCode=1;
