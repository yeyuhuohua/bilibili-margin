// Exercise the source update handler in a real worker, then render the real extension UI.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { build } from 'vite';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { installMocks } from './mocks.mjs';

const out=resolve('delivery/update-notice');mkdirSync(out,{recursive:true});
const folder=resolve('dist');
const manifest=JSON.parse(readFileSync(join(folder,'manifest.json'),'utf8'));
const current=manifest.version,display=manifest.version_name;
const notes=JSON.parse(readFileSync('src/shared/updates.ts','utf8').match(/UPDATE_NOTES\s*=\s*(\[[\s\S]*?\]);/)[1]);
const built=await build({configFile:false,publicDir:false,logLevel:'error',build:{write:false,minify:false,lib:{entry:'src/background/updates.ts',name:'updateProbe',formats:['iife']}}});
const handler=(Array.isArray(built)?built[0]:built).output.find(x=>x.type==='chunk').code;
const profile=mkdtempSync(join(tmpdir(),'margin-upgrade-'));
const launch=()=>chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1280,height:850},args:[`--disable-extensions-except=${folder}`,`--load-extension=${folder}`]});
const workerOf=ctx=>ctx.serviceWorkers()[0]||ctx.waitForEvent('serviceworker');
const results=[],errors=[];
let ctx;
try {
  ctx=await launch();let worker=await workerOf(ctx);
  await worker.evaluate(current=>new Promise((resolve,reject)=>{
    const start=Date.now();const tick=async()=>{const v=await chrome.storage.local.get('margin:update-seen');if(v['margin:update-seen']===current)resolve(true);else if(Date.now()-start>5000)reject(Error('fresh-install marker missing'));else setTimeout(tick,30);};void tick();
  }),current);
  results.push('real fresh install records the current version without upgrade notes');
  await worker.evaluate(()=>chrome.storage.local.set({'margin:settings':{intro:false,theme:'dark',bg:{mode:'off'}}}));
  await worker.evaluate(()=>chrome.storage.local.remove('margin:update-seen'));
  await worker.evaluate(handler);
  await worker.evaluate('updateProbe.recordVersionInstall("update", "0.60.24")');
  await installMocks(ctx);
  await worker.evaluate(current=>new Promise((resolve,reject)=>{
    const start=Date.now();const tick=async()=>{const v=await chrome.storage.local.get('margin:update-pending');if(v['margin:update-pending']===current)resolve(true);else if(Date.now()-start>5000)reject(Error('real update event did not queue notes'));else setTimeout(tick,30);};void tick();
  }),current);
  results.push('actual source handler queues a legacy upgrade using real extension storage');
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto('https://www.bilibili.com/');const dialog=page.getByRole('dialog',{name:'映间已更新',exact:true});
  await dialog.waitFor({timeout:7000});assert.equal(await dialog.locator('.update-version').innerText(),display);
  assert.deepEqual(await dialog.locator('li').allTextContents(),notes);results.push('upgraded home displays installed version and bundled notes');
  await page.screenshot({path:join(out,'dark.png')});
  const box=await dialog.boundingBox();assert(Math.abs(box.x+box.width/2-640)<2);assert(box.width<=520);
  results.push('release notes are compact and centered');
  const second=await ctx.newPage();await second.goto('https://t.bilibili.com/');
  await second.getByRole('dialog',{name:'映间已更新',exact:true}).waitFor();
  await page.bringToFront();await dialog.getByRole('button',{name:'知道了',exact:true}).click();
  await second.getByRole('dialog',{name:'映间已更新',exact:true}).waitFor({state:'hidden'});
  const state=await worker.evaluate(()=>chrome.storage.local.get(['margin:update-seen','margin:update-pending']));
  assert.equal(state['margin:update-seen'],current);assert.equal(state['margin:update-pending'],undefined);
  results.push('acknowledgement syncs across tabs and clears the pending version');
  await page.reload();await page.locator('#margin-root .top').waitFor();await page.waitForTimeout(200);
  assert.equal(await page.getByRole('dialog',{name:'映间已更新',exact:true}).count(),0);
  results.push('refresh does not repeat acknowledged release notes');
  await worker.evaluate(current=>chrome.storage.local.set({'margin:update-seen':'0.60.24','margin:update-pending':current,'margin:settings':{intro:false,theme:'light',bg:{mode:'off'}}}),current);
  await page.reload();await dialog.waitFor();await page.setViewportSize({width:390,height:800});
  const narrow=await dialog.boundingBox();assert(narrow.width<=358&&narrow.x>=15);
  await page.screenshot({path:join(out,'narrow-light.png')});results.push('light-theme notes fit a narrow window');
  await dialog.getByRole('button',{name:'知道了',exact:true}).click();
  assert.equal(errors.length,0);results.push('no uncaught page errors');
}finally{if(ctx)await ctx.close();writeFileSync(join(out,'report.json'),JSON.stringify({passed:results.length,results,errors,current,scope:'Real fresh installation and worker storage; update source handler invoked at its event-handler seam. Actual UI and cross-tab acknowledgement tested. Browser lifecycle reload dispatch and store update delivery are not tested.'},null,2));}
console.log(JSON.stringify({passed:results.length,errors}));
