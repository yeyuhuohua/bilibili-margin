import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { installMocks } from './mocks.mjs';

const ext=resolve(process.env.SMOKE_EXT || 'dist'),out=resolve(process.env.SMOKE_OUT || 'delivery/continuous-corners');
mkdirSync(out,{recursive:true});
const context=await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(),'margin-corners-')),{
  executablePath:process.env.CHROMIUM_PATH || 'C:/Users/asus/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe',
  headless:true,viewport:{width:1440,height:1000},args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`],
});
const results=[];
const shape=locator=>locator.evaluate(el=>getComputedStyle(el).getPropertyValue('corner-shape').trim());
const check=(name,value)=>{assert.ok(value,name);results.push(name);};
const squircle=value=>['squircle','superellipse(2)'].includes(value);
const round=value=>['round','superellipse(1)'].includes(value);
try{
  await installMocks(context);
  const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(()=>chrome.storage.local.set({'margin:settings':{intro:false,theme:'dark',bg:{mode:'off'}}}));
  const page=await context.newPage();
  await page.goto('https://www.bilibili.com/',{waitUntil:'domcontentloaded'});
  await page.locator('#margin-root .grid .card').first().waitFor();
  check('test browser supports native corner-shape',await page.evaluate(()=>CSS.supports('corner-shape','squircle')));
  check('video covers use continuous corners',squircle(await shape(page.locator('#margin-root .cover').first())));
  check('footprint panel uses continuous corners',squircle(await shape(page.locator('#margin-root .fp-card'))));
  check('collapsed hero search stays a capsule',round(await shape(page.locator('#margin-root .hero-search'))));
  check('theme track stays round',round(await shape(page.locator('#margin-root .ts'))));
  check('theme thumb stays circular',round(await shape(page.locator('#margin-root .ts-sm'))));
  await page.locator('#margin-root .hd-settings').click();
  check('settings panel uses continuous corners',squircle(await shape(page.locator('#margin-root .sheet.stg'))));
  check('settings search stays a capsule',round(await shape(page.locator('#margin-root .stg-search'))));
  await page.screenshot({path:join(out,'settings-dark.png')});
  await page.keyboard.press('Escape');
  for(const radius of [0,50,100,150]){
    await worker.evaluate(async radius=>{
      const s=(await chrome.storage.local.get('margin:settings'))['margin:settings'];
      await chrome.storage.local.set({'margin:settings':{...s,radius}});
    },radius);
    await page.waitForTimeout(80);
    const value=await page.locator('#margin-root .cover').first().evaluate(el=>parseFloat(getComputedStyle(el).borderTopLeftRadius));
    check(`radius control ${radius} retains expected dimensions`,Math.abs(value-12*radius/100)<.01);
  }
  await worker.evaluate(()=>chrome.storage.local.set({'margin:settings':{intro:false,theme:'dark',bg:{mode:'off'},radius:100}}));
  const popup=await context.newPage();
  await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
  check('popup segmented control uses continuous corners',squircle(await shape(popup.locator('.seg'))));
  check('popup switch remains a capsule',round(await shape(popup.locator('.sw').first())));
  await popup.close();
  // Computed native shape changes the actual hit-test silhouette, not just a label.
  const geometry=await page.evaluate(()=>{
    const host=document.createElement('div');host.style.cssText='position:fixed;left:10px;top:10px;width:100px;height:100px;border-radius:40px;background:red;z-index:2147483647';
    document.documentElement.append(host);host.style.setProperty('corner-shape','round');
    const circular=document.elementFromPoint(18,18)===host;
    host.style.setProperty('corner-shape','squircle');const continuous=document.elementFromPoint(18,18)===host;
    host.remove();return{circular,continuous};
  });
  check('native hit testing follows the continuous silhouette',!geometry.circular && geometry.continuous);
}finally{
  writeFileSync(join(out,'report.json'),JSON.stringify({passed:results.length,results,scope:'Full extension loaded in isolated Chromium; native shapes, setting radii, preserved circles/capsules, popup and hit-test geometry.'},null,2));
  await context.close();
}
console.log(JSON.stringify({passed:results.length}));
