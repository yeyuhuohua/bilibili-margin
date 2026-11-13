import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installMocks } from './mocks.mjs';

const out=resolve(process.env.SMOKE_OUT || 'delivery/navigation-layout'); mkdirSync(out,{recursive:true});
const ext=resolve(process.env.SMOKE_EXT || 'dist');
const context=await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(),'margin-nav-layout-')), {channel:'chromium',headless:true,viewport:{width:1600,height:1000},args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
const checks=[],errors=[];
try {
 await installMocks(context);
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 const seed=patch=>worker.evaluate(async patch=>{const old=(await chrome.storage.local.get('margin:settings'))['margin:settings'];await chrome.storage.local.set({'margin:settings':{...old,...patch}})},patch);
 await seed({intro:false,weather:false,footprint:false,bg:{mode:'off'},theme:'dark'});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 for(const url of ['https://www.bilibili.com/','https://www.bilibili.com/video/BV1mdxN68E7F/']){
  await seed({headLabels:false});await page.goto(url);
  const nav=page.locator('.top .et').first();await nav.waitFor();
  assert(!(await nav.getAttribute('class')).includes('et-labels'));
  await seed({headLabels:true});await page.locator('.top .et-labels').waitFor();
  for(const width of [1600,1280,1024]){
   await page.setViewportSize({width,height:1000});
   const bounds=await nav.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=width+1,JSON.stringify(bounds));
  }
  checks.push(`157: optional labels fit homepage/watch header ${url}`);
 }
 await page.setViewportSize({width:1600,height:1000});
 await seed({feedLayout:'sidebar'});await page.goto('https://t.bilibili.com/');
 await page.locator('#margin-root .fd-left .fd-ups-row .fd-up').first().waitFor();
 await page.locator('#margin-root .fd-right .fd-live').waitFor();
 const up=page.locator('#margin-root .fd-ups-row .fd-up').first();
 await up.click();assert.equal(await up.getAttribute('aria-pressed'),'true');
 assert.equal(await page.locator('#margin-root .fd-left .fd-ups').count(),1);
 await page.screenshot({path:join(out,'sidebar-dark.png')});
 await seed({feedLayout:'classic'});await page.locator('#margin-root .fd-main > .fd-ups').waitFor();
 await page.locator('#margin-root .fd-left .fd-live').waitFor();
 await seed({feedLayout:'sidebar',theme:'light'});await page.reload();
 await page.locator('#margin-root .fd-left .fd-ups').waitFor();
 const search=page.getByRole('searchbox',{name:'在关注里搜 UP 主'});await search.fill('映间');await search.press('Escape');assert.equal(await search.inputValue(),'');
 assert.equal(await page.locator('#margin-root .page-back-top').count(),0);
 await page.locator('#margin-root .fm-bar').click();
 await page.locator('#margin-root .fm-item[aria-label="回到顶部"]').click();
 await page.screenshot({path:join(out,'sidebar-light.png')});
 checks.push('146: live card/UP strip switch parents, reload persists, search/selection/back-to-top remain usable');
 await page.locator('#margin-root .top [aria-label="设置"]').click();
 await page.getByRole('tab',{name:'搜索与顶栏',exact:true}).click();
 const toggle=page.getByRole('switch',{name:'顶栏显示文字',exact:true});await toggle.click();
 await page.waitForFunction(()=>!document.querySelector('#margin-root').shadowRoot.querySelector('.et-labels'));
 checks.push('157: rendered settings switch updates header');assert.deepEqual(errors,[]);
}finally{await context.close();writeFileSync(join(out,'report.json'),JSON.stringify({checks,errors},null,2))}
console.log(JSON.stringify({checks}));
