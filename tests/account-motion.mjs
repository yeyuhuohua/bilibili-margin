import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installMocks } from './mocks.mjs';

const ext=resolve(process.env.SMOKE_EXT||'dist'),out=resolve(process.env.SMOKE_OUT||'tests/artifacts/account-motion');
mkdirSync(out,{recursive:true});const results=[],errors=[];
const ctx=await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(),'margin-account-motion-')),{
  executablePath:process.env.CHROMIUM_PATH,channel:process.env.CHROMIUM_PATH?undefined:'chromium',headless:true,
  viewport:{width:2560,height:1440},deviceScaleFactor:1.5,
  args:['--headless=new','--no-sandbox',`--disable-extensions-except=${ext}`,`--load-extension=${ext}`],
});
try {
 await installMocks(ctx);
 const worker=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker'),page=await ctx.newPage();
 page.on('pageerror',e=>errors.push(e.message));
 for(const draggable of [false,true]){
  await worker.evaluate(idDrag=>chrome.storage.local.set({'margin:settings':{theme:'dark',idDrag,intro:false,bg:{mode:'off'}}}),draggable);
  await page.goto('https://www.bilibili.com/',{waitUntil:'domcontentloaded'});
  await page.locator('#margin-root .user.in').hover();
  const card=page.locator('#margin-root .idcl-card');await card.waitFor();await page.waitForTimeout(2200);
  const initial=await page.locator('#margin-root .idcl-chain').evaluate(c=>{
   const pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let painted=0,edge=0;
   for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)if(pixels[(y*c.width+x)*4+3]){painted++;if(!x||!y||x===c.width-1||y===c.height-1)edge++;}
   return {width:c.width,height:c.height,area:c.width*c.height,viewport:innerWidth*innerHeight*devicePixelRatio**2,painted,edge};
  });
  const dragChecks=[];
  if(draggable){
   const name=await page.locator('#margin-root .idcl-name').boundingBox();
   const before=await card.getAttribute('style');
   await page.mouse.move(name.x+name.width/2,name.y+name.height/2);
   await page.mouse.down();
   await page.mouse.move(name.x+name.width/2-160,name.y+name.height/2+75,{steps:16});
   await page.waitForTimeout(100);
   assert.notEqual(await card.getAttribute('style'),before,'dragging does not move the card');
   dragChecks.push(await page.locator('#margin-root .idcl-chain').evaluate(c=>{
    const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let painted=0,edge=0;
    for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)if(d[(y*c.width+x)*4+3]){painted++;if(!x||!y||x===c.width-1||y===c.height-1)edge++;}
    return {width:c.width,height:c.height,painted,edge};
   }));
   await page.mouse.up();
   await page.locator('#margin-root .user.in').hover();await page.waitForTimeout(1800);
  }
  await page.setViewportSize({width:1920,height:1080});
  await page.locator('#margin-root .user.in').hover();await page.waitForTimeout(500);
  dragChecks.push(await page.locator('#margin-root .idcl-chain').evaluate(c=>{
   const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let painted=0,edge=0;
   for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)if(d[(y*c.width+x)*4+3]){painted++;if(!x||!y||x===c.width-1||y===c.height-1)edge++;}
   return {width:c.width,height:c.height,painted,edge};
  }));
  await page.setViewportSize({width:2560,height:1440});
  await page.locator('#margin-root .user.in').hover();await page.waitForTimeout(1100);
  await page.locator('#margin-root .idcl-name').click();await page.waitForTimeout(1100);
  const link=page.locator('#margin-root .idcl-back .idcl-connect-icons a').first();
  const rect=await link.boundingBox();
  await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.waitForTimeout(200);
  const motion=await card.evaluate(async el=>{
   const root=el.getRootNode(),link=el.querySelector('.idcl-back .idcl-connect-icons a');
   const frames=[];const start=performance.now();
   await new Promise(resolve=>{const step=now=>{const b=link.getBoundingClientRect(),hit=root.elementFromPoint(b.x+b.width/2,b.y+b.height/2);frames.push({x:b.x,y:b.y,hit:link.contains(hit),transform:el.style.transform,flip:el.querySelector('.idcl-flipper').style.transform});if(now-start<700)requestAnimationFrame(step);else resolve();};requestAnimationFrame(step);});
   return {samples:frames.length,hits:frames.filter(f=>f.hit).length,xRange:Math.max(...frames.map(f=>f.x))-Math.min(...frames.map(f=>f.x)),yRange:Math.max(...frames.map(f=>f.y))-Math.min(...frames.map(f=>f.y)),transforms:new Set(frames.map(f=>f.transform+'|'+f.flip)).size,first:frames[0],last:frames.at(-1)};
  });
  results.push({draggable,canvas:initial,dragAndResize:dragChecks,motion});
  await page.screenshot({path:join(out,`account-${draggable?'drag':'fixed'}.png`)});
  if(process.env.ACCOUNT_BASELINE!=='1'){
   assert(initial.area<initial.viewport*.08,'short bead chain allocates a full-screen high-DPI canvas');
   assert(initial.painted>50&&initial.edge===0,'bead chain is blank or clipped by its canvas');
   assert(dragChecks.every(c=>c.painted>50&&c.edge===0),'dragging or resizing clips the bead chain');
   assert(motion.hits>=motion.samples*.9,'visible shortcut does not match its pointer hit area');
   assert(motion.xRange<.75&&motion.yRange<.75,'stationary pointer keeps moving the shortcut');
  }
 }
 assert.deepEqual(errors,[]);
}finally{writeFileSync(join(out,'results.json'),JSON.stringify({results,errors},null,2));await ctx.close();}
console.log(JSON.stringify(results));
