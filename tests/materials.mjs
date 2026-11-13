// Actual extension modules, local mock responses only. No account or real post.
import assert from 'node:assert/strict';
import { build } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createServer } from 'node:http';

const out=resolve('delivery/materials-preview'); mkdirSync(out,{recursive:true});
const bundle=await build({configFile:false,publicDir:false,logLevel:'error',build:{write:false,minify:false,lib:{entry:'tests/materials-entry.ts',name:'materials',formats:['iife']}}});
const code=(Array.isArray(bundle)?bundle[0]:bundle).output.find(x=>x.type==='chunk').code;
writeFileSync(join(out,'modules.js'),code);
const wallpaper=readFileSync('tests/fixtures/glass-wallpaper.svg').toString('base64');
const html=`<!doctype html><html lang="zh-CN" data-margin-glass="liquid"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>映间 · 材质与发布预览</title>
<style>body{margin:0}.app{min-height:100vh;background:url(data:image/svg+xml;base64,${wallpaper}) center/cover fixed!important}.demo{padding:50px 6vw;max-width:1100px;margin:auto}.demo h1{font-size:32px}.demo-note{color:var(--muted);line-height:1.8}.demo-controls{display:flex;flex-wrap:wrap;gap:10px;margin:24px 0}.demo-controls button,.demo-filter{padding:10px 18px;border:1px solid #ffffff66;border-radius:999px;background:var(--nav-glass);color:var(--ink);cursor:pointer}.demo-filter{display:flex;gap:22px;width:max-content}.demo-folders{display:flex;gap:35px;flex-wrap:wrap;margin-top:15px}</style>
<div class="app" data-theme="dark" data-glass="liquid"></div>
<script>
window.state={login:true,calls:[],failUpload:0,uncertain:false,delay:0,published:0};
window.chrome={runtime:{getURL:p=>p,getManifest:()=>({version:'0.60.26',version_name:'0.6.26'}),sendMessage:async()=>({ok:true})},storage:{local:{get:async k=>({[k]:{intro:false,theme:'dark',glass:'liquid',msgRemind:false}}),set:async()=>{}},onChanged:{addListener(){},removeListener(){}}}};
window.fetch=async(url,options={})=>{
 const path=String(url);state.calls.push({url:path,method:options.method||'GET',body:options.body instanceof FormData?[...options.body.keys()]:options.body});
 let data={};
 if(path.includes('/nav'))data={isLogin:state.login,mid:1,uname:'本地预览',face:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="64" height="64"%3E%3Crect width="64" height="64" rx="32" fill="%233e4b5c"/%3E%3Ccircle cx="32" cy="24" r="10" fill="%23eee"/%3E%3Cpath d="M12 58a20 20 0 0140 0" fill="%23eee"/%3E%3C/svg%3E#',wbi_img:{}};
 if(path.includes('upload_bfs')){await new Promise(r=>setTimeout(r,state.delay));if(state.failUpload){state.failUpload--;return Response.json({code:-1,message:'模拟上传失败'});}data={image_url:'https://i0.hdslb.com/bfs/mock/image.png',image_width:400,image_height:400};}
 if(path.includes('create/dyn')){await new Promise(r=>setTimeout(r,state.delay));if(state.uncertain)throw Error('mock network disconnect');data={dyn_id_str:'123456789'};}
 return Response.json({code:0,data});
};
document.cookie='bili_jct=preview-only;path=/';
</script><script src="modules.js"></script><script>
const app=document.querySelector('.app');const style=document.createElement('style');style.textContent=materials.css+materials.takeover;document.head.append(style);
const filters=materials.glassFilters();app.append(filters);
const header=materials.createHeader({tabs:materials.SITE_LINKS,onTheme:()=>setTheme(app.dataset.theme==='dark'?'light':'dark'),msgRemind:()=>false,onSettings:()=>{}});app.append(header.el);materials.attachNavigationGlass(header,filters);
const demo=document.createElement('main');demo.className='demo';demo.innerHTML='<h1>映间 · 液态玻璃</h1><p class="demo-note">顶栏透镜折射 · 筛选渐变折射 · 文件夹微水纹<br>交互预览，发布不会发送到 B 站。</p><div class="demo-controls"><button id="theme">切换明暗</button><button id="mode">切换纯色材质</button><button id="post">发动态</button></div><div class="demo-filter"><span>综合排序</span><span>最多播放</span><span>最新发布</span></div><div class="demo-folders"></div>';app.append(demo);
window.setTheme=theme=>{app.dataset.theme=theme;document.documentElement.dataset.marginTheme=theme;};
document.querySelector('#theme').onclick=()=>setTheme(app.dataset.theme==='dark'?'light':'dark');
document.querySelector('#mode').onclick=()=>{const mode=app.dataset.glass==='liquid'?'flat':'liquid';app.dataset.glass=mode;document.documentElement.dataset.marginGlass=mode;};
window.filterRelease=materials.attachGlass(document.querySelector('.demo-filter'),filters,{profile:'gradient',blur:1,strength:.4});
for(const [label,art] of [['设计收藏','aurora'],['稍后再看','none']]){const folder=materials.glassFolder({label,image:art==='none'?undefined:'data:image/svg+xml;base64,${wallpaper}',art:art==='none'?'none':undefined,files:[{name:'收藏视频',meta:'本地示例'}],width:290});document.querySelector('.demo-folders').append(folder.el);}
window.composer=materials.createDynamicComposer(app,()=>state.published++);document.querySelector('#post').onclick=()=>composer.open();
</script></html>`;
writeFileSync(join(out,'index.html'),html);
writeFileSync(join(out,'server.mjs'),`import{createServer}from'node:http';import{readFile}from'node:fs/promises';import{fileURLToPath}from'node:url';const root=fileURLToPath(new URL('.',import.meta.url));createServer(async(req,res)=>{const name=req.url?.split('?')[0];if(name!=='/'&&name!=='/modules.js'){res.writeHead(404).end();return;}try{res.setHeader('Content-Type',name==='/'?'text/html; charset=utf-8':'application/javascript');res.end(await readFile(root+(name==='/'?'index.html':'modules.js')));}catch{res.writeHead(500).end();}}).listen(4340,'127.0.0.1');`);
const server=createServer((req,res)=>{const name=req.url?.split('?')[0];if(name==='/'||name==='/modules.js'){res.setHeader('Content-Type',name==='/'?'text/html; charset=utf-8':'application/javascript');res.end(name==='/'?html:code);}else res.writeHead(404).end();});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chromium',headless:true});const checks=[],errors=[];
const check=(name,value)=>{assert.ok(value,name);checks.push(name);};
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>!!document.querySelector('[data-material="lens"]')?.style.backdropFilter.includes('url('));await page.waitForTimeout(600);
 check('lens uses three slight RGB displacement passes',await page.evaluate(()=>document.querySelector('filter[id^="lg-"] feBlend')&&[...document.querySelectorAll('filter[id^="lg-"]')].some(f=>f.querySelectorAll('feDisplacementMap').length===3)));
 check('gradient rim uses independent red and blue axes',await page.evaluate(()=>[...document.querySelectorAll('feDisplacementMap')].some(el=>el.getAttribute('yChannelSelector')==='B')));
 check('upload uses glass tint rather than opaque theme button',await page.locator('.upload').evaluate(el=>getComputedStyle(el).backgroundColor.includes('0.72')));
 await page.evaluate(()=>{window.mapChanges=0;new MutationObserver(rs=>window.mapChanges+=rs.length).observe(document.querySelector('svg[data-margin-glass-filters]'),{subtree:true,attributes:true,attributeFilter:['href']});});await page.waitForTimeout(500);
 check('settled controls do not rebuild displacement maps while idle',await page.evaluate(()=>window.mapChanges===0));
 check('text and thumbnails do not receive turbulence filter',await page.locator('.gf-label').first().evaluate(el=>getComputedStyle(el).filter==='none'));
 await page.screenshot({path:join(out,'dark.png')});await page.locator('#theme').click();await page.waitForTimeout(400);await page.screenshot({path:join(out,'light.png')});
 await page.locator('#mode').click();check('flat setting removes optical backdrop filters',await page.locator('[data-material="lens"]').first().evaluate(el=>getComputedStyle(el).backdropFilter==='none'));
 await page.locator('#mode').click();await page.locator('#theme').click();
 const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-transparency',value:'reduce'}]});
 await page.waitForFunction(()=>!getComputedStyle(document.querySelector('[data-material="lens"]')).backgroundColor.startsWith('rgba'),{},{timeout:2500});const reduced=await page.locator('[data-material="lens"]').first().evaluate(el=>({filter:getComputedStyle(el).backdropFilter,bg:getComputedStyle(el).backgroundColor,media:matchMedia('(prefers-reduced-transparency: reduce)').matches}));
 check('reduced transparency uses opaque unfiltered controls: '+JSON.stringify(reduced),reduced.filter==='none'&&!reduced.bg.startsWith('rgba'));
 await cdp.send('Emulation.setEmulatedMedia',{features:[]});
 const url=page.url();await page.locator('#post').click();await page.getByRole('textbox',{name:'动态内容'}).fill('在映间内编辑\n第二行');
 check('composer opens inside current page and keeps line breaks',page.url()===url&&await page.locator('.dc-text').inputValue()==='在映间内编辑\n第二行');
 check('paperplane is visible in full extension app',await page.locator('.dc-send .m-send-visual').evaluate(el=>getComputedStyle(el).display==='flex'));
 const png={name:'image.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC1sAAAAASUVORK5CYII=','base64')};
 await page.getByLabel('添加动态图片').setInputFiles([png,png]);check('selection gives local previews with no uploads',await page.locator('.dc-picture').count()===2&&await page.evaluate(()=>!state.calls.some(c=>c.method==='POST')));
 await page.getByLabel('添加动态图片').setInputFiles(Array(8).fill(png));check('nine-image limit rejects whole excess selection',await page.locator('.dc-picture').count()===2&&await page.locator('.dc-status').innerText()==='最多添加 9 张图片');
 await page.getByLabel('移除图片 2').click();check('individual preview can be removed',await page.locator('.dc-picture').count()===1);
 await page.getByRole('button',{name:'关闭',exact:true}).click();await page.locator('#post').click();check('draft survives close and reopen',await page.locator('.dc-picture').count()===1&&await page.locator('.dc-text').inputValue()==='在映间内编辑\n第二行');
 await page.evaluate(()=>{state.login=false;});await page.locator('.dc-send').click();await page.getByText('请先登录 B 站，再回来发布；草稿会保留',{exact:true}).waitFor();check('expired login does not upload or navigate',page.url()===url&&await page.evaluate(()=>!state.calls.some(c=>c.method==='POST')));
 await page.evaluate(()=>{state.login=true;state.failUpload=1;});await page.locator('.dc-send').click();await page.getByText('模拟上传失败',{exact:true}).waitFor();check('failed upload preserves editable draft',await page.locator('.dc-picture').count()===1&&!await page.locator('.dc-text').evaluate(el=>el.readOnly));
 await page.evaluate(()=>{state.uncertain=true;});await page.locator('.dc-send').click();await page.getByText(/未收到发布确认/).waitFor();check('uncertain result offers no automatic resubmission',await page.evaluate(()=>state.calls.filter(c=>c.url.includes('create/dyn')).length===1));
 const uploaded=await page.evaluate(()=>state.calls.filter(c=>c.url.includes('upload_bfs')).length);
 await page.evaluate(()=>{state.uncertain=false;state.delay=400;});await page.locator('.dc-send').click();await page.keyboard.press('Escape');check('busy composer cannot close or submit twice',await page.getByRole('dialog').isVisible()&&await page.locator('.dc-send').isDisabled());
 await page.waitForFunction(()=>state.published===1);check('success closes, clears draft, and invokes feed refresh once',await page.locator('.sheet-layer').getAttribute('data-open')==='false'&&await page.locator('.dc-text').inputValue()===''&&page.url()===url);
 check('confirmed uploads reused on explicit retry',await page.evaluate(()=>state.calls.filter(c=>c.url.includes('upload_bfs')).length)===uploaded);
 await page.locator('#post').click();await page.locator('.dc-text').evaluate((el,data)=>{const dt=new DataTransfer();dt.items.add(new File([new Uint8Array([137,80,78,71])],'paste.png',{type:'image/png'}));el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));},null);
 check('clipboard image enters preview queue',await page.locator('.dc-picture').count()===1);await page.getByLabel('移除图片 1').click();await page.getByLabel('添加动态图片').setInputFiles(png);await page.waitForTimeout(500);await page.screenshot({path:join(out,'composer.png')});
 await page.setViewportSize({width:390,height:850});await page.waitForTimeout(400);check('composer remains inside narrow viewport',await page.getByRole('dialog').evaluate(el=>{const b=el.getBoundingClientRect();return b.width<=390&&b.left>=0&&b.right<=390;}));
 check('no uncaught browser errors',errors.length===0);
 const fallback=await browser.newPage({userAgent:'Mozilla/5.0 Firefox/130.0'});await fallback.goto(page.url());await fallback.waitForTimeout(350);
 check('non-Chromium fallback policy uses frosted controls without SVG refraction',await fallback.locator('[data-material="lens"]').first().evaluate(el=>getComputedStyle(el).backdropFilter.includes('blur(')&&!getComputedStyle(el).backdropFilter.includes('url(')));await fallback.close();
 console.log(JSON.stringify({passed:checks.length,errors}));
}finally{writeFileSync(join(out,'report.json'),JSON.stringify({passed:checks.length,checks,errors,scope:'Actual source modules in Chromium; all network calls intercepted by local mock. No real publication; no device FPS guarantee.'},null,2));await browser.close();server.close();}
