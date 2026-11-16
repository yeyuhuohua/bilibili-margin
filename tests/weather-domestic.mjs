// Default: deterministic mocked APIs. WEATHER_LIVE=1: only NMC requests use the real network.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { installMocks } from './mocks.mjs';
const live=process.env.WEATHER_LIVE==='1',out=resolve(process.env.SMOKE_OUT||`delivery/weather-connectivity/${live?'live':'mocked'}`);mkdirSync(out,{recursive:true});
const ext=resolve(process.env.SMOKE_EXT||'dist'),checks=[],requests=[],responses=[],errors=[];let failing=false;
const date=new Date(Date.now()+8*3600e3).toISOString().slice(0,10);
const observed=new Date(Date.now()+8*3600e3-15*60e3).toISOString().slice(0,16).replace('T',' ');
const forecast={code:0,data:{real:{station:{code:'sdnjf',province:'广东省',city:'珠海'},publish_time:observed,weather:{temperature:22,feelst:24.6,info:'晴'},wind:{speed:1.3}},predict:{detail:Array.from({length:3},(_,i)=>({date:new Date(Date.parse(date+'T00:00:00Z')+(i+1)*86400e3).toISOString().slice(0,10),day:{weather:{temperature:'25',info:'晴'}},night:{weather:{temperature:'22',info:'晴'}}}))}}};
const context=await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(),'margin-weather-domestic-')),{channel:'chromium',headless:true,viewport:{width:1600,height:1000},args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
try{
 await installMocks(context,url=>{
  const u=new URL(url);
  if(u.hostname!=='www.nmc.cn')return;
  if(u.pathname==='/rest/province')return[{code:'AGD',name:'广东省'}];
  if(u.pathname==='/rest/province/AGD')return[{code:'sdnjf',province:'广东省',city:'珠海'}];
  if(u.pathname==='/rest/weather')return forecast;
 });
 if(live)await context.route('https://www.nmc.cn/**',r=>r.continue());
 else await context.route('https://www.nmc.cn/rest/weather?*',r=>r.fulfill({json:failing?{code:-500}:forecast,headers:{'access-control-allow-origin':'*'}}));
 await context.route('https://api.open-meteo.com/**',r=>r.abort('timedout'));
 context.on('request',r=>{if(/nmc\.cn|api\.open-meteo/.test(r.url()))requests.push(r.url());});
 context.on('response',async r=>{if(r.url().includes('www.nmc.cn/rest/weather?'))try{const body=await r.json();responses.push({url:r.url(),status:r.status(),city:body.data?.real?.station?.city,temperature:body.data?.real?.weather?.temperature,published:body.data?.real?.publish_time});}catch{}});
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 await worker.evaluate(()=>chrome.storage.local.set({'margin:settings':{intro:false,theme:'dark',weather:true,footprint:false,privacyExternal:true,bg:{mode:'off'}},'margin:weather-location-v2':{revision:1,loc:{name:'珠海市',lat:22.2716,lon:113.5769,region:'广东省 · 中国',manual:true,at:Date.now()}}}));
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));const started=Date.now();
 await page.goto('https://www.bilibili.com/');await page.locator('.wx-source').getByText('中央气象台',{exact:true}).waitFor({timeout:20000});
 const freshMs=Date.now()-started,temp=await page.locator('.wx-temp').textContent();
 const cached=await page.evaluate(()=>JSON.parse(localStorage.getItem('margin:weather-cache')));
 assert.equal(cached.source,'nmc');assert.equal(cached.loc.name,'珠海市');assert(Number.isFinite(cached.temp));assert(Number.isFinite(cached.sourceAt));
 assert.equal(await page.locator('.wx-hours').count(),0);assert.equal(cached.rainPct,null);assert.equal(await page.locator('.wx-week li').count(),3);
 assert(!(await page.locator('.wx-place small').textContent()).includes('降水'));assert(!(await page.locator('.wx').textContent()).includes('9999'));
 assert.equal(requests.filter(u=>u.includes('api.open-meteo.com')).length,0);
 checks.push('fresh domestic weather succeeds while original forecast source is unavailable; no invented hourly/probability data');
 await page.locator('.wx').screenshot({path:join(out,'weather-dark.png')});
 await page.setViewportSize({width:1000,height:900});
 assert(await page.locator('.wx-side').evaluate(el=>el.scrollWidth<=el.clientWidth+1));checks.push('source and update time fit a smaller desktop window');
 await worker.evaluate(()=>chrome.storage.local.set({'margin:settings':{intro:false,theme:'light',weather:true,footprint:false,privacyExternal:true,bg:{mode:'off'}}}));
 await page.waitForFunction(()=>document.querySelector('#margin-root').shadowRoot.querySelector('.app').dataset.theme==='light');
 await page.locator('.wx').screenshot({path:join(out,'weather-light.png')});
 if(live&&process.env.WEATHER_MORE_CITIES==='1'){
  let revision=1;
  for(const loc of [{name:'北京市',lat:39.9075,lon:116.3972,region:'北京市 · 中国'},{name:'上海市',lat:31.23,lon:121.47,region:'上海市 · 中国'},{name:'深圳市',lat:22.54,lon:114.06,region:'广东省 · 中国'}]){
   console.log('Checking live city: '+loc.name);
   await worker.evaluate(({loc,revision})=>chrome.storage.local.set({'margin:weather-location-v2':{revision,loc:{...loc,manual:true,at:Date.now()}}}),{loc,revision:++revision});
   await page.waitForFunction(name=>{const value=JSON.parse(localStorage.getItem('margin:weather-cache'));return value?.source==='nmc'&&value.loc.name===name;},loc.name,{timeout:20000});
   checks.push(`real domestic source and city switch: ${loc.name}`);
  }
 }
 if(!live){
  const oldAt=await page.evaluate(()=>{const c=JSON.parse(localStorage.getItem('margin:weather-cache'));c.at=Date.now()-31*60e3;localStorage.setItem('margin:weather-cache',JSON.stringify(c));return c.at;});
  failing=true;await page.reload();await page.locator('.wx-live').getByText(/本地缓存/).waitFor();await page.waitForTimeout(500);
  assert.equal(await page.locator('.wx-temp').textContent(),temp);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('margin:weather-cache')).at),oldAt);
  checks.push('failed domestic and original sources retain domestic cache and its original timestamp');
  const count=requests.length;
  await worker.evaluate(()=>chrome.storage.local.set({'margin:settings':{intro:false,theme:'light',weather:true,privacyExternal:false,bg:{mode:'off'}}}));await page.reload();await page.waitForTimeout(500);
  assert.equal(requests.length,count);checks.push('external service consent disables domestic requests too');
 }
 assert.deepEqual(errors,[]);writeFileSync(join(out,'report.json'),JSON.stringify({checks,errors,live,freshMs,temp,cached,requests,responses},null,2));
 console.log(JSON.stringify({checks,live,freshMs,temp,responses}));
}finally{await context.close();writeFileSync(join(out,'network.json'),JSON.stringify({checks,requests,responses,errors},null,2));}
