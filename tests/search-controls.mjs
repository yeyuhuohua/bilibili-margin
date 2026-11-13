import assert from 'node:assert/strict';
import { build } from 'vite';
import { chromium } from 'playwright';
import { readFileSync,mkdirSync,writeFileSync } from 'node:fs';
import { resolve,join } from 'node:path';
const out=resolve(process.env.SMOKE_OUT||'delivery/search-input-regression');mkdirSync(out,{recursive:true});
const built=await build({configFile:false,publicDir:false,logLevel:'error',build:{write:false,minify:false,lib:{entry:'tests/search-controls-entry.ts',name:'searchControls',formats:['iife']}}});
const code=(Array.isArray(built)?built[0]:built).output.find(x=>x.type==='chunk').code;
const browser=await chromium.launch({channel:'chromium',headless:true}),checks=[],errors=[];
const check=(name,value)=>{assert(value,name);checks.push(name);};
try{
 const page=await browser.newPage({viewport:{width:1300,height:800}});page.on('pageerror',e=>errors.push(e.message));
 const wallpaper=readFileSync('tests/fixtures/glass-wallpaper.svg').toString('base64');
 await page.setContent(`<html class="margin-skin margin-search" data-margin-theme="dark" data-margin-glass="liquid"><style>html{--m-surface:#1a1a1c;--m-ink:#ededee;--m-chip:#ffffff14;--m-line:#ffffff22;--m-sans:system-ui;--m-muted:#aaa}body{margin:60px;background:url(data:image/svg+xml;base64,${wallpaper}) center/cover;min-height:650px}.search-header{display:flex;justify-content:center}.search-input-wrap{display:flex;align-items:center}.search-input-el{border:0;outline:none;min-width:0;background:none}button{font:inherit}</style><body><div class="search-header"><form class="search-input-wrap"><span>⌕</span><input class="search-input-el" value="lpl" aria-label="搜索视频"><button class="search-button">搜索</button></form></div><div class="search-tabs"><div class="vui_tabs--nav"><div class="vui_tabs--nav-item vui_tabs--nav-item-active"><span class="vui_tabs--nav-link">视频 <small class="vui_tabs--nav-num">99+</small></span></div></div></div></body></html>`);
 await page.addStyleTag({content:readFileSync('src/content/pages.css','utf8')});await page.addScriptTag({content:code});await page.evaluate(()=>{window.release=searchControls.mountSearchControls();window.submits=0;document.querySelector('form').onsubmit=e=>{e.preventDefault();window.submits++;};});
 await page.waitForFunction(()=>document.querySelector('.search-input-wrap').style.backdropFilter.includes('url('));
 check('visible large search input receives lens profile',await page.locator('.search-input-wrap').getAttribute('data-material')==='lens');
 check('lens creates three-channel edge optics',await page.evaluate(()=>{const el=document.querySelector('.search-input-wrap');const id=el.style.backdropFilter.match(/#([^\s)"']+)/)[1];return document.getElementById(id).querySelectorAll('feDisplacementMap').length===3;}));
 await page.getByRole('textbox',{name:'搜索视频'}).fill('新的关键词');await page.keyboard.press('Enter');check('original input and Enter submission preserved',await page.evaluate(()=>window.submits===1));
 await page.screenshot({path:join(out,'liquid.png')});
 await page.evaluate(()=>document.documentElement.dataset.marginGlass='soft');await page.waitForFunction(()=>!document.querySelector('.search-input-wrap').style.backdropFilter.includes('url('));check('frosted mode remains selectable',await page.locator('.search-input-wrap').evaluate(el=>getComputedStyle(el).backdropFilter.includes('blur(')));
 await page.evaluate(()=>document.documentElement.dataset.marginGlass='flat');await page.waitForFunction(()=>document.querySelector('.search-input-wrap').style.backdropFilter==='none');check('flat mode removes refraction',true);
 await page.evaluate(()=>{document.documentElement.dataset.marginGlass='liquid';const old=document.querySelector('.search-input-wrap');const next=old.cloneNode(true);next.removeAttribute('style');next.removeAttribute('data-material');next.removeAttribute('data-margin-search-controls');old.replaceWith(next);});await page.waitForFunction(()=>document.querySelector('.search-input-wrap').style.backdropFilter.includes('url('));
 check('native hydration replacement receives exactly one new lens',await page.locator('.search-input-wrap[data-material="lens"]').count()===1&&await page.locator('filter[id^="lg-"]:not(#lg-bar):not(#lg-thumb):not(#lg-dynamic)').count()===2);
 await page.evaluate(()=>window.release());check('cleanup removes observers artwork and element decoration',await page.locator('svg[data-margin-glass-filters]').count()===0&&!await page.locator('.search-input-wrap').getAttribute('data-material'));
 check('no uncaught errors',errors.length===0);console.log(JSON.stringify({passed:checks.length,errors}));
}finally{writeFileSync(join(out,'report.json'),JSON.stringify({passed:checks.length,checks,errors,scope:'Native-shaped input with actual source decorator in Chromium; local rendering and form submission only.'},null,2));await browser.close();}
