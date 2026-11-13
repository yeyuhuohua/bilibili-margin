// Large subscribed collection switching on the native search page.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync,mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve,join } from 'node:path';
import { installMocks } from './mocks.mjs';
const out=resolve(process.env.SMOKE_OUT||'delivery/favorites-paint');mkdirSync(out,{recursive:true});
const ext=resolve(process.env.SMOKE_EXT||'dist'),errors=[],requests=[],paints=[],layers=new Map();
const recording=process.env.RECORDING_VIEWPORT==='1',viewport=recording?{width:1065,height:1330}:{width:1440,height:1000};
const ctx=await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(),'margin-paint-')),{channel:'chromium',headless:true,viewport,deviceScaleFactor:recording?1.5:1,args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
try{
 await installMocks(ctx,async u=>{
  if(u.includes('/folder/collected/list')){await new Promise(r=>setTimeout(r,180));return {code:0,data:{has_more:false,list:Array.from({length:50},(_,i)=>({id:10000+i,type:21,title:'订阅合集 '+i,media_count:20,cover:'https://i0.hdslb.com/bfs/mock/cover.jpg'}))}};}
  if(u.includes('/fav/season/list')){requests.push(u);const id=Number(new URL(u).searchParams.get('season_id'));return {code:0,data:{medias:Array.from({length:4},(_,i)=>({id:id*10+i,bvid:'BVtest'+id+i,title:'封面预览 '+i,cover:'https://i0.hdslb.com/bfs/mock/cover-'+(id*10+i)+'.jpg',duration:30,attr:0}))}};}
 });
 await ctx.route(/^https:\/\/i0\.hdslb\.com\/bfs\/mock\/cover(?:-\d+)?\.jpg(?:@.*)?$/,r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="720" height="480"><defs><pattern id="p" width="60" height="60" patternUnits="userSpaceOnUse"><path d="M0 0H60V60H0Z" fill="white"/><path d="M0 0H30V30H0ZM30 30H60V60H30Z" fill="#ee80ae"/></pattern></defs><path d="M0 0H720V480H0Z" fill="url(#p)"/><path d="M20 280H700V440H20Z" fill="#10121b"/><text x="60" y="380" font-size="64" fill="white">COVER PREVIEW</text></svg>'}));
 const worker=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');await worker.evaluate(async()=>{await globalThis.marginLocalGlassReady;await chrome.storage.local.set({'margin:settings':{intro:false,theme:'dark',glass:'liquid',bg:{mode:'off'}}});});
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('https://search.bilibili.com/all?keyword=lpl');await page.locator('#margin-watch-top .top').waitFor();
 const wallpaper=readFileSync('tests/fixtures/glass-wallpaper.svg').toString('base64');await page.addStyleTag({content:`body{background:url(data:image/svg+xml;base64,${wallpaper}) center/cover fixed!important}`});
 await page.locator('#margin-watch-top').getByRole('button',{name:'收藏',exact:true}).click();const dialog=page.getByRole('dialog',{name:'收藏夹',exact:true});await dialog.locator('.gf-root').first().waitFor();await page.waitForTimeout(1000);
 const cdp=await ctx.newCDPSession(page);cdp.on('LayerTree.layerTreeDidChange',({layers:ls})=>(ls||[]).forEach(l=>layers.set(l.layerId,l)));cdp.on('LayerTree.layerPainted',p=>paints.push({...p,layer:layers.get(p.layerId)}));await cdp.send('LayerTree.enable');
 await page.evaluate(()=>{window.shellMutations=[];new MutationObserver(rs=>{for(const r of rs)window.shellMutations.push({tag:r.target.tagName,attr:r.attributeName,value:r.target.getAttribute(r.attributeName)});}).observe(document.documentElement,{attributes:true});window.startY=scrollY;});
 const pane=await dialog.boundingBox(),clip={x:0,y:200,width:Math.min(500,Math.floor(pane.x)-10),height:600};
 if(process.env.FOLDER_REPRO_SQUIRCLE==='1')await page.evaluate(()=>{const s=document.createElement('style');s.textContent='.sheet{corner-shape:squircle!important}';document.getElementById('margin-watch-top').shadowRoot.append(s);});
 const baseline=await page.screenshot({clip,caret:'hide'});writeFileSync(join(out,'baseline.png'),baseline);
 await dialog.getByRole('radio',{name:'订阅内容',exact:true}).click();
 for(let i=0;i<12;i++){await page.waitForTimeout(100);await page.screenshot({path:join(out,`frame-${String(i).padStart(2,'0')}.png`),clip,caret:'hide'});}
 const pixelCheck=JSON.parse(execFileSync('python',['-c',`from PIL import Image,ImageChops,ImageStat
from pathlib import Path
import json,sys
p=Path(sys.argv[1]);base=Image.open(p/'baseline.png').convert('RGB');peak=0;mean=0
for f in p.glob('frame-*.png'):
 d=ImageChops.difference(base,Image.open(f).convert('RGB'));peak=max(peak,max(v[1] for v in d.getextrema()));mean=max(mean,sum(ImageStat.Stat(d).mean)/3)
print(json.dumps({'maxChannelDifference':peak,'maxMeanDifference':mean}))`,out],{encoding:'utf8'}));
 // A one-level raster dither change is not a whole-page flash.
 assert(pixelCheck.maxChannelDifference<=2&&pixelCheck.maxMeanDifference<=.25,JSON.stringify(pixelCheck));
 await dialog.locator('.gf-root').filter({hasText:'订阅合集 0'}).waitFor();
 const first=dialog.locator('.gf-root').first();await first.locator('.gf-front').screenshot({path:join(out,'first-folder.png')});
 assert(await first.locator('.gf-tilt > .gf-files .gf-sheet img').count()===4,'Exercise real thumbnail layers instead of an empty-preview fixture');
 for(let i=0;i<6;i++){const folder=dialog.locator('.gf-root').nth(i);await folder.locator('.gf-hit').hover();await page.waitForTimeout(220);assert(await folder.locator('.gf-label').evaluate(el=>el.checkVisibility({opacityProperty:true,visibilityProperty:true})));}
 await first.locator('.gf-hit').hover();await page.waitForTimeout(600);await page.screenshot({path:join(out,recording?'recording-size.png':'hover.png')});
 const labelBoxes=await dialog.locator('.gf-title').evaluateAll(els=>els.map(el=>{const b=el.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height};}).filter(b=>b.y>200&&b.y+b.h<innerHeight-20).slice(0,9));
 const labelCheck=JSON.parse(execFileSync('python',['-c',`from PIL import Image
import json,sys
im=Image.open(sys.argv[1]).convert('RGB');scale=float(sys.argv[3]);counts=[]
for b in json.loads(sys.argv[2]):
 box=(int(b['x']*scale),int(b['y']*scale),int((b['x']+b['w'])*scale),int((b['y']+b['h'])*scale))
 counts.append(sum(min(c)>200 and max(c)-min(c)<24 for c in im.crop(box).getdata()))
print(json.dumps(counts))`,join(out,recording?'recording-size.png':'hover.png'),JSON.stringify(labelBoxes),recording?'1.5':'1'],{encoding:'utf8'}));
 assert(labelCheck.length>=6&&labelCheck.every(n=>n>=8),'Rasterized folder labels disappeared despite visible DOM: '+JSON.stringify(labelCheck));
 if(process.env.MEASURE_FOLDER_HOVER){
  await cdp.send('Performance.enable');await page.mouse.move(10,100);await page.waitForTimeout(1000);
  const snapshot=()=>first.locator('.gf-frost').evaluate(el=>({image:el.querySelector('.gf-art')?.style.transform||'',thumb:getComputedStyle(el.querySelector('.gf-sheet')).transform}));
  const closed=await snapshot();await first.locator('.gf-hit').hover();await page.waitForTimeout(1000);const opened=await snapshot();
  await first.locator('.gf-frost').evaluate(el=>{window.frostMutations=0;window.frostCounter=new MutationObserver(rs=>window.frostMutations+=rs.length);window.frostCounter.observe(el,{subtree:true,attributes:true,attributeFilter:['style']});});
  const values=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
  const before=await values();await cdp.send('Tracing.start',{categories:'devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-cc.debug',transferMode:'ReturnAsStream'});
  const frames=await first.evaluate(el=>new Promise(resolve=>{const b=el.getBoundingClientRect(),hit=el.querySelector('.gf-hit'),stamps=[];let n=0;function tick(t){stamps.push(t);hit.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerType:'mouse',clientX:b.x+b.width*(.2+.6*(n%40)/39),clientY:b.y+b.height*.7}));if(++n<150)requestAnimationFrame(tick);else resolve(stamps.slice(1).map((v,i)=>v-stamps[i]));}requestAnimationFrame(tick);}));
  const completed=new Promise(r=>cdp.once('Tracing.tracingComplete',r));await cdp.send('Tracing.end');const {stream}=await completed;let trace='';for(;;){const chunk=await cdp.send('IO.read',{handle:stream});trace+=chunk.data;if(chunk.eof)break;}await cdp.send('IO.close',{handle:stream});
  const after=await values(),events=JSON.parse(trace).traceEvents||[],sum=name=>events.filter(e=>e.name===name&&e.ph==='X').reduce((s,e)=>s+(e.dur||0)/1000,0);
  const sorted=[...frames].sort((a,b)=>a-b),perf={closed,opened,frostStyleWrites:await page.evaluate(()=>{frostCounter.disconnect();return frostMutations;}),frames:frames.length,p95FrameIntervalMs:sorted[Math.floor(sorted.length*.95)],framesOver25ms:frames.filter(n=>n>25).length,paintMs:sum('Paint'),rasterMs:sum('RasterTask'),paintEvents:events.filter(e=>e.name==='Paint').length,taskMs:(after.TaskDuration-before.TaskDuration)*1000,styleMs:(after.RecalcStyleDuration-before.RecalcStyleDuration)*1000,scope:'Same isolated Chromium workload; trace/headless frame intervals are not physical device FPS.'};
  writeFileSync(join(out,'hover-'+process.env.MEASURE_FOLDER_HOVER+'.json'),JSON.stringify(perf,null,2));console.log(JSON.stringify({hover:perf}));
  if(process.env.MEASURE_FOLDER_HOVER!=='baseline'){assert.equal(perf.frostStyleWrites,0,'Pointer movement must not invalidate blurred snapshot images');assert.equal(closed.thumb,opened.thumb,'Blurred thumbnail snapshot must remain stationary through expansion');}
 }
 assert(await first.evaluate(el=>el.hasAttribute('data-entered')&&['.gf-front','.gf-back','.gf-label'].every(s=>el.querySelector(s).checkVisibility({opacityProperty:true,visibilityProperty:true}))),'First folder body and label must be visible, not only its menu key');
 await dialog.getByRole('button',{name:'关闭',exact:true}).click();await page.locator('#margin-watch-top').getByRole('button',{name:'收藏',exact:true}).click();await page.waitForTimeout(500);
 assert(await first.locator('.gf-front').evaluate(el=>el.checkVisibility({opacityProperty:true,visibilityProperty:true})),'First folder remains visible after reopening');
 const summary={requests:requests.length,errors,paints:paints.length,rootPaints:paints.filter(p=>p.clip.width>1000&&p.clip.height>500).map(p=>({clip:p.clip,layer:p.layer&&{x:p.layer.offsetX,y:p.layer.offsetY,w:p.layer.width,h:p.layer.height}})),shell:await page.evaluate(()=>({mutations:window.shellMutations,startY:window.startY,endY:scrollY,glass:document.documentElement.dataset.marginGlass})),pane:await dialog.evaluate(el=>({width:el.offsetWidth,contain:getComputedStyle(el).contain,transform:getComputedStyle(el).transform}))};
 assert(requests.length<50,'Ahead-of-scroll prefetch must not fetch all 50 subscriptions: '+requests.length);
 const initial=requests.length;await dialog.locator('.gf-root').nth(30).scrollIntoViewIfNeeded();await page.waitForTimeout(600);assert(requests.length>initial,'Scrolling must still warm newly visible previews');
 summary.afterScrollRequests=requests.length;summary.stableBackgroundFrames=12;summary.pixelCheck=pixelCheck;summary.rasterizedLabelPixels=labelCheck;summary.firstFolderVisible=true;summary.firstFolderVisibleOnReopen=true;summary.scope='Isolated Chromium, four real thumbnail layers per folder, static wallpaper and mocked subscriptions; 150% scale matches recording conditions. Hardware-specific Edge still needs user verification.';
 writeFileSync(join(out,'report.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
}finally{await ctx.close();}
