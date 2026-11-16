// Weather services fail after the first successful load. Page/account data is synthetic.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { apiBody, installMocks } from './mocks.mjs';
const out=resolve(process.env.SMOKE_OUT || 'delivery/weather-offline');mkdirSync(out,{recursive:true});
const profile=mkdtempSync(join(tmpdir(),'margin-offline-weather-')),ext=resolve(process.env.SMOKE_EXT || 'dist');
const checks=[];
let context,offline=false,delay=0;
async function launch(){
 context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1600,height:1000},args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
 await installMocks(context);
 await context.route('https://ipwho.is/**',r=>r.abort('internetdisconnected'));
 await context.route('https://api.open-meteo.com/**',async r=>{
  if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
  if(offline)return r.abort('internetdisconnected');
  return r.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(apiBody(r.request().url()))});
 });
}
try{
 await launch();
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 await worker.evaluate(()=>chrome.storage.local.set({'margin:settings':{intro:false,weather:true,footprint:false,privacyExternal:true,theme:'dark',bg:{mode:'off'}},'margin:weather-location-v2':{revision:1,loc:{name:'珠海市',lat:22.2716,lon:113.5769,manual:true,at:Date.now()}}}));
 let page=await context.newPage();await page.goto('https://www.bilibili.com/');await page.locator('.wx-live').getByText('Live',{exact:true}).waitFor();
 const temp=await page.locator('.wx-temp').textContent();
 const at=await page.evaluate(()=>{const c=JSON.parse(localStorage.getItem('margin:weather-cache'));c.at=Date.now()-3*86400000;localStorage.setItem('margin:weather-cache',JSON.stringify(c));return c.at});
 offline=true;delay=2500;await page.reload();
 await page.locator('.wx-live').getByText(/本地缓存/).waitFor({timeout:2000});
 assert.equal(await page.locator('.wx-temp').textContent(),temp);
 assert.equal(await page.locator('.wx-hours').getByText('现在',{exact:true}).count(),0);
 assert.equal(await page.locator('.wx-week').getByText('今天',{exact:true}).count(),0);
 checks.push('cached weather renders before failed network refresh and labels historical forecasts');
 await page.waitForTimeout(3000);
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('margin:weather-cache')).at),at);
 await page.locator('.wx').screenshot({path:join(out,'offline-cache.png')});
 checks.push('failed refresh retains temperature and original timestamp');
 await context.close();delay=0;await launch();page=await context.newPage();await page.goto('https://www.bilibili.com/');
 await page.locator('.wx-live').getByText(/本地缓存/).waitFor();
 assert.equal(await page.locator('.wx-temp').textContent(),temp);
 checks.push('browser restart keeps last saved city and offline weather');
 const worker2=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 await worker2.evaluate(()=>chrome.storage.local.set({'margin:weather-location-v2':{revision:2,loc:{name:'珠海市',lat:22.2716,lon:113.5769,manual:false,at:Date.now()}}}));
 await page.waitForTimeout(1000);
 assert.equal(await page.locator('.wx-temp').textContent(),temp);
 assert.equal(await page.locator('.wx-empty').count(),0);
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('margin:weather-cache')).at),at);
 checks.push('same-city location broadcasts retain historical weather after failed reload');
 await page.locator('.wx').screenshot({path:join(out,'same-city-cache.png')});
}finally{await context?.close();writeFileSync(join(out,'report.json'),JSON.stringify({checks},null,2))}
console.log(JSON.stringify({checks}));
