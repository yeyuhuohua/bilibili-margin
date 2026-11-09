// 冒烟测试：加载构建好的扩展（dist/），在离线伪造的 B 站上依次打开各个接管页面，
// 断言扩展没有抛未捕获错误、关键元素都在，并保存亮 / 暗两套 1440 截图。
//   pnpm run build && node tests/smoke.mjs
// 环境变量：CHROMIUM_PATH 指定浏览器（默认用 Playwright 自带的 chromium），SMOKE_OUT 截图目录（默认 tests/artifacts），
// SMOKE_THEMES=light,dark，SMOKE_ONLY=home,watch 只跑部分页面，SMOKE_FEATURES 可选择功能用例。
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { apiBody, installMocks } from './mocks.mjs';

const EXT = resolve(process.env.SMOKE_EXT || 'dist');
const OUT = resolve(process.env.SMOKE_OUT || 'tests/artifacts');
const THEMES = (process.env.SMOKE_THEMES || 'light,dark').split(',');
const ONLY = process.env.SMOKE_ONLY ? process.env.SMOKE_ONLY.split(',') : null;
const FEATURES = process.env.SMOKE_FEATURES ? process.env.SMOKE_FEATURES.split(',') : null;
if (!existsSync(join(EXT, 'manifest.json'))) { console.error('dist/ 不存在，先 pnpm run build'); process.exit(2); }
mkdirSync(OUT, { recursive: true });

const R = "document.getElementById('margin-root')?.shadowRoot";
/** 每个页面：地址 + 在页面里求值、返回缺失项列表的检查 */
const PAGES = [
  ['home', 'https://www.bilibili.com/', `(() => { const r = ${R}; if (!r) return ['#margin-root'];
    const miss = []; if (r.querySelectorAll('.grid .card').length < 4) miss.push('.grid .card ×4');
    for (const s of ['header', '.fp-card .fp-cells', '.hero-search, .hs', '.dash']) if (!r.querySelector(s)) miss.push(s);
    // 发布时间的绝对时间要单独一行显示
    const dates = [...r.querySelectorAll('.grid .card .pubtime')].map((e) => e.textContent.trim())
      .filter((t) => t.length === 19 && t[4] === '-' && t[10] === ' ' && t[13] === ':' && t[16] === ':');
    if (dates.length < 4) miss.push('card publish time missing');
    return miss; })()`],
  ['watch', 'https://www.bilibili.com/video/BV1mdxN68E7F/', `(() => { const miss = [];
    if (!document.documentElement.classList.contains('margin-watch')) miss.push('html.margin-watch');
    if (!document.getElementById('margin-watch-css')) miss.push('#margin-watch-css');
    const t = document.getElementById('margin-watch-top')?.shadowRoot; if (!t || !t.querySelector('header')) miss.push('#margin-watch-top header');
    return miss; })()`],
  ['search', 'https://search.bilibili.com/all?keyword=%E6%98%A0%E9%97%B4', `(() => {
    const miss = []; if (!document.documentElement.classList.contains('margin-search')) miss.push('html.margin-search');
    if (!document.getElementById('margin-watch-top')) miss.push('#margin-watch-top'); return miss; })()`],
  ['space', 'https://space.bilibili.com/2/video', `(() => { const r = ${R}; if (!r) return ['#margin-root'];
    const miss = []; if (!r.querySelector('main.tk')) miss.push('main.tk'); if (!r.querySelector('header')) miss.push('header'); return miss; })()`],
  ['message', 'https://message.bilibili.com/', `(() => { const r = ${R}; if (!r) return ['#margin-root'];
    const miss = []; if (!r.querySelector('main.tk')) miss.push('main.tk'); return miss; })()`],
  ['history', 'https://www.bilibili.com/account/history', `(() => { const r = ${R}; if (!r) return ['#margin-root'];
    const miss = []; if (!r.querySelector('main.tk')) miss.push('main.tk');
    const rows = [...r.querySelectorAll('.hi-row:not(.sk)')].map((e) => e.getBoundingClientRect());
    if (rows.length < 3) miss.push('.hi-row ×3');
    // v0.31.1 回归：条目曾因和首页搜索的 .hs-row 同名被压成 54px 高、互相重叠
    for (let i = 1; i < rows.length; i++) if (rows[i].top < rows[i - 1].bottom - 1) { miss.push('.hi-row ' + i + ' overlaps previous'); break; }
    return miss; })()`],
  ['opus', 'https://www.bilibili.com/opus/1005142803949289489', `(() => { const miss = []; const de = document.documentElement;
    if (de.dataset.marginDetail !== 'opus') miss.push('html[data-margin-detail=opus]');
    const a = document.getElementById('margin-aside'); const r = a?.shadowRoot; if (!r) return [...miss, '#margin-aside'];
    if (a.hidden) miss.push('#margin-aside hidden at 1440');
    if (!r.querySelector('.author .who b')?.textContent?.trim()) miss.push('.author name');
    if (r.querySelectorAll('.toc a').length < 3) miss.push('.toc ×3');
    if (r.querySelectorAll('.acts .act:not([hidden])').length < 5) miss.push('.acts ×5');
    // 侧栏和正文不能重叠
    const m = document.querySelector('.opus-detail')?.getBoundingClientRect(), s = a.getBoundingClientRect();
    if (m && s.left < m.right + 40) miss.push('aside overlaps article');
    return miss; })()`],
  ['feed', 'https://t.bilibili.com/', `(() => { const r = ${R}; if (!r) return ['#margin-root'];
    const miss = []; if (!r.querySelector('main.tk')) miss.push('main.tk'); return miss; })()`],
  ['compose', 'https://t.bilibili.com/?compose=1', `(() => { const miss = [];
    if (!document.documentElement.classList.contains('margin-compose')) miss.push('html.margin-compose');
    if (!document.querySelector('.bili-dyn-publishing')) miss.push('full composer');
    if (!document.getElementById('margin-watch-top')?.shadowRoot?.querySelector('header')) miss.push('#margin-watch-top header');
    return miss; })()`],
].filter(([n]) => !ONLY || ONLY.includes(n));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let failed = 0;

for (const theme of THEMES) {
  const dir = mkdtempSync(join(tmpdir(), 'margin-smoke-'));
  const exe = process.env.SMOKE_BUNDLED ? undefined : process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  const ctx = await chromium.launchPersistentContext(dir, {
    ...(exe ? { executablePath: exe } : { channel: 'chromium' }),
    headless: true,
    args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--autoplay-policy=no-user-gesture-required'],
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    colorScheme: theme,
  });
  let mockOverride = null;
  await installMocks(ctx, (u) => mockOverride?.(u));
  await ctx.addInitScript(() => { try { sessionStorage.setItem('margin:intro-played', '1'); } catch { /* */ } });
  let sw = ctx.serviceWorkers()[0];
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 10_000 }).catch(() => null);

  const page = ctx.pages()[0] ?? await ctx.newPage();
  let requests = [];
  page.on('request', (r) => requests.push(r.url()));
  const cdp = await ctx.newCDPSession(page);
  const worlds = new Map();
  cdp.on('Runtime.executionContextCreated',({context})=>worlds.set(context.id,context));
  cdp.on('Runtime.executionContextDestroyed',({executionContextId})=>worlds.delete(executionContextId));
  cdp.on('Runtime.executionContextsCleared',()=>worlds.clear());
  await cdp.send('Runtime.enable');
  let errors = [];
  const fromExt = (s) => /chrome-extension:\/\/|\[MARGIN\]/.test(s);
  cdp.on('Runtime.exceptionThrown', (e) => {
    const d = e.exceptionDetails; const text = `${d.exception?.description || d.text} @ ${d.url || ''}`;
    if (fromExt(text) || fromExt(JSON.stringify(d.stackTrace || ''))) errors.push(text.slice(0, 400));
  });
  page.on('console', (m) => { if (m.type() === 'error' && fromExt(m.text() + (m.location()?.url || ''))) errors.push(m.text().slice(0, 400)); });

  for (const [name, url, check] of PAGES) {
    errors = [];
    const t0 = Date.now();
    let miss = ['(未执行)'];
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      for (let i = 0; i < 40; i++) {
        miss = await page.evaluate(check).catch((e) => [`evaluate: ${e.message}`]);
        if (!miss.length) break;
        await sleep(250);
      }
      await sleep(2500);
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(OUT, `${name}-${theme}.png`), Buffer.from(shot.data, 'base64'));
    } catch (e) { miss = [`goto: ${e.message}`]; }
    const ok = !miss.length && !errors.length;
    if (!ok) failed++;
    results.push({ theme, name, ok, ms: Date.now() - t0, miss, errors });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${theme.padEnd(5)} ${name.padEnd(8)} ${Date.now() - t0}ms${miss.length ? ` missing: ${miss.join(', ')}` : ''}${errors.length ? `\n      errors: ${errors.join('\n              ')}` : ''}`);
  }

  // v0.47 新功能：设置种子都通过 service worker 写入 chrome.storage.local
  if (theme === THEMES[0] && sw) {
    const HOME = 'https://www.bilibili.com/';
    const WATCH = 'https://www.bilibili.com/video/BV1mdxN68E7F/';
    const SEARCH = 'https://search.bilibili.com/all?keyword=%E6%98%A0%E9%97%B4';
    const POPULAR = 'https://www.bilibili.com/v/popular/all';
    const MESSAGE = 'https://message.bilibili.com/';
    const seed = async (patch) => {
      await sw.evaluate(async (p) => {
        const cur = (await chrome.storage.local.get('margin:settings'))['margin:settings'] ?? {};
        await chrome.storage.local.set({ 'margin:settings': { ...cur, searchStyle: 'new', ...p } });
      }, patch);
    };
    const reset = async () => {
      await sw.evaluate(async () => { await chrome.storage.local.remove('margin:settings'); });
    };
    const feature = async (name, fn) => {
      if (FEATURES && !FEATURES.includes(name)) return;
      const t0 = Date.now();
      let miss = [];
      try { miss = await fn(); } catch (e) { miss = [e.message]; } finally { mockOverride = null; }
      const ok = !miss.length;
      if (!ok) failed++;
      results.push({ theme, name, ok, miss, ms: Date.now() - t0 });
      console.log(`${ok ? 'PASS' : 'FAIL'} ${theme.padEnd(5)} ${name.padEnd(18)} ${Date.now() - t0}ms${miss.length ? ` problems: ${miss.join(', ')}` : ''}`);
    };
    const filterOff = { keywords: [], ups: [], minViews: 0, minDuration: 0 };

    await feature('native-page-title', async () => {
      const expected = '哔哩哔哩 (゜-゜)つロ 干杯~-bilibili';
      const miss = [];
      for (const [name, url] of [['feed', 'https://t.bilibili.com/'], ['history', 'https://www.bilibili.com/account/history'], ['space', 'https://space.bilibili.com/2/video']]) {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.getElementById('margin-root')?.shadowRoot?.querySelector('main.tk'), null, { timeout: 15_000 });
        if (name === 'space') await page.waitForFunction(() => document.getElementById('margin-root')?.shadowRoot?.querySelector('.sp-id:not(.sk-id)'), null, { timeout: 15_000 });
        const title = await page.title();
        if (title !== expected) miss.push(`${name}: ${title}`);
      }
      return miss;
    });

    await feature('background-active',async()=>{
      await reset();await seed({intro:false,reduceMotion:false,wide:false,autoWeb:false,bg:{mode:'fixed',shader:'silk',intensity:.6}});
      // 仅在此用例强制走现有 GL 测试路径，避免软件渲染保护使动态分支不被执行；不作硬件 FPS 声明。
      await ctx.addInitScript(()=>{try{if(location.search.includes('margin-motion-test'))localStorage.setItem('margin:force-gl','1');else localStorage.removeItem('margin:force-gl');}catch{}});
      const samples=[],miss=[];
      for(const [kind,url] of [['home',HOME],['space','https://space.bilibili.com/2/video'],['watch',WATCH]]){
        await page.goto(url+'?margin-motion-test',{waitUntil:'domcontentloaded'});await page.locator('#margin-root .top,#margin-watch-top .top').first().waitFor();
        const world=[...worlds.values()].find(w=>w.origin===sw.url().split('/').slice(0,3).join('/'));
        if(!world)throw new Error('extension execution context missing');
        const evaluate=async(expression)=>(await cdp.send('Runtime.evaluate',{contextId:world.id,expression,returnByValue:true,awaitPromise:true})).result.value;
        await evaluate(`(()=>{window.marginBgDraws=0;const draw=WebGLRenderingContext.prototype.drawArrays;WebGLRenderingContext.prototype.drawArrays=function(...args){if(this.canvas.parentElement?.classList.contains('bg'))window.marginBgDraws++;return draw.apply(this,args);};})()`);
        const count=()=>evaluate('window.marginBgDraws');
        let before=await count();await sleep(600);const idle=(await count())-before;
        if(idle<2)miss.push(`${kind}: active GL baseline missing (${idle})`);
        await page.evaluate(()=>{const app=document.querySelector('#margin-root,#margin-watch-top').shadowRoot.querySelector('.app');window.marginMotionScroll=setInterval(()=>{app.scrollTop+=3;window.scrollBy(0,3);window.dispatchEvent(new Event('scroll'));},20);});
        await sleep(120);before=await count();await sleep(350);
        const scrolling=(await count())-before;await page.evaluate(()=>clearInterval(window.marginMotionScroll));
        if(scrolling<2)miss.push(`${kind}: visible background stopped during scrolling (${scrolling})`);
        await sleep(220);await page.locator('#margin-root .top [aria-label="设置"],#margin-watch-top .top [aria-label="设置"]').click();await sleep(350);
        before=await count();await sleep(500);const sheet=(await count())-before;if(sheet<2)miss.push(`${kind}: drawer stopped visible background (${sheet})`);
        await page.locator('.sheet[aria-label="设置"] .sheet-x').click();await sleep(220);
        let playing=null;
        if(kind==='watch'){
          const wav=Buffer.alloc(44+8000*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
          await page.locator('video').evaluate(async(v,src)=>{v.muted=true;v.loop=true;v.src=src;await v.play();},'data:audio/wav;base64,'+wav.toString('base64'));await sleep(200);
          before=await count();await sleep(500);playing=(await count())-before;if(playing<2)miss.push(`watch: media playback stopped visible background (${playing})`);
          await page.locator('video').evaluate(v=>v.pause());
        }
        samples.push({kind,idle,scrolling,sheet,playing});
      }
      writeFileSync(join(OUT,'background-activity.json'),JSON.stringify({mode:'forced GL test path, not physical GPU FPS',samples},null,2));return miss;
    });

    await feature('home-classic-layout', async () => {
      await reset(); await page.goto(HOME, { waitUntil:'domcontentloaded' });
      await page.locator('#margin-root .main .hero-search').waitFor();
      const style = await page.locator('#margin-root .main .hero-search').evaluate((el) => {
        const c = getComputedStyle(el), input = getComputedStyle(el.querySelector('.hs-input')), button = getComputedStyle(el.querySelector('.hs-btn'));
        return { radius:c.borderRadius,height:c.height,font:input.fontFamily,buttonRadius:button.borderRadius };
      });
      const miss = [];
      if (style.radius !== '28px' || style.height !== '56px' || !style.font.includes('Instrument Serif') || style.buttonRadius !== '999px') miss.push(`classic search changed: ${JSON.stringify(style)}`);
      if (await page.locator('#margin-root .q-side,#margin-root .watch-theme').count()) miss.push('home inherited watch navigation/theme');
      if (!await page.locator('#margin-root .top .ts').count()) miss.push('classic theme switch missing');
      await page.screenshot({path:join(OUT,'home-classic.png')});return miss;
    });

    await feature('search-morph', async () => {
      await reset(); await seed({ intro: false, homeHide: ['search'], bg: { mode: 'off' } });
      await page.goto(HOME, { waitUntil: 'domcontentloaded' });
      const box = page.locator('#margin-root .top .search');
      await box.waitFor();
      const miss = [];
      const before = await box.boundingBox();
      if (!before) return ['header search has no bounds'];
      const cp = page.locator('#margin-root .cp');
      await box.click();
      const immediate = await box.evaluate((e) => getComputedStyle(e).opacity);
      if (immediate !== '0') miss.push(`origin search box not hidden immediately after click: ${immediate}`);
      if (!await cp.evaluate((e) => e.classList.contains('cp-clipping'))) miss.push('morph clipping not active after click');
      await cp.waitFor();
      await sleep(120);
      if (await page.locator('#margin-root .cp-panel').evaluate((e) => getComputedStyle(e).opacity) !== '1') miss.push('panel content hidden during expansion');
      const k = await cp.evaluate((e) => e.style.getPropertyValue('--cp-k'));
      if (k !== '1') miss.push(`default speed factor should be 1, got ${k}`);
      await sleep(700);
      if (await cp.evaluate((e) => e.classList.contains('cp-clipping'))) miss.push('morph clipping left on after expansion');
      const hidden = await box.evaluate((e) => getComputedStyle(e).opacity);
      if (hidden !== '0') miss.push(`origin search box still visible after expansion: ${hidden}`);
      const after = await page.locator('#margin-root .cp-panel').boundingBox();
      if (!after) miss.push('panel has no bounds');
      else if (after.width <= before.width || after.height < before.height * 3) miss.push(`panel did not expand from search box (${before.width}×${before.height} → ${after.width}×${after.height})`);
      await page.screenshot({ path: join(OUT, 'search-morph.png') });
      await page.keyboard.press('Escape');
      await sleep(500);
      if (await cp.isVisible()) miss.push('palette still visible after Esc');
      if (await box.evaluate((e) => getComputedStyle(e).opacity) !== '1') miss.push('origin search box not restored after close');
      // 速度设置：200% 表示动画时长减半（系数 0.5）
      await seed({ paletteSpeed: 200 }); await sleep(200);
      await box.click();
      await cp.waitFor();
      const fast = await cp.evaluate((e) => e.style.getPropertyValue('--cp-k'));
      if (fast !== '0.5') miss.push(`paletteSpeed 200 should halve duration, got ${fast}`);
      // 展开途中关闭：应从当前大小反向收回，而不是跳回全尺寸再淡出
      await sleep(80);
      await page.keyboard.press('Escape');
      if (!await cp.evaluate((e) => e.classList.contains('cp-clipping'))) miss.push('closing during expansion skipped the reverse animation');
      await sleep(400);
      if (await cp.isVisible()) miss.push('palette still visible after interrupted close');
      if (await box.evaluate((e) => getComputedStyle(e).opacity) !== '1') miss.push('origin not restored after interrupted close');
      // 减少动画时直接显示面板，不再走形变外壳
      await seed({ reduceMotion: true, paletteSpeed: 100 }); await sleep(300);
      await box.click();
      await cp.waitFor();
      if (await cp.evaluate((e) => e.classList.contains('cp-clipping'))) miss.push('reduced motion still morphs');
      await page.keyboard.press('Escape'); await sleep(300);
      await seed({ reduceMotion: false });
      return miss;
    });

    await feature('appearance-settings',async () => {
      await reset();await page.goto(HOME,{waitUntil:'domcontentloaded'});await page.locator('#margin-root .main .hero-search').waitFor();await sleep(500);
      const miss=[];
      const maps=()=>page.locator('#margin-root filter[id^="lg-"] feImage[href^="blob:"]').count();
      if(await maps())miss.push('default soft mode generated refraction maps');
      await page.locator('#margin-root .top [aria-label="设置"]').click();
      const panel=page.locator('#margin-root .sheet[aria-label="设置"]');
      const speed=panel.getByLabel('搜索框展开速度（%）');
      if(await speed.count()!==1)miss.push('palette speed setting missing');
      else { await speed.fill('999');await speed.press('Enter');if(await speed.inputValue()!=='200')miss.push(`palette speed not clamped: ${await speed.inputValue()}`);await speed.fill('100');await speed.press('Enter'); }
      await panel.getByRole('radio',{name:'哔哩蓝',exact:true}).click();
      await page.waitForFunction(()=>getComputedStyle(document.getElementById('margin-root').shadowRoot.querySelector('.upload')).backgroundColor==='rgb(0, 125, 168)');
      if(await page.locator('#margin-root .main .hs-btn').evaluate(e=>getComputedStyle(e).backgroundColor)!=='rgb(0, 125, 168)')miss.push('search CTA did not follow accent');
      if(await page.locator('#margin-root .main .hero-search').evaluate(e=>getComputedStyle(e).borderRadius)!=='28px')miss.push('accent changed classic search shape');
      await panel.getByRole('radio',{name:'液态折射',exact:true}).click();
      await page.waitForFunction(()=>document.getElementById('margin-root').shadowRoot.querySelector('.et').style.backdropFilter.includes('url('));
      if(!await maps())miss.push('liquid selection did not enable refraction');
      await panel.getByRole('radio',{name:'柔和磨砂',exact:true}).click();
      await page.waitForFunction(()=>!document.getElementById('margin-root').shadowRoot.querySelector('.et').style.backdropFilter.includes('url('));
      await sleep(500);
      if(await page.locator('#margin-root .et').evaluate(e=>getComputedStyle(e).backdropFilter).then(s=>s.includes('url(')))miss.push('stale refraction restored after switching off');
      await panel.getByRole('radio',{name:'哔哩粉',exact:true}).click();await sleep(200);
      await panel.locator('.sheet-x').click();await sleep(300);
      await page.screenshot({path:join(OUT,'appearance-home-pink.png')});
      for(const url of [WATCH,SEARCH,'https://space.bilibili.com/2/video',MESSAGE,'https://t.bilibili.com/','https://www.bilibili.com/account/history']) {
        await page.goto(url,{waitUntil:'domcontentloaded'});const button=page.locator('#margin-root .upload,#margin-watch-top .upload').first();await button.waitFor();
        if(await button.evaluate(e=>getComputedStyle(e).backgroundColor)!=='rgb(185, 47, 100)')miss.push(`${url}: header CTA accent mismatch`);
        if(url===WATCH){await page.evaluate(()=>{const b=document.createElement('button');b.className='follow-btn-inner';b.textContent='关注';document.body.append(b);});if(await page.locator('.follow-btn-inner').evaluate(e=>getComputedStyle(e).backgroundColor)!=='rgb(185, 47, 100)')miss.push('native follow CTA accent mismatch');}
        if(url.includes('space.bilibili')){await page.locator('#margin-root .sp-follow').waitFor();if(await page.locator('#margin-root .sp-follow').evaluate(e=>getComputedStyle(e).backgroundColor)!=='rgb(185, 47, 100)')miss.push('space follow CTA accent mismatch');}
      }
      await seed({accent:'classic',glass:'soft'});await page.goto(HOME,{waitUntil:'domcontentloaded'});await page.locator('#margin-root .main .hero-search').waitFor();
      if(await page.evaluate(()=>document.documentElement.style.getPropertyValue('--margin-primary')))miss.push('classic mode retained custom color');
      return miss;
    });

    await feature('favorite-columns-and-order', async () => {
      await reset();await page.setViewportSize({width:1440,height:1000});await page.goto(HOME,{waitUntil:'domcontentloaded'});
      const root='#margin-root',miss=[];
      await page.locator(`${root} .top [aria-label="设置"]`).click();
      await page.locator(`${root} .sd-head`).filter({hasText:'布局与细节'}).click();
      const cols=page.locator(`${root} .row`).filter({has:page.locator('.row-label>span',{hasText:'收藏夹列数'})});
      await cols.getByRole('radio',{name:'4 列',exact:true}).click();
      await page.locator(`${root} .sd-head`).filter({has:page.locator('.sd-t',{hasText:'顶栏入口'})}).click();
      const move=page.locator(`${root} [aria-label="收藏上移"]`);await move.click();await sleep(200);
      const arranged=await page.locator(`${root} .top [aria-label="收藏"]`).evaluate(e=>Number(e.style.order));
      if(arranged!==6)miss.push(`personal entry did not move before creator: ${arranged}`);
      if(!await move.evaluate(e=>e.getRootNode().activeElement===e))miss.push('reorder discarded keyboard focus');
      await page.locator(`${root} .sheet[aria-label="设置"] .sheet-x`).click();await sleep(300);
      await page.locator(`${root} .top [aria-label="收藏"]`).click();await page.locator(`${root} .gf-root`).first().waitFor();await sleep(800);
      const shelf=page.locator(`${root} .shelf`);
      if(await shelf.evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length)!==4)miss.push('columns UI setting not applied');
      for(const n of [2,3,4]){
        await seed({favColumns:n});await sleep(250);
        const r=await shelf.evaluate(e=>({columns:getComputedStyle(e).gridTemplateColumns.split(' ').length,right:e.getBoundingClientRect().right,folders:[...e.querySelectorAll('.gf-root')].map(n=>n.getBoundingClientRect().toJSON())}));
        if(r.columns!==n||r.folders.some(f=>f.right>r.right+1))miss.push(`${n} columns overflow: ${JSON.stringify(r)}`);
      }
      const folder=page.locator(`${root} .gf-root`).first();await folder.locator('.gf-hit').hover();await sleep(400);
      if(await folder.evaluate(e=>getComputedStyle(e).getPropertyValue('--gf-lift').trim())!=='-96px')miss.push('hover did not use full expansion');
      await folder.locator('.gf-key--more').click();
      if(!await page.getByRole('menuitem',{name:'查看全部视频',exact:true}).isVisible())miss.push('plain-dot menu unavailable');
      await page.keyboard.press('Escape');await folder.locator('.gf-hit').click();await page.locator(`${root} .fav-grid .card`).first().waitFor();
      if(await folder.getAttribute('data-open')!==null)miss.push('new default still requires extra folder expansion');
      await page.screenshot({path:join(OUT,'favorites-columns.png')});await page.keyboard.press('Escape');await page.setViewportSize({width:1440,height:900});return miss;
    });

    await feature('watch-comments-layout', async () => {
      await reset();await seed({watchComments:'side',commentInput:'comfortable'});
      await page.setViewportSize({width:1440,height:1000});await page.goto(WATCH,{waitUntil:'domcontentloaded'});
      await page.locator('#margin-watch-top .ts').waitFor();
      await page.evaluate(() => {
        const css=document.createElement('style');css.textContent='.video-container-v1{display:flex;width:1380px;margin:auto;gap:30px}.left-container{width:1000px}.right-container{width:350px;flex:none}#danmukuBox{height:40px}';document.head.append(css);
        const up=document.createElement('div');up.className='up-panel-container';up.style.height='100px';document.querySelector('.right-container').prepend(up);
        const pod=document.createElement('div');pod.className='video-pod';pod.style.height='120px';document.querySelector('.right-container').append(pod);
        const comment=document.querySelector('#commentapp');comment.innerHTML='<textarea aria-label="测试草稿"></textarea><div style="height:800px">原生评论内容</div>';window.marginCommentIdentity=comment;
        const bc=document.createElement('bili-comments'),sr=bc.attachShadow({mode:'open'});
        const header=document.createElement('bili-comments-header-renderer');header.attachShadow({mode:'open'}).innerHTML='<div id="title"><h2>评论</h2></div>';
        const box=document.createElement('bili-comment-box');box.attachShadow({mode:'open'}).innerHTML='<style>#editor{min-height:40px}</style><div id="editor">输入框</div>';
        sr.append(header,box);comment.prepend(bc);
      });
      await page.locator('#commentapp textarea').fill('保留草稿');await sleep(1100);const miss=[];
      const check=async(label)=>{
        const r=await page.evaluate(()=>{
          const c=document.querySelector('#commentapp'),r=document.querySelector('.recommend-list-v1');
          const h=c.querySelector('bili-comments').shadowRoot.querySelector('bili-comments-header-renderer').shadowRoot.querySelector('h2');
          const e=c.querySelector('bili-comments').shadowRoot.querySelector('bili-comment-box').shadowRoot.querySelector('#editor');
          return{position:getComputedStyle(c).position,marker:document.documentElement.dataset.marginComments,ready:document.documentElement.hasAttribute('data-margin-comments-ready'),recommend:r&&getComputedStyle(r).display,font:getComputedStyle(h).fontFamily,input:getComputedStyle(e).minHeight,identity:window.marginCommentIdentity===c};
        });
        if(r.position==='fixed'||r.marker||r.ready)miss.push(`${label}: comments retained side layout`);
        if(r.recommend==='none')miss.push(`${label}: native recommendations hidden`);
        if(!r.font.includes('Margin Serif SC')||r.input!=='40px')miss.push(`${label}: classic comment typography/input not restored: ${JSON.stringify(r)}`);
        if(!r.identity||await page.locator('#commentapp textarea').inputValue()!=='保留草稿')miss.push(`${label}: native node/draft changed`);
      };
      await check('normal');
      if(await page.locator('#margin-watch-top .watch-theme').count())miss.push('compact theme retained');
      if(!await page.locator('h1.video-title').evaluate(e=>getComputedStyle(e).fontFamily.includes('Margin Sans SC')))miss.push('retained title UI changed');
      for(let i=0;i<2;i++){await page.locator('#margin-watch-top .ts').click();await sleep(400);await check('theme');}
      for(const mode of ['wide','normal']){await page.evaluate(mode=>document.querySelector('.bpx-player-container').dataset.screen=mode,mode);await sleep(300);await check(mode);}
      await page.setViewportSize({width:1024,height:900});await sleep(300);await check('narrow');
      await page.setViewportSize({width:1440,height:1000});await sleep(300);
      for(const selector of ['.up-panel-container','#danmukuBox','.video-pod'])if(await page.locator(selector).evaluate(e=>getComputedStyle(e).display)==='none')miss.push(`retained UI hidden: ${selector}`);
      await page.locator('#margin-watch-top .top [aria-label="设置"]').click();
      const labels=await page.locator('#margin-watch-top .row-label>span').allTextContents();
      if(labels.includes('评论位置')||labels.includes('评论输入区'))miss.push('withdrawn settings still exposed');
      await page.locator('#margin-watch-top .sheet[aria-label="设置"] .sheet-x').click();
      await page.screenshot({path:join(OUT,'watch-comments-classic.png')});await page.setViewportSize({width:1440,height:900});return miss;
    });

    await feature('messages-mark-all', async () => {
      await reset();let active=false,failLike=false;const reads=new Set();const remaining={reply:5,at:2,like:18,sys_msg:1,chat:3};
      mockOverride=(u)=>{
        const url=new URL(u),path=url.pathname;
        if(u.includes('msgfeed/unread'))return{code:0,data:remaining};
        if(u.includes('single_unread'))return{code:0,data:{follow_unread:remaining.chat,unfollow_unread:0}};
        if(u.includes('get_sessions'))return{code:0,data:{has_more:false,session_list:[{talker_id:123,session_type:1,unread_count:remaining.chat,max_seqno:10,session_ts:100,account_info:{name:'测试会话'}}]}};
        if(u.includes('query_user_notify')||u.includes('query_unified_notify'))return{code:0,data:{system_notify_list:[{id:1,cursor:'9007199254740995',time_at:'2026-11-01 10:00:00',content:'测试通知'}]}};
        if(active){
          for(const key of ['reply','at','like'])if(path===`/x/msgfeed/${key}`){reads.add(key);if(failLike&&key==='like')return{code:-1,message:'unavailable'};remaining[key]=0;}
          if(u.includes('update_ack')){remaining.chat=0;reads.add('chat');return{code:0};}
          if(u.includes('update_cursor')){remaining.sys_msg=0;reads.add('system');return{code:0};}
        }
      };
      await page.goto(MESSAGE+'#/whisper',{waitUntil:'domcontentloaded'});
      await page.locator('#margin-root .wh-s').first().click();
      const input=page.locator('#margin-root .wh-input');await input.waitFor();await input.fill('未发送的私信草稿');
      const button=page.locator('#margin-root [aria-label="将所有消息标为已读"]');await button.waitFor();active=true;await button.click();
      await page.waitForFunction(()=>document.getElementById('margin-root')?.shadowRoot?.querySelector('.toast')?.textContent.includes('消息已全部标为已读'));
      const miss=[];
      if(reads.size!==5)miss.push(`not all categories handled: ${[...reads]}`);
      if(await input.inputValue()!=='未发送的私信草稿')miss.push('read all discarded chat draft');
      if(await page.locator('#margin-root .wh-dot').count())miss.push('confirmed read sessions retain dots');
      remaining.like=3;failLike=true;await button.click();
      await page.waitForFunction(()=>document.getElementById('margin-root')?.shadowRoot?.querySelector('.toast')?.textContent.includes('未能全部完成'));
      if(await page.locator('#margin-root [data-view="like"] .ms-n').textContent()!=='3')miss.push('failed category unread was cleared');
      if(await input.inputValue()!=='未发送的私信草稿')miss.push('failure discarded chat draft');
      await page.screenshot({path:join(OUT,'messages-readall-partial.png')});return miss;
    });

    await feature('header-unread-return', async () => {
      await reset();
      let unread = 4, calls = 0;
      mockOverride = (u) => {
        if (u.includes('msgfeed/unread')) { calls++; return { code: 0, data: { reply: unread, at: 0, like: 0, sys_msg: 0 } }; }
        if (u.includes('single_unread')) return { code: 0, data: { follow_unread: 0, unfollow_unread: 0 } };
      };
      await page.goto(HOME, { waitUntil: 'domcontentloaded' });
      const badge = page.locator('#margin-root [aria-label^="消息"] .et-badge');
      await page.waitForFunction(() => document.getElementById('margin-root')?.shadowRoot?.querySelector('[aria-label^="消息"] .et-badge')?.textContent === '4');
      unread = 0; await sleep(800);
      const before = calls;
      await page.evaluate(() => { dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
      await page.waitForFunction(() => !document.getElementById('margin-root')?.shadowRoot?.querySelector('[aria-label^="消息"] .et-badge'), null, { timeout: 2500 }).catch(() => {});
      const miss = [];
      if (await badge.count()) miss.push(`read elsewhere but header still shows ${await badge.textContent()}`);
      if (calls <= before) miss.push('returning within 30 seconds did not refresh unread');
      if (calls - before > 1) miss.push('focus and visibility issued duplicate unread queries');
      return miss;
    });

    await feature('background-slider-work', async () => {
      await reset(); await seed({ bg: { mode: 'fixed', shader: 'silk', intensity: .6 } });
      await page.goto(HOME, { waitUntil: 'domcontentloaded' });
      await page.locator('#margin-root .top [aria-label="设置"]').click();
      await page.locator('#margin-root .sd-head').filter({ hasText: '强度与自定义图片' }).click();
      const range = page.locator('#margin-root [aria-label="背景强度"]'); await range.waitFor();
      await sleep(600);
      await sw.evaluate(() => {
        globalThis.marginSliderChanges = 0;
        globalThis.marginSliderListener = (changes) => { if (changes['margin:settings']) globalThis.marginSliderChanges++; };
        chrome.storage.onChanged.addListener(globalThis.marginSliderListener);
      });
      const miss = [];
      try {
        const preview = await range.evaluate((input) => {
          for (let n = 1; n <= 80; n++) { input.value = String(n); input.dispatchEvent(new Event('input', { bubbles: true })); }
          return document.getElementById('margin-root').shadowRoot.querySelector('.bg').style.getPropertyValue('--bg-o');
        });
        if (Number(preview) !== .8) miss.push(`drag preview waits for persistence: ${preview}`);
        await sleep(600);
        const during = await sw.evaluate(() => globalThis.marginSliderChanges);
        if (during !== 0) miss.push(`${during} full settings updates during 80 drag input events`);
        await range.dispatchEvent('change'); await sleep(500);
        const result = await sw.evaluate(async () => ({ count: globalThis.marginSliderChanges, value: (await chrome.storage.local.get('margin:settings'))['margin:settings']?.bg?.intensity }));
        if (result.count !== 1 || result.value !== .8) miss.push(`release did not commit once: ${JSON.stringify(result)}`);
      } finally {
        await sw.evaluate(() => { chrome.storage.onChanged.removeListener(globalThis.marginSliderListener); delete globalThis.marginSliderListener; });
      }
      return miss;
    });

    await feature('space-info-slow-stats', async () => {
      await reset();
      let release; const hold = new Promise((r) => { release = r; });
      mockOverride = async (u) => {
        if (/\/x\/(relation\/stat|space\/(upstat|navnum))\?/.test(u)) await hold;
      };
      const miss = [];
      let focus = null;
      try {
        await page.goto('https://space.bilibili.com/2/video', { waitUntil: 'domcontentloaded' });
        await page.locator('#margin-root .sp-hero').waitFor();
        await page.locator('#margin-root .sp-hero h1').waitFor({ timeout: 2000 }).catch(() => miss.push('primary profile waits for unrelated slow statistics'));
        if (!(await page.locator('#margin-root .grid .card:not(.sk)').count())) miss.push('video list not rendered while statistics pending');
        if (!miss.length) {
          const follow = page.locator('#margin-root .sp-hero .sp-follow'); await follow.focus(); focus = await follow.elementHandle();
          const values = await page.locator('#margin-root .sp-stats b').allTextContents();
          if (values.some((x) => x !== '—')) miss.push(`pending statistics displayed as known values: ${values}`);
        }
      } finally { release(); }
      await page.waitForFunction(() => [...(document.getElementById('margin-root')?.shadowRoot?.querySelectorAll('.sp-stats b') ?? [])].some((el) => el.textContent !== '—'));
      if (focus && !(await focus.evaluate((el) => el.isConnected && el.getRootNode().activeElement === el))) miss.push('late statistics replaced focused profile controls');
      return miss;
    });

    await feature('space-info-slow-banner', async () => {
      await reset();
      let release; const hold = new Promise((r) => { release = r; });
      mockOverride = async (u) => {
        if (u.includes('/x/space/wbi/acc/info')) {
          const body = apiBody(u); return { ...body, data: { ...body.data, top_photo: '', top_photo_v2: null } };
        }
        if (u.includes('/x/web-interface/card?') && new URL(u).searchParams.get('mid') === '2') await hold;
      };
      const miss = [];
      try {
        await page.goto('https://space.bilibili.com/2/video', { waitUntil: 'domcontentloaded' });
        await page.locator('#margin-root .sp-hero').waitFor();
        await page.locator('#margin-root .sp-hero h1').waitFor({ timeout: 2000 }).catch(() => miss.push('primary profile waits for optional banner fallback'));
      } finally { release(); }
      return miss;
    });

    await feature('account-link-hover', async () => {
      await reset(); await seed({ idDrag: true, bg: { mode: 'off' } });
      await page.goto(HOME, { waitUntil: 'domcontentloaded' });
      await page.locator('#margin-root .user.in').hover();
      const card = page.locator('#margin-root .idcl-card'); await card.waitFor(); await sleep(2500);
      await page.locator('#margin-root .idcl-name').click(); await sleep(1000);
      await page.locator('#margin-root .user.in').hover(); await sleep(500);
      const link = page.locator('#margin-root .idcl-back .idcl-connect-icons a').first();
      await link.evaluate((el) => {
        let start = null;
        window.marginLinkProbe = { grabbing: 0, frames: 0, shift: 0, movementAfterEntry: 0, cardTransform: null, flipperTransform: null };
        el.addEventListener('pointermove', () => {
          start = el.getBoundingClientRect().x;
          window.marginLinkProbe.cardTransform = el.closest('.idcl-card').style.transform;
          window.marginLinkProbe.flipperTransform = el.closest('.idcl-flipper').style.transform;
        }, { once: true });
        window.marginLinkTimer = setInterval(() => {
          if (start === null) return;
          const r = el.getBoundingClientRect(), p = window.marginLinkProbe;
          p.shift = Math.max(p.shift, Math.abs(r.x - start));
          if (/^grabb?/.test(getComputedStyle(el).cursor)) p.grabbing++;
          if (p.cardTransform !== null && (el.closest('.idcl-card').style.transform !== p.cardTransform || el.closest('.idcl-flipper').style.transform !== p.flipperTransform)) p.movementAfterEntry++;
          p.frames++;
        }, 16);
      });
      // 使用浏览器计算的内容四边形命中位置，避免 3D 外接矩形中心与实际链接错位。
      await link.hover({ force: true });
      await sleep(500);
      const state = await page.evaluate(() => { clearInterval(window.marginLinkTimer); return window.marginLinkProbe; });
      const miss = [];
      if (!state.frames) miss.push('pointer did not enter the interactive link');
      const shortcuts = await page.locator('#margin-root .idcl-back .idcl-connect').evaluate((row) => {
        const label = row.querySelector('span');
        const range = document.createRange();
        range.selectNodeContents(label);
        return { lines: range.getClientRects().length, overflow: row.scrollWidth > row.clientWidth + 1 };
      });
      if (shortcuts.lines !== 1) miss.push('quick entries label wrapped');
      if (shortcuts.overflow) miss.push('quick entries overflow their row');
      if (await page.locator('#margin-root .idcl-holo').count()) miss.push('holographic strip still rendered');
      await page.screenshot({ path: join(OUT, `id-card-back-${theme}.png`) });
      if (state.grabbing) miss.push(`interactive link inherited drag cursor in ${state.grabbing}/${state.frames} samples`);
      if (state.shift > 1) miss.push(`interactive link moves under pointer by ${state.shift.toFixed(2)}px`);
      if (state.movementAfterEntry) miss.push(`card position changed after entering its link in ${state.movementAfterEntry} samples`);
      return miss;
    });

    await feature('upload-visibility', async () => {
      await reset();
      const miss = [];
      for (const [name, url, host] of [
        ['home', HOME, 'margin-root'], ['watch', WATCH, 'margin-watch-top'], ['search', SEARCH, 'margin-watch-top'],
        ['space', 'https://space.bilibili.com/1/video', 'margin-root'], ['message', MESSAGE, 'margin-root'],
        ['feed', 'https://t.bilibili.com/', 'margin-root'], ['history', 'https://www.bilibili.com/history', 'margin-root'],
      ]) {
        await seed({ headHide: ['投稿'] });
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction((id) => document.getElementById(id)?.shadowRoot?.querySelector('.upload[hidden]'), host);
        const upload = page.locator(`#${host} .upload`);
        if (await upload.isVisible()) miss.push(`${name}: hidden upload remains visible`);
        await page.locator(`#${host} .top [aria-label="设置"]`).click();
        if (!(await page.locator(`#${host} [aria-label="顶栏显示投稿"]`).count())) miss.push(`${name}: upload option missing`);
        await page.locator(`#${host} .sheet-layer:has(.sheet[aria-label="设置"]) .sheet-x`).click();
        await seed({ headHide: [] });
        await upload.waitFor({ state: 'visible' });
        await seed({ headHide: ['投稿'] });
        await upload.waitFor({ state: 'hidden' });
      }
      return miss;
    });

    await feature('favorites-direct-pages', async () => {
      await reset();
      const miss = [];
      for (const [name, url, host, own] of [
        ['home', HOME, 'margin-root'], ['watch', WATCH, 'margin-watch-top'], ['search', SEARCH, 'margin-watch-top'],
        ['space-header', 'https://space.bilibili.com/1/video', 'margin-root'],
        ['space-self', 'https://space.bilibili.com/1/video', 'margin-root', true],
        ['space-favorites', 'https://space.bilibili.com/1/favlist', 'margin-root'],
        ['message', MESSAGE, 'margin-root'], ['native-space', 'https://space.bilibili.com/1/favlist?ftype=collect', 'margin-space-hooks'],
        ['feed', 'https://t.bilibili.com/', 'margin-root'], ['history', 'https://www.bilibili.com/history', 'margin-root'],
      ]) {
        await seed({ favDirect: true });
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        const settingsHost = name === 'native-space' ? 'margin-watch-top' : host;
        await page.locator(`#${settingsHost} .top [aria-label="设置"]`).click();
        await page.locator(`#${settingsHost} .sheet-layer:has(.sheet[aria-label="设置"]) .sheet-x`).click();
        if (name === 'native-space') {
          await page.waitForSelector('html.margin-space-native'); await sleep(300);
          await page.evaluate(() => { const a = document.createElement('a'); a.href = '#fav'; document.body.append(a); a.click(); a.remove(); });
        } else if (own) await page.locator(`#${host} .sp-tile`).filter({ hasText: '收藏夹' }).click();
        else await page.locator(`#${host} .et-btn[aria-label="收藏"]`).click();
        const sheet = page.locator(`#${host} .sheet-layer[data-open="true"]`);
        const folder = sheet.locator('.gf-hit').nth(1);
        await folder.waitFor(); await folder.click();
        await sleep(400);
        if (await folder.getAttribute('aria-expanded') !== 'false') miss.push(`${name}: direct mode still fans out`);
        if (!(await sheet.locator('.crumb').textContent()).includes('动效参考')) miss.push(`${name}: wrong folder opened`);
        await seed({ favDirect: false });
        await page.waitForFunction((id) => document.getElementById(id)?.shadowRoot?.querySelector('[aria-label="收藏夹直接展开"]')?.getAttribute('aria-checked') === 'false', settingsHost);
        await sheet.locator('.sheet-body').evaluate((el) => el.scrollTo({ top: 0 }));
        await folder.click();
        if (await folder.getAttribute('aria-expanded') !== 'true') miss.push(`${name}: setting change did not restore fan-out`);
      }
      return miss;
    });

    await feature('native-replies-collapse', async () => {
      await reset(); await seed({ replyTree: true });
      await page.goto(WATCH, { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => {
        const bc = document.createElement('bili-comments');
        const cr = bc.attachShadow({ mode: 'open' });
        const thread = document.createElement('bili-comment-thread-renderer'); cr.append(thread);
        const tr = thread.attachShadow({ mode: 'open' });
        const replies = document.createElement('bili-comment-replies-renderer'); tr.append(replies);
        const sr = replies.attachShadow({ mode: 'open' });
        const contents = document.createElement('div'); contents.id = 'expander-contents';
        for (let i = 0; i < 5; i++) {
          const reply = document.createElement('bili-comment-reply-renderer'); reply.textContent = `回复 ${i}`; contents.append(reply);
        }
        const input = document.createElement('textarea'); input.value = '保留草稿'; contents.append(input);
        const paging = document.createElement('button'); paging.textContent = '下一页';
        paging.onclick = () => { paging.dataset.clicked = 'true'; }; contents.append(paging);
        sr.append(contents); document.querySelector('#commentapp').append(bc);
        const old = document.createElement('div'); old.className = 'reply-item';
        const list = document.createElement('div'); list.className = 'sub-reply-list';
        for (let i = 0; i < 5; i++) {
          const reply = document.createElement('div'); reply.className = 'sub-reply-item';
          const name = document.createElement('b'); name.className = 'sub-user-name'; name.textContent = `用户${i}`;
          const text = document.createElement('span'); text.className = 'reply-content'; text.textContent = `内容${i}`;
          reply.append(name, text); list.append(reply);
        }
        old.append(list); document.querySelector('#commentapp').append(old);
      });
      const modern = page.locator('bili-comments .margin-replies-toggle');
      const legacy = page.locator('.reply-item .margin-replies-toggle');
      await modern.waitFor(); await legacy.waitFor();
      const miss = [];
      for (const [name, button, list] of [
        ['modern', modern, page.locator('bili-comments #expander-contents')],
        ['legacy', legacy, page.locator('.reply-item .sub-reply-list')],
      ]) {
        await button.click();
        if (await list.isVisible() || await button.getAttribute('aria-expanded') !== 'false') miss.push(`${name}: replies did not collapse`);
        await list.evaluate((el) => { const node = document.createElement('span'); node.textContent = '异步更新'; el.append(node); });
        await sleep(100);
        if (await list.isVisible()) miss.push(`${name}: async update reopened replies`);
        await button.click();
        if (!(await list.isVisible())) miss.push(`${name}: replies did not reopen`);
      }
      if (await page.locator('bili-comments textarea').inputValue() !== '保留草稿') miss.push('draft lost');
      await page.locator('bili-comments button').filter({ hasText: '下一页' }).click();
      if (await page.locator('bili-comments button[data-clicked="true"]').count() !== 1) miss.push('native pagination handler lost');
      return miss;
    });

    await feature('comment-loading-theme', async () => {
      await reset(); await seed({ theme: 'dark' });
      await page.goto(WATCH, { waitUntil: 'domcontentloaded' });
      await page.locator('#margin-watch-top header.top').waitFor();
      await page.evaluate(() => {
        const comments = document.createElement('bili-comments'); const outer = comments.attachShadow({ mode: 'open' });
        const replies = document.createElement('bili-comment-replies-renderer'); const root = replies.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        // B 站当前楼中楼加载层的实际背景规则（commentpc/bili-comments.js）。
        style.textContent = '#spinner{position:absolute;inset:0;background:rgba(var(--bg1_rgb,255,255,255),.85)}';
        const list = document.createElement('div'); list.id = 'expander-contents'; list.style.cssText = 'position:relative;height:100px';
        const spinner = document.createElement('div'); spinner.id = 'spinner'; spinner.textContent = '正在玩命加载…';
        list.append(spinner); root.append(style, list); outer.append(replies); document.querySelector('#commentapp').append(comments);
      });
      const miss = [], spinner = page.locator('bili-comments #spinner');
      for (const [theme, background] of [['dark', 'rgba(26, 26, 28, 0.85)'], ['light', 'rgba(255, 255, 255, 0.85)'], ['dark', 'rgba(26, 26, 28, 0.85)']]) {
        await seed({ theme });
        await page.waitForFunction((theme) => document.documentElement.dataset.marginTheme === theme, theme);
        const color = await spinner.evaluate((el) => getComputedStyle(el).backgroundColor);
        if (color !== background) miss.push(`${theme}: native loading mask ${color}, expected ${background}`);
      }
      return miss;
    });

    await feature('watch-author-alignment', async () => {
      await reset(); await page.goto(WATCH, { waitUntil: 'domcontentloaded' });
      await page.locator('#margin-watch-top header.top').waitFor();
      await page.evaluate(() => {
        document.querySelector('.video-container-v1').style.cssText = 'display:grid;grid-template-columns:900px 320px;align-items:start;gap:24px';
        const title = document.querySelector('.video-info-container'); title.style.cssText = 'min-height:80px';
        const panel = document.createElement('div'); panel.className = 'up-panel-container'; panel.textContent = 'UP 主卡片';
        document.querySelector('.right-container').prepend(panel);
      });
      const miss = [];
      for (const height of [80, 140]) {
        await page.locator('.video-info-container').evaluate((el, h) => { el.style.minHeight = `${h}px`; }, height);
        await page.waitForFunction(() => Math.abs(document.querySelector('.up-panel-container').getBoundingClientRect().top - document.querySelector('.bpx-player-container').getBoundingClientRect().top) <= 1, null, { timeout: 3000 }).catch(() => {});
        const delta = await page.evaluate(() => document.querySelector('.up-panel-container').getBoundingClientRect().top - document.querySelector('.bpx-player-container').getBoundingClientRect().top);
        if (Math.abs(delta) > 1) miss.push(`title ${height}px: author panel differs from player top by ${delta}px`);
      }
      await page.locator('.bpx-player-container').evaluate((el) => { el.dataset.screen = 'wide'; });
      await page.waitForFunction(() => document.documentElement.classList.contains('margin-wide'));
      await page.locator('.bpx-player-container').evaluate((el) => { el.dataset.screen = 'normal'; });
      await page.waitForFunction(() => !document.documentElement.classList.contains('margin-wide'));
      await sleep(200);
      const delta = await page.evaluate(() => document.querySelector('.up-panel-container').getBoundingClientRect().top - document.querySelector('.bpx-player-container').getBoundingClientRect().top);
      if (Math.abs(delta) > 1) miss.push(`leaving wide mode lost author alignment by ${delta}px`);
      // 小窗改变播放器的屏幕位置，侧栏仍应留在文档原位。
      await page.evaluate(() => {
        const player=document.querySelector('.bpx-player-container');
        const wrap=document.createElement('div');wrap.id='playerWrap';wrap.style.height=`${player.getBoundingClientRect().height}px`;
        player.before(wrap);wrap.append(player);
        window.marginAuthorBefore={pad:getComputedStyle(document.querySelector('.right-container')).paddingTop,top:document.querySelector('.up-panel-container').getBoundingClientRect().top+scrollY};
        player.style.cssText='position:fixed;right:16px;bottom:16px;width:360px;height:200px;background:#000;z-index:10';
      });await sleep(350);
      const mini=await page.evaluate(()=>({before:window.marginAuthorBefore,pad:getComputedStyle(document.querySelector('.right-container')).paddingTop,top:document.querySelector('.up-panel-container').getBoundingClientRect().top+scrollY}));
      if(mini.pad!==mini.before.pad||Math.abs(mini.top-mini.before.top)>1)miss.push(`author followed floating player: ${JSON.stringify(mini)}`);
      await page.evaluate(()=>scrollTo(0,400));await sleep(250);
      const shifted=await page.locator('.up-panel-container').evaluate(e=>e.getBoundingClientRect().top+scrollY);
      if(Math.abs(shifted-mini.before.top)>1)miss.push(`author shifted within document while scrolling: ${shifted}`);
      return miss;
    });

    await feature('space-action-inset', async () => {
      await reset();
      const miss = [], samples = [];
      for (const zoom of [100, 120]) {
        await seed({ zoom, theme, intro: false });
        await page.goto('https://space.bilibili.com/1/video', { waitUntil: 'domcontentloaded' });
        await page.locator('#margin-root .sp-acts-self').waitFor();
        for (const width of [2560, 1440, 1024, 900]) {
          await page.setViewportSize({ width, height: 1000 });
          await sleep(150);
          const g = await page.locator('#margin-root .sp-hero').evaluate(hero => {
            const box = hero.getBoundingClientRect(), stats = hero.querySelector('.sp-stats').getBoundingClientRect();
            const acts = hero.querySelector('.sp-acts').getBoundingClientRect(), who = hero.querySelector('.sp-who').getBoundingClientRect();
            return { rightInset: box.right - acts.right, aligned: Math.abs(stats.right - acts.right), leftGap: acts.left - who.right, inside: acts.left >= box.left && acts.right <= box.right, stacked: acts.top >= who.bottom };
          });
          samples.push({ width, zoom, ...g });
          if (!g.inside) miss.push(`${width}/${zoom}: actions overflow the profile`);
          if (width > 900 && (g.rightInset < 32 * zoom / 100 || g.aligned > 1 || g.leftGap < 32 * zoom / 100)) miss.push(`${width}/${zoom}: cramped or misaligned profile actions ${JSON.stringify(g)}`);
          if (width <= 900 && !g.stacked) miss.push(`${width}/${zoom}: actions overlap the identity`);
          if (zoom === 100 && width === 1440) await page.locator('#margin-root .sp-hero').screenshot({ path: join(OUT, `space-action-inset-${theme}.png`) });
        }
      }
      writeFileSync(join(OUT, `space-action-inset-${theme}.json`), JSON.stringify(samples, null, 2));
      await seed({ zoom: 100 });
      await page.setViewportSize({ width: 1440, height: 1000 });
      return miss;
    });

    await feature('profile-geometry', async () => {
      await reset(); await seed({ idDrag: false });
      const miss = [];
      for (const width of [1024, 1440, 2560]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(WATCH, { waitUntil: 'domcontentloaded' });
        const trigger = page.locator('#margin-watch-top .user.in');
        await trigger.waitFor(); await trigger.hover();
        const card = page.locator('#margin-watch-top .idcl-card'); await card.waitFor(); await sleep(1000);
        const box = await card.boundingBox(), anchor = await trigger.boundingBox();
        if (!anchor || anchor.x < 0 || anchor.x + anchor.width > width) miss.push(`${width}: account avatar outside viewport`);
        if (!box || box.x < 0 || box.x + box.width > width || Math.abs(box.x + box.width / 2 - anchor.x - anchor.width / 2) > box.width / 2 + 40) miss.push(`${width}: account card escaped avatar area ${JSON.stringify({ box, anchor })}`);
        const later = await page.evaluate(() => new Promise((resolve) => {
          const card = document.getElementById('margin-watch-top').shadowRoot.querySelector('.idcl-card');
          let min = Infinity, max = -Infinity;
          const timer = setInterval(() => { const x = card.getBoundingClientRect().x; min = Math.min(min, x); max = Math.max(max, x); }, 16);
          setTimeout(() => { clearInterval(timer); resolve(max - min); }, 500);
        }));
        if (later > 1) miss.push(`${width}: fixed account card drifts ${later}px`);
        await page.screenshot({ path: join(OUT, `account-card-${width}.png`) });
        await page.mouse.move(5, 800);
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(WATCH, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('html.margin-watch');
      const geometry = await page.evaluate(() => new Promise((resolve) => {
        const wrap = document.createElement('div'); wrap.className = 'usercard-wrap';
        wrap.style.cssText = 'position:absolute;right:16px;top:120px;display:block';
        const card = document.createElement('div'); card.className = 'user-card-m-exp';
        card.style.cssText = 'width:386px;height:280px'; card.textContent = 'UP 简介卡'; wrap.append(card); document.body.append(wrap);
        let min = Infinity, max = -Infinity;
        const timer = setInterval(() => { const w = card.getBoundingClientRect().width; min = Math.min(min, w); max = Math.max(max, w); }, 16);
        setTimeout(() => { clearInterval(timer); resolve({ width: card.getBoundingClientRect().width, delta: max - min }); wrap.remove(); }, 250);
      }));
      if (Math.abs(geometry.width - 386) > 1 || geometry.delta > 1) miss.push(`native card geometry rewritten: ${JSON.stringify(geometry)}`);
      const shareWidth = await page.evaluate(() => {
        const button = document.createElement('button'); button.className = 'video-toolbar-left-item video-share';
        button.style.cssText = 'min-width:124px';
        const icon = document.createElement('span'); icon.style.cssText = 'display:inline-block;width:20px'; icon.textContent = '↗';
        const count = document.createElement('span'); count.textContent = '201'; button.append(icon, count); document.body.append(button);
        const width = button.getBoundingClientRect().width; button.remove(); return width;
      });
      if (Math.abs(shareWidth - 124) > 1) miss.push(`classic native share width changed: ${shareWidth}`);
      return miss;
    });
    await feature('home-order', async () => {
      await reset();
      await seed({ homeOrder: ['feed', 'hero', 'dash', 'toolbar', 'footer'] });
      await page.goto(HOME, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.getElementById('margin-root')?.shadowRoot?.querySelector('.grid .card:not(.sk)'), null, { timeout: 15_000 });
      await sleep(500);
      return page.evaluate(() => {
        const r = document.getElementById('margin-root')?.shadowRoot;
        const main = r?.querySelector('main');
        if (!main) return ['main'];
        const kids = [...main.children], miss = [];
        const idx = (sel) => { const el = main.querySelector(sel); return el ? kids.indexOf(el) : -1; };
        const seq = ['.grid', '.hs-slot', '.dash', '.bar-mark', '.foot'];
        for (let i = 1; i < seq.length; i++) if (idx(seq[i - 1]) < 0 || idx(seq[i]) < 0 || idx(seq[i - 1]) >= idx(seq[i])) miss.push(`${seq[i - 1]}<${seq[i]}`);
        if (main.querySelector('.bar-mark')?.nextElementSibling !== main.querySelector('.bar')) miss.push('bar-mark+bar adjacency');
        if (main.querySelector('.grid')?.nextElementSibling !== main.querySelector('.status')) miss.push('grid+status adjacency');
        if (main.querySelector('.status')?.nextElementSibling !== main.querySelector('.sentinel')) miss.push('status+sentinel adjacency');
        return miss;
      });
    });

    await feature('settings-panel', async () => {
      await reset();
      await page.goto(HOME, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.getElementById('margin-root')?.shadowRoot?.querySelector('.grid .card:not(.sk)'), null, { timeout: 15_000 });
      await page.evaluate(() => {
        const r = document.getElementById('margin-root')?.shadowRoot;
        r?.querySelector('.hd-settings')?.click();
      });
      await page.waitForFunction(() => document.getElementById('margin-root')?.shadowRoot?.querySelector('.home-order-row'), null, { timeout: 8000 }).catch(() => {});
      await sleep(300);
      const miss = await page.evaluate(() => {
        const r = document.getElementById('margin-root')?.shadowRoot;
        const m = [];
        const rows = [...r?.querySelectorAll('.home-order-row') ?? []];
        if (rows.length !== 5) m.push(`order rows ${rows.length}`);
        if (!r?.querySelector('[data-focus="hero:down"]')) m.push('hero down button missing');
        if (![...r?.querySelectorAll('.row-label span') ?? []].some((e) => e.textContent === '减少动画')) m.push('reduce motion row missing');
        if (![...r?.querySelectorAll('.row-label span') ?? []].some((e) => e.textContent === '宽屏模式')) m.push('wide row missing');
        if (![...r?.querySelectorAll('.row-label span') ?? []].some((e) => e.textContent === '消息提醒')) m.push('message row missing');
        if (![...r?.querySelectorAll('.row-label span') ?? []].some((e) => e.textContent === '隐藏广告')) m.push('ads row missing');
        if (![...r?.querySelectorAll('.row-label span') ?? []].some((e) => e.textContent === '点击分类标签刷新列表')) m.push('tab-refresh row missing');
        return m;
      });
      await page.evaluate(() => {
        const r = document.getElementById('margin-root')?.shadowRoot;
        r?.querySelector('[data-focus="hero:down"]')?.click();
      });
      await sleep(500);
      miss.push(...await page.evaluate(() => {
        const r = document.getElementById('margin-root')?.shadowRoot;
        const main = r?.querySelector('main');
        const kids = [...main?.children ?? []];
        const idx = (sel) => { const el = main?.querySelector(sel); return el ? kids.indexOf(el) : -1; };
        return idx('.dash') >= 0 && idx('.dash') < idx('.hs-slot') ? [] : ['order button did not move hero down'];
      }));
      const introProblem = await page.evaluate(() => {
        const r = document.getElementById('margin-root')?.shadowRoot;
        const label = [...r?.querySelectorAll('.row-label span') ?? []].find((e) => e.textContent === '首页过场动画');
        const row = label?.closest('.row');
        const control = row?.querySelector('[role="switch"]');
        if (!control) return 'intro switch missing';
        if (row.closest('.sd')) return 'intro switch is hidden inside a drawer';
        control.click();
        return '';
      });
      if (introProblem) miss.push(introProblem);
      await sleep(300);
      const introSaved = await sw.evaluate(async () => (await chrome.storage.local.get('margin:settings'))['margin:settings']?.intro);
      if (introSaved !== false) miss.push('intro switch was not saved');
      await page.evaluate(() => { localStorage.setItem('margin:intro-always', '1'); });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.getElementById('margin-root')?.shadowRoot?.querySelector('.app.home'), null, { timeout: 15_000 });
      if (await page.evaluate(() => !!document.getElementById('margin-root')?.shadowRoot?.querySelector('.intro'))) miss.push('intro played while disabled');
      await page.evaluate(() => { localStorage.removeItem('margin:intro-always'); });
      return miss;
    });

    await feature('tab-refresh', async () => {
      await reset();
      await seed({ tabRefresh: true });
      await page.goto(HOME, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.getElementById('margin-root')?.shadowRoot?.querySelector('.grid .card:not(.sk)'), null, { timeout: 15_000 });
      await sleep(500);
      const state = () => page.evaluate(() => {
        const r = document.getElementById('margin-root').shadowRoot;
        return {
          backHidden: r.querySelector('.refresh.back')?.hidden,
          cards: r.querySelectorAll('.grid .card:not(.sk)').length,
          sel: r.querySelector('.tab[aria-selected="true"]')?.dataset.tab,
        };
      });
      const before = await state();
      // 打开设置后，点当前分类标签应该等于换一批
      await page.evaluate(() => document.getElementById('margin-root').shadowRoot.querySelector('.tab[data-tab=rcmd]')?.click());
      await sleep(1800);
      const after = await state();
      const m = [];
      if (before.backHidden !== true) m.push('back button visible before refreshing');
      if (after.backHidden !== false) m.push('back button missing after clicking the active tab');
      if (after.sel !== 'rcmd') m.push(`tab changed unexpectedly: ${after.sel}`);
      if (!after.cards) m.push('no cards after refreshing');
      await reset();
      return m;
    });

    await feature('home-filter', async () => {
      await reset();
      await seed({ filters: { ...filterOff, keywords: ['芯片'] } });
      await page.goto(HOME, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.getElementById('margin-root')?.shadowRoot?.querySelector('.grid .card:not(.sk)'), null, { timeout: 15_000 });
      await sleep(500);
      return page.evaluate(() => {
        const r = document.getElementById('margin-root')?.shadowRoot;
        const titles = [...r?.querySelectorAll('.grid .card .title') ?? []].map((e) => e.textContent ?? '');
        const miss = [];
        if (!titles.length) miss.push('no cards');
        if (titles.some((t) => t.includes('芯片'))) miss.push('keyword card still shown');
        if (titles.some((t) => t.includes('广告推广视频'))) miss.push('data-level ad shown with hideAds default');
        return miss;
      });
    });

    await feature('space-charge-badge', async () => {
      await reset();
      await page.goto('https://space.bilibili.com/2/video', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.getElementById('margin-root')?.shadowRoot?.querySelector('.grid .card:not(.sk)'), null, { timeout: 15_000 });
      await sleep(400);
      return page.evaluate(() => {
        const r = document.getElementById('margin-root')?.shadowRoot;
        const badges = [...r?.querySelectorAll('.grid .card .tag-charge') ?? []].map((e) => e.textContent ?? '');
        const miss = [];
        if (!badges.length) miss.push('no .tag-charge on space cards');
        if (badges.some((t) => t !== '充电专属')) miss.push('unexpected badge text');
        return miss;
      });
    });

    await feature('settings-btn', async () => {
      await page.goto('about:blank');
      await reset();
      await seed({ ytHome: true });
      await page.goto(HOME, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.getElementById('margin-root')?.shadowRoot?.querySelector('.hd-settings'), null, { timeout: 15_000 });
      await page.evaluate(() => {
        document.getElementById('margin-root')?.shadowRoot?.querySelector('.hd-settings')?.click();
      });
      await page.waitForFunction(() => document.getElementById('margin-root')?.shadowRoot?.querySelector('.home-order-row'), null, { timeout: 8_000 }).catch(() => {});
      const miss = await page.evaluate(() => {
        const r = document.getElementById('margin-root')?.shadowRoot;
        const m = [];
        if (!r?.querySelector('.hd-settings')) m.push('settings button missing');
        if (!r?.querySelector('.home-order-row')) m.push('settings panel not open');
        return m;
      });
      await page.goto('about:blank');
      await seed({ ytHome: false });
      return miss;
    });

    await feature('original-entry', async () => {
      await reset();
      const m = [];
      for (const [name, url] of [['home', HOME], ['watch', WATCH], ['feed', 'https://t.bilibili.com/']]) {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => {
          const r = document.getElementById('margin-root')?.shadowRoot ?? document.getElementById('margin-watch-top')?.shadowRoot;
          return r?.querySelector('.et-btn[aria-label="原版"]');
        }, null, { timeout: 15_000 }).catch(() => {});
        const visible = await page.evaluate(() => {
          const r = document.getElementById('margin-root')?.shadowRoot ?? document.getElementById('margin-watch-top')?.shadowRoot;
          const b = r?.querySelector('.et-btn[aria-label="原版"]');
          return !!b && !b.hidden && b.getClientRects().length > 0;
        });
        if (!visible) m.push(`${name} original entry missing`);
      }
      return m;
    });

    await feature('space-history-drawer', async () => {
      await reset();
      await page.goto('https://space.bilibili.com/1/video', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => {
        const r = document.getElementById('margin-root')?.shadowRoot;
        return [...(r?.querySelectorAll('.sp-tile') ?? [])].some((e) => e.textContent?.trim() === '历史记录');
      }, null, { timeout: 15_000 });
      await page.evaluate(() => {
        const r = document.getElementById('margin-root')?.shadowRoot;
        [...(r?.querySelectorAll('.sp-tile') ?? [])].find((e) => e.textContent?.trim() === '历史记录')?.click();
      });
      await page.waitForFunction(() => {
        const r = document.getElementById('margin-root')?.shadowRoot;
        const panels = [...(r?.querySelectorAll('aside[aria-label="历史记录"]') ?? []), ...document.querySelectorAll('aside[aria-label="历史记录"]')];
        return panels.some((p) => !p.parentElement?.hidden && p.getBoundingClientRect().width > 0);
      }, null, { timeout: 8000 });
      await sleep(400);
      return page.evaluate(() => {
        const r = document.getElementById('margin-root')?.shadowRoot;
        const panels = [...(r?.querySelectorAll('aside[aria-label="历史记录"]') ?? []), ...document.querySelectorAll('aside[aria-label="历史记录"]')];
        const p = panels.find((x) => !x.parentElement?.hidden && x.getBoundingClientRect().width > 0);
        const wrap = p?.parentElement;
        const top = r?.elementFromPoint?.(innerWidth - 20, 100) ?? document.elementFromPoint(innerWidth - 20, 100);
        const m = [];
        if (!wrap || getComputedStyle(wrap).zIndex !== '2147483600') m.push('history drawer layer is below the app');
        if (!p || !(top === p || p.contains(top))) m.push('history drawer is not clickable at the top layer');
        if (p) {
          const probe = document.createElement('span');
          probe.style.cssText = 'color:var(--ink);background:var(--surface)';
          p.append(probe);
          const expected = getComputedStyle(probe);
          const panel = getComputedStyle(p);
          if (panel.color !== expected.color || panel.backgroundColor !== expected.backgroundColor) m.push('history drawer does not follow the light theme');
          probe.remove();
        }
        return m;
      });
    });

    await feature('usercard-plus-contrast', async () => {
      await reset();
      await page.goto(WATCH, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.documentElement.classList.contains('margin-watch'), null, { timeout: 15_000 });
      await page.evaluate(() => {
        const style = document.createElement('style');
        style.textContent = '.usercard-wrap .like .plus, .usercard-wrap .like .plus i { color:#fff; -webkit-text-fill-color:#fff; }';
        document.head.append(style);
        const card = document.createElement('div');
        card.className = 'usercard-wrap';
        card.innerHTML = '<div class="btn-box"><a class="like"><span class="plus"><i></i></span>关注</a></div>';
        document.body.append(card);
      });
      return page.evaluate(() => {
        const icon = document.querySelector('.usercard-wrap .like .plus i');
        if (!icon) return ['user card plus icon missing'];
        const expected = getComputedStyle(icon.closest('.like')).color;
        const m = [];
        if (getComputedStyle(icon).color !== expected) m.push('plus icon color mismatch');
        if (getComputedStyle(icon).webkitTextFillColor !== expected) m.push('plus icon text fill mismatch');
        if (getComputedStyle(icon, '::before').webkitTextFillColor !== expected) m.push('plus icon pseudo fill mismatch');
        return m;
      });
    });

    await feature('native-space-light', async () => {
      await reset();
      await seed({ theme: 'light' });
      await page.goto('https://space.bilibili.com/1/fans/follow', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.documentElement.classList.contains('margin-space-native'), null, { timeout: 15_000 });
      return page.evaluate(() => {
        const probe = document.createElement('span');
        probe.style.cssText = 'color:var(--m-ink);background-color:color-mix(in srgb,var(--m-canvas) 88%,transparent)';
        document.body.append(probe);
        const style = getComputedStyle(probe);
        const text = style.color, background = style.backgroundColor;
        probe.remove();
        const m = [];
        const nickname = document.querySelector('.nickname');
        if (!nickname || getComputedStyle(nickname).color !== text) m.push('light nickname contrast not applied');
        if (nickname && getComputedStyle(nickname).textShadow !== 'none') m.push('light nickname shadow remains');
        for (const sel of ['.view-switcher__trigger', '.toutu-editor-trigger']) {
          const el = document.querySelector(sel);
          if (!el || getComputedStyle(el).color !== text) m.push(`${sel} contrast not applied`);
        }
        const nav = document.querySelector('.nav-bar');
        if (!nav || getComputedStyle(nav).backgroundColor !== background) m.push('light nav background not applied');
        return m;
      });
    });

    await feature('native-relation-contrast', async () => {
      await reset();
      await seed({ theme: 'dark' });
      await page.goto('https://space.bilibili.com/1/fans/follow', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.documentElement.classList.contains('margin-space-native'), null, { timeout: 15_000 });
      await page.hover('#new-user-card-main #follow');
      return page.evaluate(() => {
        const probe = document.createElement('span');
        probe.style.cssText = 'color:var(--m-canvas);background-color:var(--m-ink)';
        document.body.append(probe);
        const probeStyle = getComputedStyle(probe);
        const text = probeStyle.color, background = probeStyle.backgroundColor;
        probe.remove();
        const m = [];
        for (const sel of ['#native-follow', '#new-user-card-main #follow', '.vui_dialog--btn-confirm']) {
          const el = document.querySelector(sel);
          if (!el) { m.push(`${sel} missing`); continue; }
          const style = getComputedStyle(el);
          if (style.color !== text) m.push(`${sel} text ${style.color} != ${text}`);
          if (style.backgroundColor !== background) m.push(`${sel} background ${style.backgroundColor} != ${background}`);
        }
        const cardIcon = document.querySelector('#new-user-card-main #follow bili-icon');
        if (cardIcon && getComputedStyle(cardIcon).color !== text) m.push('user card plus icon has wrong color');
        const shadowFollow = document.querySelector('#new-user-card-shadow')?.__testShadow?.querySelector('#follow');
        if (!shadowFollow) m.push('shadow user card follow button missing');
        else {
          const style = getComputedStyle(shadowFollow);
          if (style.color !== text || style.backgroundColor !== background) m.push('shadow user card contrast not applied');
        }
        const box = document.querySelector('.vui_checkbox--input-box');
        const mark = box && getComputedStyle(box, '::after').borderRightColor;
        if (mark !== text) m.push(`checkbox mark ${mark} != ${text}`);
        return m;
      });
    });

    await feature('feed-layout-emotes', async () => {
      await reset();
      await page.goto('https://t.bilibili.com/', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.getElementById('margin-root')?.shadowRoot?.querySelector('.fd-follow-row'), null, { timeout: 15_000 });
      const miss = await page.evaluate(() => {
        const r = document.getElementById('margin-root')?.shadowRoot;
        const first = r?.querySelector('.fd-follow-row');
        if (!first) return ['follow list empty'];
        const m = [];
        const dynText = r?.querySelector('.dy-text');
        const font = dynText ? getComputedStyle(dynText).fontFamily : '';
        if (!font.includes('Arial Unicode MS') || !font.includes('Sinhala MN')) m.push('kaomoji font fallback missing');
        if (getComputedStyle(first).flexDirection !== 'row') m.push('follow row is not horizontal');
        const face = first.querySelector('.fd-follow-face')?.getBoundingClientRect();
        const name = first.querySelector('.fd-follow-name')?.getBoundingClientRect();
        if (face && name && name.left < face.right) m.push('follow avatar and name overlap');
        const live = r?.querySelector('.fd-live')?.getBoundingClientRect();
        const follows = r?.querySelector('.fd-follows')?.getBoundingClientRect();
        if (!live || !follows || live.top >= follows.top) m.push('live card is not above follows');
        return m;
      });
      await page.waitForFunction(() => document.getElementById('margin-root')?.shadowRoot?.querySelectorAll('.fd-list .dy-text .dy-rem[alt="[给心心]"]').length === 3, null, { timeout: 8000 });
      miss.push(...await page.evaluate(() => {
        const r = document.getElementById('margin-root')?.shadowRoot;
        const images = [...r?.querySelectorAll('.fd-list .dy-text .dy-rem[alt="[给心心]"]') ?? []];
        const m = [];
        if (images.length !== 3) m.push(`dynamic emote images ${images.length}`);
        if (images.some((e) => e.getAttribute('alt') !== '[给心心]')) m.push('dynamic emote alt missing');
        if ([...r?.querySelectorAll('.fd-list .dy-text') ?? []].some((e) => e.textContent?.includes('[给心心]'))) m.push('raw dynamic emote token still visible');
        return m;
      }));
      await page.evaluate(() => {
        const r = document.getElementById('margin-root')?.shadowRoot;
        const card = r?.querySelector('.fd-list .dy:not(.sk)');
        const button = [...card?.querySelectorAll('.dy-act') ?? []].find((e) => e.textContent?.startsWith('评论'));
        button?.click();
      });
      await page.waitForFunction(() => document.getElementById('margin-root')?.shadowRoot?.querySelectorAll('.dy-cbox .dy-r:has(.dy-r-medal) .dy-rem').length === 3, null, { timeout: 8000 });
      miss.push(...await page.evaluate(() => {
        const r = document.getElementById('margin-root')?.shadowRoot;
        const token = '[liyuu 动态表情_可爱]';
        const decorated = r?.querySelector('.dy-cbox .dy-r:has(.dy-r-medal)');
        const images = [...decorated?.querySelectorAll('.dy-rem') ?? []];
        const m = [];
        if (images.length !== 3) m.push(`emote images ${images.length}`);
        if (images.some((e) => e.getAttribute('alt') !== token || !e.getAttribute('src')?.startsWith('https://'))) m.push('emote image data missing');
        if (decorated?.querySelector('p')?.textContent?.includes(token)) m.push('raw emote token still visible');
        const level = r?.querySelector('.dy-cbox .dy-r-level');
        if (!level?.getAttribute('src')?.endsWith('/level_5.svg') || getComputedStyle(level).width !== '30px') m.push('native reply level missing');
        const medal = r?.querySelector('.dy-cbox .dy-r-medal');
        if (medal?.getAttribute('title') !== '映间 12 级粉丝勋章' || medal?.textContent !== '映间12') m.push('reply fan medal missing');
        const medalStyle = medal ? getComputedStyle(medal) : null;
        if (medalStyle?.height !== '14px' || medalStyle?.borderRadius !== '7px') m.push('reply medal shape does not match native');
        if (!medal?.querySelector('.dy-r-medal-first') || !medal.querySelector('.dy-r-medal-second')) m.push('reply medal icons missing');
        const avatar = decorated?.querySelector('.dy-r-avatar');
        if (!avatar || Math.abs(parseFloat(getComputedStyle(avatar).width) - 28 * .787) > .1) m.push('reply pendant avatar ratio does not match native');
        if (!r?.querySelector('.dy-cbox .dy-r-pendant')?.getAttribute('src')?.startsWith('https://')) m.push('reply pendant missing');
        if (r?.querySelector('.dy-cbox .dy-r-nameplate')?.getAttribute('alt') !== '有爱大佬') m.push('reply nameplate missing');
        return m;
      }));
      return miss;
    });

    await feature('feed-search-palette', async () => {
      await reset(); await seed({ theme: 'dark', searchStyle: 'new' });
      await page.goto('https://t.bilibili.com/', { waitUntil: 'domcontentloaded' });
      await page.locator('#margin-root .top .search').click();
      const palette = page.locator('#margin-root .cp[data-open="true"]');
      await palette.waitFor();
      const miss = [];
      if (!(await palette.locator('.cp-input input').count())) miss.push('search input missing');
      if (!(await palette.locator('.cp-side .cp-item').count())) miss.push('commands missing');
      if (!(await palette.locator('.cp-list .cp-item').count())) miss.push('trending searches missing');
      await palette.locator('.cp-input input').focus();
      await page.keyboard.press('Escape');
      await page.locator('#margin-root .cp').waitFor({ state: 'hidden' });
      return miss;
    });

    await feature('feed-full-composer', async () => {
      await reset();
      await seed({ theme: 'dark' });
      await page.goto('https://t.bilibili.com/', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.getElementById('margin-root')?.shadowRoot?.querySelector('.fd-post'), null, { timeout: 15_000 });
      await page.evaluate(() => document.getElementById('margin-root').shadowRoot.querySelector('.fd-post').click());
      await page.waitForFunction(() => location.search.includes('compose=1') && document.documentElement.classList.contains('margin-compose') && getComputedStyle(document.querySelector('.bili-dyn-publishing')).backgroundColor === 'rgb(26, 26, 28)', null, { timeout: 15_000 });
      const m = await page.evaluate(() => {
        const miss = [];
        if (document.getElementById('margin-root')) miss.push('takeover app mounted over the full composer');
        if (document.querySelector('.dc-editor')) miss.push('limited composer is still present');
        if (document.querySelectorAll('.bili-dyn-publishing__tools__item').length !== 5) miss.push('composer tools are incomplete');
        if (document.querySelector('.bili-dyn-publishing__title__input')?.placeholder !== '好的标题更容易获得支持，选填20字') miss.push('title input missing');
        if (document.querySelector('.bili-rich-textarea__inner')?.getAttribute('placeholder') !== '有什么想和大家分享的？') miss.push('rich editor missing');
        if (document.querySelector('.bili-dyn-publishing__title').getBoundingClientRect().height < 56) miss.push('title container is clipped');
        if (document.querySelector('.bili-rich-textarea__inner').getBoundingClientRect().height < 210) miss.push('rich editor is clipped');
        if (getComputedStyle(document.querySelector('.bili-dyn-publishing__control')).display !== 'flex') miss.push('composer footer layout missing');
        if (getComputedStyle(document.querySelector('.bili-dyn-publishing__action.launcher.disabled')).backgroundColor !== 'rgba(255, 255, 255, 0.06)') miss.push('disabled publish button is too prominent');
        if (!document.querySelector('.bili-dyn-publishing__action.launcher')) miss.push('publish action missing');
        if (!document.getElementById('margin-watch-top')?.shadowRoot?.querySelector('header')) miss.push('margin header missing');
        for (const el of document.querySelectorAll('.bili-dyn-home--member > aside, .bili-dyn-home--member > main > section:not(:first-child)')) {
          if (getComputedStyle(el).display !== 'none') miss.push('feed or sidebar still visible');
        }
        if (getComputedStyle(document.body).display === 'none') miss.push('original editor is still muted');
        if (getComputedStyle(document.querySelector('.bili-topic-search__popover')).borderWidth !== '0px') miss.push('topic button has duplicate borders');
        const topic = document.querySelector('.bili-topic-search__input').getBoundingClientRect();
        const topicText = document.querySelector('.bili-topic-search__input__text').getBoundingClientRect();
        if (topic.height < 32 || topicText.top < topic.top || topicText.bottom > topic.bottom) miss.push('topic button border clips its label');
        if (getComputedStyle(document.querySelector('.bili-topic-search__input')).borderWidth !== '0px') miss.push('topic button still has a border');
        for (const el of document.querySelectorAll('.bili-popup .bili-input, .bili-popup .bili-picker-input')) {
          const style = getComputedStyle(el);
          if (style.backgroundColor === 'rgb(17, 17, 18)') miss.push('form control still uses a black background');
          if (style.borderRadius !== '10px') miss.push('form control radius mismatch');
        }
        for (const el of document.querySelectorAll('.bili-popup .bili-input__inner')) {
          if (getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)') miss.push('nested input is not transparent');
        }
        if (getComputedStyle(document.querySelector('.bili-popup-modal__button.confirm.disabled')).backgroundColor !== 'rgba(255, 255, 255, 0.06)') miss.push('modal disabled button is too prominent');
        const focused = document.querySelector('.bili-popup .bili-input__inner');
        focused.focus();
        for (const el of [focused, focused.closest('.bili-input')]) {
          const style = getComputedStyle(el);
          if (style.boxShadow !== 'none') miss.push('input focus glow remains');
          if (style.outlineStyle !== 'none') miss.push('input focus outline remains');
          if (getComputedStyle(el, '::before').borderWidth !== '0px') miss.push('input pseudo focus border remains');
        }
        return miss;
      });
      await page.evaluate(() => document.querySelector('.bili-topic-search__input').click());
      await page.waitForFunction(() => document.querySelector('.bili-topic-search__popover').classList.contains('active'));
      m.push(...await page.evaluate(() => {
        const miss = [], popover = document.querySelector('.bili-topic-search__popover'), result = document.querySelector('.bili-topic-search__result');
        const box = popover.getBoundingClientRect();
        if (box.width < 320 || box.height < 200) miss.push(`topic popup collapsed: ${box.width}x${box.height}`);
        if (getComputedStyle(popover).backgroundColor !== 'rgb(26, 26, 28)') miss.push('topic popup is transparent');
        if (!result.clientHeight || getComputedStyle(result).overflowY !== 'auto' || result.scrollHeight <= result.clientHeight) miss.push('topic results are not independently scrollable');
        const name = document.querySelector('.bili-topic-item__cloud__name'), rect = name.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + 4, rect.top + rect.height / 2);
        if (!hit?.closest('.bili-topic-item')) miss.push('editor content covers topic results');
        return miss;
      }));
      await page.evaluate(() => document.querySelector('.bili-dyn-publishing__title__input').click());
      await page.waitForFunction(() => !document.querySelector('.bili-topic-search__popover').classList.contains('active'));
      await page.evaluate(() => document.querySelector('.bili-dyn-publishing__settings__btn').click());
      m.push(...await page.evaluate(() => {
        const miss = [];
        const options = document.querySelector('.bili-cascader-options');
        if (options.hidden) miss.push('settings did not open');
        const labels = [...options.querySelectorAll('.bili-cascader-options__item-label')].map((e) => e.textContent.trim());
        for (const text of ['可见范围', '定时发布', '允许评论', '创作声明']) if (!labels.includes(text)) miss.push(`${text} missing`);
        if (getComputedStyle(options).backgroundColor !== 'rgb(26, 26, 28)') miss.push('settings theme mismatch');
        return miss;
      }));
      await page.evaluate(() => {
        const popup = document.querySelector('.bili-popup');
        popup.hidden = false;
        const content = popup.querySelector('.bili-popup-modal__content');
        const filler = document.createElement('div');
        filler.style.height = '2000px';
        content.append(filler);
        content.scrollTop = content.scrollHeight;
      });
      m.push(...await page.evaluate(() => {
        const miss = [];
        const wrap = document.querySelector('.bili-popup__wrap');
        const content = document.querySelector('.bili-popup-modal__content');
        const footer = document.querySelector('.bili-popup-modal__footer');
        const title = document.querySelector('.bili-popup__header__title');
        if (title.getBoundingClientRect().top < 72) miss.push('modal title is covered by the navigation');
        if (getComputedStyle(footer).position !== 'static') miss.push('modal footer still covers content');
        if (content.scrollHeight <= content.clientHeight) miss.push('modal content is not scrollable');
        if (content.getBoundingClientRect().bottom > footer.getBoundingClientRect().top + 1) miss.push('modal content overlaps the footer');
        if (footer.getBoundingClientRect().bottom > innerHeight) miss.push('modal footer is outside the viewport');
        if (wrap.getBoundingClientRect().height > innerHeight - 144 + 1) miss.push('modal exceeds the viewport height');
        return miss;
      }));
      return m;
    });

    await feature('back-top-all-pages', async () => {
      await reset();
      const m = [];
      const shellPages = [
        ['home', HOME], ['feed', 'https://t.bilibili.com/'], ['history', 'https://www.bilibili.com/account/history'],
        ['space', 'https://space.bilibili.com/2/video'], ['message', 'https://message.bilibili.com/'],
      ];
      for (const [name, url] of shellPages) {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.getElementById('margin-root')?.shadowRoot?.querySelector('.back-top'), null, { timeout: 15_000 });
        const initialHidden = await page.evaluate(() => {
          const r = document.getElementById('margin-root')?.shadowRoot;
          const app = r?.querySelector('.app');
          const main = r?.querySelector('main');
          if (app && main) main.style.minHeight = `${app.clientHeight + 1200}px`;
          return r?.querySelector('.back-top')?.hidden;
        });
        if (initialHidden !== true) m.push(`${name}: back-top visible before scrolling`);
        await sleep(100);
        await page.evaluate(() => {
          const app = document.getElementById('margin-root')?.shadowRoot?.querySelector('.app');
          if (app) { app.scrollTop = 600; app.dispatchEvent(new Event('scroll')); }
        });
        await page.waitForFunction(() => document.getElementById('margin-root')?.shadowRoot?.querySelector('.back-top')?.hidden === false, null, { timeout: 3000 }).catch(() => {});
        if (await page.evaluate(() => document.getElementById('margin-root')?.shadowRoot?.querySelector('.back-top')?.hidden !== false)) m.push(`${name}: back-top hidden after scrolling`);
        await page.evaluate(() => document.getElementById('margin-root')?.shadowRoot?.querySelector('.back-top')?.click());
        await page.waitForFunction(() => {
          const r = document.getElementById('margin-root')?.shadowRoot;
          return r?.querySelector('.app')?.scrollTop === 0 && r?.querySelector('.back-top')?.hidden;
        }, null, { timeout: 5000 }).catch(() => {});
        const after = await page.evaluate(() => {
          const r = document.getElementById('margin-root')?.shadowRoot;
          return { top: r?.querySelector('.app')?.scrollTop, hidden: r?.querySelector('.back-top')?.hidden };
        });
        if (after.top !== 0 || !after.hidden) m.push(`${name}: back-top did not return to the top and hide`);
        if (name === 'feed') {
          await page.evaluate(() => {
            const r = document.getElementById('margin-root')?.shadowRoot;
            const main = r?.querySelector('main');
            if (main) main.style.display = 'none';
          });
          await sleep(100);
          const short = await page.evaluate(() => {
            const r = document.getElementById('margin-root')?.shadowRoot;
            const app = r?.querySelector('.app');
            return { insufficient: app ? app.scrollHeight <= app.clientHeight + 1 : false, hidden: r?.querySelector('.back-top')?.hidden };
          });
          if (!short.insufficient || !short.hidden) m.push('feed: back-top remains visible when content is too short');
        }
      }

      const documentPages = [
        ['watch', WATCH], ['search', SEARCH], ['opus', 'https://www.bilibili.com/opus/1005142803949289489'],
        ['read', 'https://www.bilibili.com/read/cv100'], ['bangumi', 'https://www.bilibili.com/bangumi/play/ep100'],
        ['dynamic-detail', 'https://t.bilibili.com/1005142803949289489'], ['native-space', 'https://space.bilibili.com/1/fans/follow'],
        ['popular', POPULAR], ['live', 'https://live.bilibili.com/123'],
      ];
      for (const [name, url] of documentPages) {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.getElementById('margin-watch-top')?.shadowRoot?.querySelector('.back-top'), null, { timeout: 15_000 });
        const initialHidden = await page.evaluate(() => {
          document.body.style.minHeight = `${innerHeight + 1200}px`;
          return document.getElementById('margin-watch-top')?.shadowRoot?.querySelector('.back-top')?.hidden;
        });
        if (initialHidden !== true) m.push(`${name}: back-top visible before scrolling`);
        await sleep(100);
        await page.evaluate(() => { window.scrollTo({ top: 600, behavior: 'instant' }); window.dispatchEvent(new Event('scroll')); });
        await page.waitForFunction(() => document.getElementById('margin-watch-top')?.shadowRoot?.querySelector('.back-top')?.hidden === false, null, { timeout: 3000 }).catch(() => {});
        if (await page.evaluate(() => document.getElementById('margin-watch-top')?.shadowRoot?.querySelector('.back-top')?.hidden !== false)) m.push(`${name}: back-top hidden after scrolling`);
        await page.evaluate(() => document.getElementById('margin-watch-top')?.shadowRoot?.querySelector('.back-top')?.click());
        await page.waitForFunction(() => scrollY === 0 && document.getElementById('margin-watch-top')?.shadowRoot?.querySelector('.back-top')?.hidden, null, { timeout: 5000 }).catch(() => {});
        const after = await page.evaluate(() => ({ top: scrollY, hidden: document.getElementById('margin-watch-top')?.shadowRoot?.querySelector('.back-top')?.hidden }));
        if (after.top !== 0 || !after.hidden) m.push(`${name}: back-top did not return to the top and hide`);
      }
      return m;
    });

    await feature('tag-filter-home', async () => {
      await reset();
      await seed({ filters: { ...filterOff, keywords: ['隐藏标签词'] } });
      await page.goto(HOME, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.getElementById('margin-root')?.shadowRoot?.querySelector('.grid .card:not(.sk)'), null, { timeout: 15_000 });
      await sleep(800);
      return page.evaluate(() => {
        const r = document.getElementById('margin-root')?.shadowRoot;
        const titles = [...r?.querySelectorAll('.grid .card .title') ?? []].map((e) => e.textContent ?? '');
        const miss = [];
        if (!titles.length) miss.push('no cards');
        // 《胡闹厨房》的标题不含屏蔽词，但视频标签是「隐藏标签词」
        if (titles.some((t) => t.includes('胡闹厨房'))) miss.push('tag-blocked card shown');
        return miss;
      });
    });

    await feature('space-no-filter', async () => {
      await reset();
      await seed({ filters: { ...filterOff, keywords: ['旗舰手机芯片'], minDuration: 600 } });
      await page.goto('https://space.bilibili.com/1/video', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.getElementById('margin-root')?.shadowRoot?.querySelector('.grid .card:not(.sk)'), null, { timeout: 15_000 });
      await sleep(600);
      const miss = await page.evaluate(() => {
        const r = document.getElementById('margin-root')?.shadowRoot;
        const cards = [...r?.querySelectorAll('.grid .card:not(.sk)') ?? []];
        const m = [];
        if (cards.length < 4) m.push(`space cards ${cards.length}`);
        if (cards.some((c) => c.hasAttribute('data-margin-filtered'))) m.push('space video filtered');
        if (!cards.some((c) => (c.querySelector('.title')?.textContent ?? '').includes('旗舰手机芯片'))) m.push('keyword-matched video hidden');
        return m;
      });
      await page.evaluate(() => {
        const r = document.getElementById('margin-root')?.shadowRoot;
        r?.querySelector('.sp-bar .tab[data-tab="dynamic"]')?.click();
      });
      await page.waitForFunction(() => document.getElementById('margin-root')?.shadowRoot?.querySelector('.dy:not(.sk)'), null, { timeout: 15_000 }).catch(() => {});
      await sleep(400);
      miss.push(...await page.evaluate(() => {
        const r = document.getElementById('margin-root')?.shadowRoot;
        const dyn = [...r?.querySelectorAll('.dy:not(.sk)') ?? []];
        if (!dyn.length) return ['space dynamics empty'];
        return dyn.some((d) => d.hasAttribute('data-margin-filtered')) ? ['space dynamic filtered'] : [];
      }));
      return miss;
    });

    await feature('native-tag-filter', async () => {
      await reset();
      await seed({ filters: { ...filterOff, keywords: ['隐藏标签词'] } });
      await page.goto(SEARCH, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => {
        const el = document.querySelector('[data-k="tag"]');
        return !!el && getComputedStyle(el).display === 'none';
      }, null, { timeout: 12_000 }).catch(() => {});
      await sleep(200);
      return page.evaluate(() => {
        const el = document.querySelector('[data-k="tag"]');
        const normal = document.querySelector('[data-k="normal"]');
        const m = [];
        if (!el || getComputedStyle(el).display !== 'none') m.push('tag card not hidden');
        if (normal && getComputedStyle(normal).display === 'none') m.push('normal card hidden');
        return m;
      });
    });

    await feature('refresh-keeps-scroll', async () => {
      // #39：滚到下面点「换一批」，新一批就绪前旧卡片要留在原位，换完从视频区顶部重新开始
      await reset();
      await seed({ filters: filterOff });
      await page.goto(HOME, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => (document.getElementById('margin-root')?.shadowRoot?.querySelectorAll('.grid .card:not(.sk)').length ?? 0) >= 8, null, { timeout: 15_000 });
      const before = await page.evaluate(() => {
        const app = document.getElementById('margin-root')?.shadowRoot?.querySelector('.app');
        if (!app) return -1;
        app.scrollTop = app.scrollHeight;
        return app.scrollTop;
      });
      if (before < 300) return [`page too short to scroll: ${before}`];
      const slowFeed = /\/index\/top\/feed\/rcmd\?/;
      mockOverride = async (u) => { if (slowFeed.test(u)) { await sleep(1200); return apiBody(u); } };
      // 点击之后连续采样：旧实现会先清空网格（卡片数归零）并把 scrollTop 摔到顶部，再慢慢补回来
      const sampled = await page.evaluate(() => new Promise((resolve) => {
        const r = document.getElementById('margin-root').shadowRoot;
        const app = r.querySelector('.app');
        const btn = r.querySelector('.ghost.refresh:not(.back)');
        let minTop = Infinity, minCards = Infinity;
        const t = setInterval(() => {
          minTop = Math.min(minTop, app.scrollTop);
          minCards = Math.min(minCards, r.querySelectorAll('.grid .card:not(.sk)').length);
        }, 16);
        btn?.click();
        setTimeout(() => { clearInterval(t); resolve({ minTop, minCards }); }, 1000);
      }));
      // 换完要直接落在视频区顶部（分类栏吸住、第一行卡片在栏下），不做长距离动画
      const expected = await page.evaluate(() => {
        const r = document.getElementById('margin-root').shadowRoot;
        const app = r.querySelector('.app');
        const bar = r.querySelector('.bar'), mark = r.querySelector('.bar-mark');
        const markTop = mark.getBoundingClientRect().top - app.getBoundingClientRect().top + app.scrollTop;
        // +4：落在吸顶那一侧，避开分类栏展开/收起的临界点
        return Math.max(0, markTop - (parseFloat(getComputedStyle(bar).top) || 0) + 4);
      });
      await page.waitForFunction((exp) => {
        const app = document.getElementById('margin-root')?.shadowRoot?.querySelector('.app');
        return !!app && Math.abs(app.scrollTop - exp) <= 2;
      }, expected, { timeout: 4000 }).catch(() => {});
      const after = await page.evaluate(() => {
        const r = document.getElementById('margin-root').shadowRoot;
        const app = r.querySelector('.app');
        const bar = r.querySelector('.bar'), mark = r.querySelector('.bar-mark');
        const card = r.querySelector('.grid .card:not(.sk)');
        const markTop = mark.getBoundingClientRect().top - app.getBoundingClientRect().top + app.scrollTop;
        const c = card?.getBoundingClientRect(), b = bar.getBoundingClientRect();
        return {
          top: app.scrollTop,
          expected: Math.max(0, markTop - (parseFloat(getComputedStyle(bar).top) || 0) + 4),
          cards: r.querySelectorAll('.grid .card:not(.sk)').length,
          firstBelowBar: !!c && !!b && c.top >= b.bottom - 8,
          firstNearTop: !!c && c.top < innerHeight * 0.5,
        };
      });
      // 落位后不能再被滚动锚定 / 吸顶切换来回拽
      const stable = await page.evaluate(() => new Promise((resolve) => {
        const app = document.getElementById('margin-root').shadowRoot.querySelector('.app');
        let min = Infinity, max = -Infinity;
        const t = setInterval(() => { min = Math.min(min, app.scrollTop); max = Math.max(max, app.scrollTop); }, 16);
        setTimeout(() => { clearInterval(t); resolve({ min, max }); }, 600);
      }));
      const miss = [];
      if (sampled.minCards < 8) miss.push(`grid emptied during refresh: min ${sampled.minCards} cards`);
      if (sampled.minTop < expected - 8) miss.push(`scroll flashed above video top: ${before} -> ${sampled.minTop} (want ${expected})`);
      if (Math.abs(after.top - after.expected) > 8) miss.push(`did not land on video top: ${after.expected} -> ${after.top}`);
      if (stable.max - stable.min > 4) miss.push(`scroll bounced after landing: ${stable.min}..${stable.max}`);
      if (!after.cards) miss.push('no cards after refresh');
      if (!after.firstBelowBar || !after.firstNearTop) miss.push('first card is not at the top of the video area');
      return miss;
    });

    await feature('refresh-at-page-top', async () => {
      // 本来就在页面最顶部（还没滚到视频区）时，换一批应该原地刷新，不能往下跳到视频区顶部
      await reset();
      await seed({ filters: filterOff });
      await page.goto(HOME, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => (document.getElementById('margin-root')?.shadowRoot?.querySelectorAll('.grid .card:not(.sk)').length ?? 0) >= 8, null, { timeout: 15_000 });
      await page.evaluate(() => { const app = document.getElementById('margin-root').shadowRoot.querySelector('.app'); app.scrollTop = 0; });
      await sleep(300);
      const sampled = await page.evaluate(() => new Promise((resolve) => {
        const r = document.getElementById('margin-root').shadowRoot;
        const app = r.querySelector('.app');
        const btn = r.querySelector('.ghost.refresh:not(.back)');
        let maxTop = -Infinity, minCards = Infinity;
        const t = setInterval(() => {
          maxTop = Math.max(maxTop, app.scrollTop);
          minCards = Math.min(minCards, r.querySelectorAll('.grid .card:not(.sk)').length);
        }, 16);
        btn?.click();
        setTimeout(() => { clearInterval(t); resolve({ maxTop, minCards, top: app.scrollTop }); }, 1000);
      }));
      const miss = [];
      if (sampled.minCards < 8) miss.push(`grid emptied during refresh: min ${sampled.minCards} cards`);
      if (sampled.maxTop > 8 || sampled.top > 8) miss.push(`jumped down from page top: top ${sampled.top}, max ${sampled.maxTop}`);
      return miss;
    });

    for (const [name, offset] of [['refresh-before-video-top', -4], ['refresh-at-video-top', 0], ['refresh-after-video-top', 4]]) await feature(name, async () => {
      // 临界点（视频区顶部、日期行可见）：新一批不够高时 scrollTop 不能被夹上去、把顶部区块露出来
      await reset();
      await seed({ filters: filterOff });
      let i = 0;
      await page.route(/feed\/rcmd/, async (route) => {
        const items = Array.from({ length: 3 }, (_, k) => {
          const id = i * 3 + k;
          return { goto: 'av', bvid: 'BVsmoke' + String(id).padStart(8, '0'), cid: 2000 + id, title: `临界卡 ${id}`, pic: '', duration: 600, pubdate: 1760000000 + id, owner: { name: '映间编辑部', mid: 1, face: '' }, stat: { view: 10000, danmaku: 100 } };
        });
        i++;
        const origin = route.request().headers().origin || 'https://www.bilibili.com';
        await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' }, body: JSON.stringify({ code: 0, data: { item: items } }) });
      });
      try {
        await page.goto(HOME, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => (document.getElementById('margin-root')?.shadowRoot?.querySelectorAll('.grid .card:not(.sk)').length ?? 0) >= 8, null, { timeout: 15_000 });
        await sleep(500);
        const target = await page.evaluate((offset) => {
          const r = document.getElementById('margin-root').shadowRoot;
          const app = r.querySelector('.app'), bar = r.querySelector('.bar'), mark = r.querySelector('.bar-mark');
          const markTop = mark.getBoundingClientRect().top - app.getBoundingClientRect().top + app.scrollTop;
          app.scrollTop = Math.max(0, markTop - (parseFloat(getComputedStyle(bar).top) || 0) + offset);
          return app.scrollTop;
        }, offset);
        await sleep(400);
        const before = await page.evaluate(() => {
          const r = document.getElementById('margin-root').shadowRoot, app = r.querySelector('.app'), dash = r.querySelector('.dash');
          return { top: app.scrollTop, dashBottom: dash ? dash.getBoundingClientRect().bottom - app.getBoundingClientRect().top : 0 };
        });
        await page.evaluate(() => document.getElementById('margin-root').shadowRoot.querySelector('.ghost.refresh:not(.back)')?.click());
        await sleep(1200);
        const after = await page.evaluate(() => {
          const r = document.getElementById('margin-root').shadowRoot, app = r.querySelector('.app'), dash = r.querySelector('.dash');
          return { top: app.scrollTop, dashBottom: dash ? dash.getBoundingClientRect().bottom - app.getBoundingClientRect().top : 0, cards: r.querySelectorAll('.grid .card:not(.sk)').length };
        });
        const miss = [];
        if (target < 100) miss.push(`invalid scroll baseline: ${target}`);
        if (Math.abs(after.top - target) > 4) miss.push(`scroll clamped at video top: ${target.toFixed(1)} -> ${after.top}`);
        if (before.dashBottom <= 73 && after.dashBottom > 73) miss.push(`top blocks revealed: dash bottom ${after.dashBottom}`);
        if (after.cards < 8) miss.push(`too few cards after refresh: ${after.cards}`);
        return miss;
      } finally {
        await page.unroute(/feed\/rcmd/);
      }
    });

    await feature('extension-filters', async () => {
      await reset();
      await seed({ filters: { ...filterOff, keywords: ['芯片'] } });
      const miss = [];
      // 个人空间视频
      await page.goto('https://space.bilibili.com/2/video', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.getElementById('margin-root')?.shadowRoot?.querySelector('.grid .card:not(.sk)'), null, { timeout: 15_000 });
      await sleep(500);
      miss.push(...await page.evaluate(() => {
        const r = document.getElementById('margin-root')?.shadowRoot;
        const cards = [...r?.querySelectorAll('.grid .card:not(.sk)') ?? []];
        const titles = cards.filter((c) => !c.hasAttribute('data-margin-filtered')).map((c) => c.querySelector('.title')?.textContent ?? '');
        const out = [];
        if (!cards.length) out.push('space no cards');
        // v0.5x：进了 UP 主页就不再套用关键词 / 时长等全局过滤（只保留隐藏广告）
        if (!titles.some((t) => t.includes('芯片'))) out.push('space keyword card hidden (should be exempt)');
        if (cards.some((c) => c.hasAttribute('data-margin-filtered'))) out.push('space card filtered');
        return out;
      }));
      // 历史记录
      await page.goto('https://www.bilibili.com/account/history', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.getElementById('margin-root')?.shadowRoot?.querySelector('.hi-row:not(.sk)'), null, { timeout: 15_000 });
      await sleep(500);
      miss.push(...await page.evaluate(() => {
        const r = document.getElementById('margin-root')?.shadowRoot;
        const titles = [...r?.querySelectorAll('.hi-row:not([data-margin-filtered]) .hi-title') ?? []].map((e) => e.textContent ?? '');
        return titles.some((t) => t.includes('芯片')) ? ['history keyword row shown'] : [];
      }));
      // 动态首页的视频卡
      await page.goto('https://t.bilibili.com/', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.getElementById('margin-root')?.shadowRoot?.querySelector('.dy'), null, { timeout: 15_000 });
      await sleep(500);
      miss.push(...await page.evaluate(() => {
        const r = document.getElementById('margin-root')?.shadowRoot;
        const titles = [...r?.querySelectorAll('.dy:not([data-margin-filtered]) .dy-vtitle') ?? []].map((e) => e.textContent ?? '');
        return titles.some((t) => t.includes('芯片')) ? ['feed keyword card shown'] : [];
      }));
      return miss;
    });

    await feature('native-filter-search', async () => {
      await reset();
      await seed({ filters: { keywords: ['屏蔽词'], ups: ['坏UP'], minViews: 1000, minDuration: 0 } });
      await page.goto(SEARCH, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-margin-filtered="native"]', { state: 'attached', timeout: 12_000 }).catch(() => {});
      await sleep(400);
      const miss = await page.evaluate(() => {
        const q = (k) => document.querySelector(`[data-k="${k}"]`);
        const hidden = (el) => !!el && getComputedStyle(el).display === 'none';
        const m = [];
        if (!q('normal') || hidden(q('normal'))) m.push('normal hidden');
        if (!q('keyword') || !hidden(q('keyword'))) m.push('keyword not hidden');
        if (!q('up') || !hidden(q('up'))) m.push('UP not hidden');
        if (!q('low') || !hidden(q('low'))) m.push('low views not hidden');
        if (!q('missing') || hidden(q('missing'))) m.push('missing views should pass');
        if (!q('ad') || !hidden(q('ad'))) m.push('search ad not hidden');
        for (const k of ['normal', 'keyword', 'up', 'low', 'missing', 'ad']) if (!q(k)?.isConnected) m.push(`${k} removed from DOM`);
        return m;
      });
      // 清空过滤后原生卡片恢复，且节点没有被删除
      await seed({ filters: filterOff });
      await page.waitForFunction(() => !document.querySelector('[data-k="keyword"]')?.hasAttribute('data-margin-filtered'), null, { timeout: 8000 }).catch(() => {});
      await sleep(300);
      miss.push(...await page.evaluate(() => {
        const el = document.querySelector('[data-k="keyword"]');
        const m = [];
        if (!el?.isConnected) m.push('keyword removed');
        if (el && (el.hasAttribute('data-margin-filtered') || getComputedStyle(el).display === 'none')) m.push('keyword still hidden after clear');
        return m;
      }));
      return miss;
    });

    await feature('native-filter-popular', async () => {
      await reset();
      await seed({ filters: { ...filterOff, keywords: ['屏蔽词'] } });
      await page.goto(POPULAR, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-margin-filtered="native"]', { state: 'attached', timeout: 12_000 }).catch(() => {});
      await sleep(300);
      return page.evaluate(() => {
        const q = (k) => document.querySelector(`[data-k="${k}"]`);
        const hidden = (el) => !!el && getComputedStyle(el).display === 'none';
        const m = [];
        if (!q('normal') || hidden(q('normal'))) m.push('popular normal hidden');
        if (!q('keyword') || !hidden(q('keyword'))) m.push('popular keyword not hidden');
        return m;
      });
    });

    await feature('ads-toggle', async () => {
      await reset();
      await seed({ hideAds: true });
      await page.goto(SEARCH, { waitUntil: 'domcontentloaded' });
      await sleep(1200);
      const miss = await page.evaluate(() => {
        const el = document.querySelector('[data-k="ad"]');
        return el && getComputedStyle(el).display === 'none' ? [] : ['ad not hidden when hideAds=true'];
      });
      await seed({ hideAds: false });
      await page.waitForFunction(() => {
        const el = document.querySelector('[data-k="ad"]');
        return !!el && getComputedStyle(el).display !== 'none';
      }, null, { timeout: 8000 }).catch(() => {});
      miss.push(...await page.evaluate(() => {
        const el = document.querySelector('[data-k="ad"]');
        return el && getComputedStyle(el).display !== 'none' ? [] : ['ad still hidden when hideAds=false'];
      }));
      return miss;
    });

    await feature('ads-home-data', async () => {
      await reset();
      await seed({ hideAds: true });
      await page.goto(HOME, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.getElementById('margin-root')?.shadowRoot?.querySelector('.grid .card:not(.sk)'), null, { timeout: 15_000 });
      await sleep(600);
      const miss = await page.evaluate(() => {
        const r = document.getElementById('margin-root')?.shadowRoot;
        const titles = [...r?.querySelectorAll('.grid .card .title') ?? []].map((e) => e.textContent ?? '');
        return titles.some((t) => t.includes('广告推广视频')) ? ['data-level ad shown'] : [];
      });
      await seed({ hideAds: false });
      await page.waitForFunction(() => {
        const r = document.getElementById('margin-root')?.shadowRoot;
        return [...r?.querySelectorAll('.grid .card .title') ?? []].some((e) => (e.textContent ?? '').includes('广告推广视频'));
      }, null, { timeout: 8000 }).catch(() => {});
      miss.push(...await page.evaluate(() => {
        const r = document.getElementById('margin-root')?.shadowRoot;
        return [...r?.querySelectorAll('.grid .card .title') ?? []].some((e) => (e.textContent ?? '').includes('广告推广视频')) ? [] : ['data-level ad not revealed'];
      }));
      return miss;
    });

    await feature('reduced-motion', async () => {
      await reset();
      await seed({ reduceMotion: true });
      await page.goto(HOME, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.getElementById('margin-root')?.shadowRoot, null, { timeout: 15_000 });
      await page.waitForFunction(() => document.documentElement.classList.contains('margin-reduce'), null, { timeout: 8000 }).catch(() => {});
      await sleep(400);
      const miss = await page.evaluate(() => {
        const r = document.getElementById('margin-root')?.shadowRoot;
        const app = r?.querySelector('.app');
        const m = [];
        if (!document.documentElement.classList.contains('margin-reduce')) m.push('html class missing');
        if (!app?.classList.contains('margin-reduce')) m.push('shadow app class missing');
        const card = r?.querySelector('.grid .card:not(.sk)');
        if (card) {
          const d = parseFloat(getComputedStyle(card).animationDuration) || 0;
          if (d > 0.01) m.push(`card animation ${getComputedStyle(card).animationDuration}`);
        }
        return m;
      });
      await seed({ reduceMotion: false });
      await page.waitForFunction(() => !document.documentElement.classList.contains('margin-reduce'), null, { timeout: 8000 }).catch(() => {});
      miss.push(...await page.evaluate(() => document.documentElement.classList.contains('margin-reduce') ? ['class not removed'] : []));
      return miss;
    });

    await feature('message-remind', async () => {
      await reset();
      requests = [];
      await seed({ msgRemind: false });
      await page.goto(HOME, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3200);
      const miss = [];
      if (requests.some((u) => u.includes('msgfeed/unread') || u.includes('single_unread'))) miss.push('message unread still requested');
      if (requests.some((u) => u.includes('web-dynamic/v1/feed/all'))) miss.push('dynamic updates still requested');
      miss.push(...await page.evaluate(() => {
        const r = document.getElementById('margin-root')?.shadowRoot;
        const msg = [...r?.querySelectorAll('.et-btn') ?? []].find((b) => (b.getAttribute('aria-label') ?? '').startsWith('消息'));
        const dyn = [...r?.querySelectorAll('.et-btn') ?? []].find((b) => (b.getAttribute('aria-label') ?? '').startsWith('动态'));
        return [
          ...(msg?.querySelector('.et-badge') ? ['message badge still shown'] : []),
          ...(dyn?.querySelector('.et-badge') ? ['dynamic badge still shown'] : []),
        ];
      }));
      // 消息页自身仍要显示未读数（开关只控制主动提醒）
      requests = [];
      await page.goto(MESSAGE, { waitUntil: 'domcontentloaded' });
      // 未读数要等 /nav 返回后才请求；CI 上伪造接口偶尔要 2~3 秒才回 /nav，固定等 2.2s 会误报，改为等计数出现（最多 10s）
      await page.waitForFunction(() => {
        const r = document.getElementById('margin-root')?.shadowRoot;
        return [...r?.querySelectorAll('.ms-n') ?? []].some((n) => n.textContent?.trim());
      }, null, { timeout: 10_000 }).catch(() => {});
      if (!requests.some((u) => u.includes('msgfeed/unread') || u.includes('single_unread'))) miss.push('message page own unread not requested');
      miss.push(...await page.evaluate(() => {
        const r = document.getElementById('margin-root')?.shadowRoot;
        const counts = [...r?.querySelectorAll('.ms-n') ?? []].map((n) => n.textContent?.trim()).filter(Boolean);
        return counts.length ? [] : ['message page counts empty'];
      }));
      return miss;
    });

    await feature('watch-body-not-ready', async () => {
      await reset();
      await page.goto(WATCH, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.getElementById('margin-watch-top')?.shadowRoot?.querySelector('header'), null, { timeout: 15_000 });
      errors = [];
      // document_start 时 body 可能尚未创建；移除后等播放器状态轮询跑过，再恢复同一个 body。
      await page.evaluate(() => {
        window.__marginTestBody = document.body;
        document.body.remove();
      });
      await sleep(1150);
      await page.evaluate(() => {
        if (window.__marginTestBody) document.documentElement.append(window.__marginTestBody);
        delete window.__marginTestBody;
      });
      await page.waitForFunction(() => document.body && document.getElementById('margin-watch-top')?.hidden === false, null, { timeout: 3000 }).catch(() => {});
      if (!await page.evaluate(() => !!document.body && document.getElementById('margin-watch-top')?.hidden === false)) errors.push('watch did not recover after body insertion');
      return errors;
    });

    await feature('live-web-fullscreen', async () => {
      await reset();
      await page.goto('https://live.bilibili.com/2790818', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.getElementById('margin-watch-top')?.hidden === false, null, { timeout: 15_000 });
      await page.evaluate(() => document.body.classList.add('player-full-win', 'over-hidden', 'hide-aside-area'));
      await page.waitForFunction(() => document.getElementById('margin-watch-top')?.hidden === true, null, { timeout: 3000 }).catch(() => {});
      const m = await page.evaluate(() => {
        const miss = [];
        if (document.getElementById('margin-watch-top')?.hidden !== true) miss.push('top bar still covers the web-fullscreen player');
        if (!document.documentElement.classList.contains('margin-webscreen')) miss.push('web-fullscreen state missing');
        return miss;
      });
      await page.evaluate(() => document.body.classList.remove('player-full-win', 'over-hidden', 'hide-aside-area'));
      await page.waitForFunction(() => document.getElementById('margin-watch-top')?.hidden === false, null, { timeout: 3000 }).catch(() => {});
      m.push(...await page.evaluate(() => {
        const miss = [];
        if (document.getElementById('margin-watch-top')?.hidden !== false) miss.push('top bar did not return after leaving web fullscreen');
        if (document.documentElement.classList.contains('margin-webscreen')) miss.push('web-fullscreen state did not clear');
        return miss;
      }));
      return m;
    });

    await feature('live-native-sidebar', async () => {
      await reset();
      await page.goto('https://live.bilibili.com/2790818', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => {
        const el = document.querySelector('#sidebar-vm .side-bar-cntr');
        return el && getComputedStyle(el).display === 'none' && document.getElementById('margin-watch-top')?.shadowRoot?.querySelector('.sr');
      }, null, { timeout: 15_000 }).catch(() => {});
      return page.evaluate(() => {
        const miss = [];
        const bar = document.querySelector('#sidebar-vm .side-bar-cntr');
        if (!bar) miss.push('native sidebar fixture missing');
        else if (getComputedStyle(bar).display !== 'none') miss.push('native sidebar still overlaps the scroll ruler');
        if (!document.getElementById('margin-watch-top')?.shadowRoot?.querySelector('.sr')) miss.push('scroll ruler missing');
        return miss;
      });
    });

    await feature('live-dark-rank-contrast', async () => {
      await reset();
      await seed({ theme: 'dark' });
      await page.goto('https://live.bilibili.com/2790818', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => getComputedStyle(document.querySelector('.rank-list-ctnr .name')).color === 'rgb(237, 237, 238)', null, { timeout: 15_000 }).catch(() => {});
      const m = await page.evaluate(() => {
        const miss = [];
        const cases = [
          ['.top3-name', 'rgb(237, 237, 238)'], ['.name', 'rgb(237, 237, 238)'], ['.tab-item.active', 'rgb(237, 237, 238)'],
          ['.rank', 'rgb(176, 177, 182)'], ['.score', 'rgb(176, 177, 182)'],
          ['.tab-item.opacity6', 'rgb(176, 177, 182)'], ['.sub-tab-item-text.opacity6', 'rgb(176, 177, 182)'],
        ];
        for (const [selector, expected] of cases) {
          const el = document.querySelector(`.rank-list-ctnr ${selector}`);
          if (!el) { miss.push(`${selector} missing`); continue; }
          const style = getComputedStyle(el);
          if (style.color !== expected) miss.push(`${selector} color ${style.color}`);
          if (style.opacity !== '1') miss.push(`${selector} opacity ${style.opacity}`);
        }
        const active = document.querySelector('.rank-list-ctnr .sub-tab-item-text:not(.opacity6)');
        if (getComputedStyle(active).color !== 'rgb(255, 102, 153)') miss.push('active rank accent overwritten');
        return miss;
      });
      await reset();
      return m;
    });

    await feature('live-dark-panels', async () => {
      await reset();
      await seed({ theme: 'dark' });
      await page.goto('https://live.bilibili.com/2790818', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => getComputedStyle(document.querySelector('.gift-sender-panel')).backgroundColor === 'rgb(26, 26, 28)', null, { timeout: 15_000 }).catch(() => {});
      await page.hover('.danmaku-menu .go-space');
      const m = await page.evaluate(() => {
        const miss = [];
        const cases = [
          ['.gift-label', 'color', 'rgb(237, 237, 238)'], ['.panel-price', 'color', 'rgb(176, 177, 182)'],
          ['.gift-item.mouse-in', 'backgroundColor', 'rgba(255, 255, 255, 0.06)'],
          ['.gift-panel-switch', 'backgroundColor', 'rgba(255, 255, 255, 0.06)'], ['.gift-panel-switch svg path', 'fill', 'rgb(237, 237, 238)'],
          ['.guard-info .title', 'color', 'rgb(237, 237, 238)'], ['.balance-info .title', 'color', 'rgb(237, 237, 238)'],
          ['.gift-sender-panel', 'backgroundColor', 'rgb(26, 26, 28)'], ['.gift-sender-panel', 'borderRadius', '16px'],
          ['.gift-banner-root', 'borderRadius', '12px'], ['.gift-banner-root .arrow', 'color', 'rgb(237, 237, 238)'],
          ['.banner-title span', 'color', 'rgb(237, 237, 238)'], ['.banner-subtitle span', 'color', 'rgb(176, 177, 182)'],
          ['.feed-bar-section', 'backgroundColor', 'rgba(0, 0, 0, 0)'], ['.feed-button-root .text span', 'color', 'rgb(237, 237, 238)'],
          ['.feed-button-root .content-box', 'backgroundColor', 'rgba(255, 255, 255, 0.06)'], ['.feed-button-root .content-box', 'borderRadius', '999px'],
          ['.gift-upgrade-item.selected', 'borderRadius', '12px'], ['.gift-upgrade-item.selected .gift-icon', 'borderWidth', '0px'],
          ['.gift-upgrade-item:not(.selected)', 'backgroundColor', 'rgba(255, 255, 255, 0.06)'], ['.gift-upgrade-item:not(.selected)', 'borderColor', 'rgba(0, 0, 0, 0)'], ['.gift-upgrade-item:not(.selected)', 'borderRadius', '12px'],
          ['.gift-upgrade-item.selected .gift-title', 'color', 'rgb(255, 140, 176)'], ['.gift-upgrade-item:not(.selected) .gift-title', 'color', 'rgb(237, 237, 238)'],
          ['.gift-upgrade-item.selected .gift-desc span', 'color', 'rgb(255, 140, 176)'], ['.gift-upgrade-item:not(.selected) .gift-desc span', 'color', 'rgb(176, 177, 182)'],
          ['.official-container-root .gift-panel-background', 'backgroundColor', 'rgb(26, 26, 28)'], ['.official-container-root .gift-panel-background', 'borderRadius', '16px'],
          ['.official-container-root .single-tab.active .tab-name', 'color', 'rgb(255, 140, 176)'], ['.official-container-root .single-tab:not(.active) .tab-name', 'color', 'rgb(176, 177, 182)'],
          ['.official-container-root .rights-center-btn', 'backgroundColor', 'rgba(255, 255, 255, 0.06)'], ['.official-container-root .rights-txt', 'color', 'rgb(237, 237, 238)'],
          ['.official-container-root .close-btn', 'backgroundColor', 'rgba(255, 255, 255, 0.06)'], ['.official-container-root .gift-rearrange-root svg path', 'fill', 'rgb(176, 177, 182)'],
          ['.official-container-root .gift-label', 'color', 'rgb(237, 237, 238)'], ['.official-container-root .panel-price', 'color', 'rgb(176, 177, 182)'],
          ['.official-container-root .gift-item.mouse-in', 'backgroundColor', 'rgba(255, 255, 255, 0.06)'], ['.official-container-root .gift-item.mouse-in', 'borderRadius', '12px'],
          ['.danmaku-menu', 'borderRadius', '12px'], ['.danmaku-menu .go-space', 'backgroundColor', 'rgba(255, 255, 255, 0.06)'],
          ['.danmaku-menu .go-space', 'borderRadius', '8px'], ['.danmaku-menu .go-space .clickable span', 'color', 'rgb(237, 237, 238)'],
          ['.danmaku-menu .at-this-guy .clickable span', 'color', 'rgb(237, 237, 238)'], ['.danmaku-menu .block-this-guy .clickable span', 'color', 'rgb(237, 237, 238)'],
          ['.danmaku-menu .report-this-guy .clickable span', 'color', 'rgb(237, 237, 238)'],
          ['.blockSetting', 'backgroundColor', 'rgb(26, 26, 28)'], ['.blockSetting .keyword-input', 'color', 'rgb(237, 237, 238)'],
          ['.blockSetting .keyword-submit-btn:disabled', 'backgroundColor', 'rgba(255, 255, 255, 0.06)'],
          ['.blockSetting .keyword-submit-btn .txt', 'color', 'rgb(138, 139, 144)'],
          ['.blockSetting .list-content', 'backgroundColor', 'rgba(255, 255, 255, 0.06)'],
          ['.blockSetting .block-list-ctnr', 'backgroundColor', 'rgba(0, 0, 0, 0)'],
          ['.blockSetting .tab-item.active', 'color', 'rgb(255, 140, 176)'],
        ];
        for (const [selector, property, expected] of cases) {
          const el = document.querySelector(selector);
          if (!el) { miss.push(`${selector} missing`); continue; }
          const actual = getComputedStyle(el)[property];
          if (actual !== expected) miss.push(`${selector} ${property} ${actual}`);
        }
        const input = document.querySelector('.blockSetting .keyword-input');
        if (getComputedStyle(input, '::placeholder').color !== 'rgb(176, 177, 182)') miss.push('keyword placeholder contrast');
        if (getComputedStyle(document.querySelector('.blockSetting .list-content')).borderRadius !== '12px') miss.push('block list radius');
        const button = document.querySelector('.blockSetting .keyword-submit-btn');
        button.disabled = false;
        if (getComputedStyle(button).backgroundColor !== 'rgb(237, 237, 238)') miss.push('enabled keyword button background');
        if (getComputedStyle(button.querySelector('.txt')).color !== 'rgb(17, 17, 18)') miss.push('enabled keyword button text');
        return miss;
      });
      await reset();
      return m;
    });

    await feature('wide-mode', async () => {
      await reset();
      await seed({ wide: true });
      await page.goto(WATCH, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.documentElement.classList.contains('margin-wide') &&
        document.querySelector('.bpx-player-container')?.getAttribute('data-screen') === 'wide', null, { timeout: 12_000 }).catch(() => {});
      const miss = await page.evaluate(() => {
        const m = [];
        if (!document.documentElement.classList.contains('margin-wide')) m.push('margin-wide missing');
        if (document.querySelector('.bpx-player-container')?.getAttribute('data-screen') !== 'wide') m.push('player not wide');
        return m;
      });
      await seed({ wide: false });
      await page.goto(WATCH, { waitUntil: 'domcontentloaded' });
      await sleep(2500);
      miss.push(...await page.evaluate(() => {
        const m = [];
        if (document.documentElement.classList.contains('margin-wide')) m.push('margin-wide still present');
        if (document.querySelector('.bpx-player-container')?.getAttribute('data-screen') !== 'normal') m.push('player auto-widened');
        return m;
      }));
      return miss;
    });

    await feature('refresh-other-tabs', async () => {
      await reset(); await seed({ filters: filterOff });
      await page.goto(HOME, { waitUntil: 'domcontentloaded' });
      await page.locator('#margin-root .home-grid .card:not(.sk)').first().waitFor();
      const oldArc = (u) => {
        const body = apiBody(u);
        if (u.includes('/arc/search')) {
          const mid = new URL(u).searchParams.get('mid');
          body.data.list.vlist = body.data.list.vlist.map((v, i) => ({ ...v, bvid: `BVclassic${mid}${i}`, created: 1600000000 }));
        }
        return body;
      };
      const miss = [];
      for (const tab of ['popular', 'classic']) {
        mockOverride = oldArc;
        await page.locator(`#margin-root .tab[data-tab="${tab}"]`).click();
        await page.waitForFunction(() => document.getElementById('margin-root').shadowRoot.querySelectorAll('.home-grid .card:not(.sk)').length >= 8);
        await sleep(800);
        mockOverride = async (u) => { if (u.includes('/popular') || u.includes('/arc/search')) await sleep(1000); return oldArc(u); };
        const count = await page.evaluate(() => new Promise((resolve) => {
          const r = document.getElementById('margin-root').shadowRoot;
          let min = Infinity;
          const timer = setInterval(() => { min = Math.min(min, r.querySelectorAll('.home-grid .card:not(.sk)').length); }, 16);
          r.querySelector('.ghost.refresh:not(.back)').click();
          setTimeout(() => { clearInterval(timer); resolve(min); }, 500);
        }));
        if (count < 1) miss.push(`${tab} emptied cards while refreshing`);
        await page.waitForFunction(() => !document.getElementById('margin-root').shadowRoot.querySelector('.refresh[aria-busy="true"]'));
      }
      return miss;
    });

    await feature('refresh-zoom', async () => {
      await reset(); await seed({ zoom: 120, filters: filterOff });
      await page.goto(HOME, { waitUntil: 'domcontentloaded' });
      await page.locator('#margin-root .home-grid .card:not(.sk)').first().waitFor(); await sleep(600);
      await page.evaluate(() => { document.getElementById('margin-root').shadowRoot.querySelector('.app').scrollTop=700; });
      await sleep(600);
      // 用真实坐标点击，避免定位器给 CSS zoom 下的 sticky 控件自动滚动父容器。
      const hit=await page.locator('#margin-root .ghost.refresh:not(.back)').boundingBox();
      if(!hit)throw new Error('zoomed refresh control missing');
      await page.mouse.click(hit.x+hit.width/2,hit.y+hit.height/2);
      await page.waitForFunction(() => !document.getElementById('margin-root').shadowRoot.querySelector('.refresh[aria-busy="true"]'));
      await sleep(500);
      return page.evaluate(() => {
        const r = document.getElementById('margin-root').shadowRoot;
        const bar = r.querySelector('.bar').getBoundingClientRect();
        const card = r.querySelector('.home-grid .card:not(.sk)').getBoundingClientRect();
        return Math.abs(bar.top - 72) <= 2 && card.top >= bar.bottom - 2 && card.top < innerHeight / 2 ? [] : [`zoomed refresh misplaced: bar=${bar.top}, first=${card.top}`];
      });
    });

    await feature('refresh-failure-keeps-list', async () => {
      await reset(); await seed({ filters: filterOff, rerank: false, appFeed: false });
      await page.goto(HOME, { waitUntil: 'domcontentloaded' });
      const cards = page.locator('#margin-root .home-grid .card:not(.sk) .title');
      await cards.first().waitFor(); await sleep(700);
      const before = await cards.allTextContents();
      const failedFeed = /\/index\/top\/feed\/rcmd\?/;
      mockOverride = (u) => failedFeed.test(u) ? { code: -1, message: '测试失败' } : null;
      try {
        await page.locator('#margin-root .ghost.refresh:not(.back)').click();
        await page.waitForFunction(() => document.getElementById('margin-root').shadowRoot.textContent.includes('换一批失败'), null, { timeout: 8000 });
        const after = await cards.allTextContents();
        const miss = [];
        if (JSON.stringify(before) !== JSON.stringify(after)) miss.push('failed refresh changed old cards');
        if (await page.locator('#margin-root .refresh[aria-busy="true"]').count()) miss.push('refresh still busy after failure');
        return miss;
      } finally { mockOverride = null; }
    });

    await feature('dynamic-inline', async () => {
      await reset();
      await page.goto('https://t.bilibili.com/', { waitUntil: 'domcontentloaded' });
      const root = page.locator('#margin-root');
      await root.locator('.fd-list .dy-text .dy-emoji').first().waitFor({ timeout: 8000 });
      const before = ctx.pages().length;
      const card = root.locator('.fd-list > .dy').first();
      const comment = card.getByRole('button', { name: /^评论/ });
      await comment.click();
      await card.locator('.dy-r').first().waitFor({ timeout: 8000 });
      const miss = [];
      const replies = await card.locator('.dy-r').allTextContents();
      if (!replies[0]?.includes('置顶评论') || !replies[1]?.includes('热门评论')) miss.push('pinned / hot reply order wrong');
      if (await card.locator('.dy-r').first().locator('.dy-emoji').count() !== 1) miss.push('comment emoji missing');
      if (!requests.some((u) => u.includes('web-dynamic/v1/detail'))) miss.push('missing comment metadata was not resolved');
      if (ctx.pages().length !== before) miss.push('inline comments opened a new tab');
      await comment.click();
      if (await card.locator('.dy-cbox').count()) miss.push('comments did not collapse');
      const broken = root.locator('.fd-list .dy-text .dy-emoji').first();
      await broken.evaluate((el) => el.dispatchEvent(new Event('error')));
      if (!(await root.locator('.fd-list .dy-text').allTextContents()).some((t) => t.includes('[开心]'))) miss.push('failed emoji did not restore text');
      // 查详情失败时保持页内状态和外部入口，不允许发布到未知评论区。
      mockOverride = (u) => u.includes('web-dynamic/v1/detail?') ? { code: -101, message: '未登录' } : null;
      try {
        const other = root.locator('.fd-list > .dy').nth(1);
        await other.getByRole('button', { name: /^评论/ }).click();
        await other.locator('.dy-rempty').filter({ hasText: '评论加载失败' }).waitFor({ timeout: 8000 });
        if (!(await other.locator('.dy-rall').count())) miss.push('fallback link missing');
        if (!(await other.getByRole('button', { name: '发布', exact: true }).isDisabled())) miss.push('posting enabled without comment target');
      } finally { mockOverride = null; }
      return miss;
    });

    await feature('wide-sidebar-late', async () => {
      await reset(); await seed({ wide: true });
      await page.goto(WATCH, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.documentElement.classList.contains('margin-wide'), null, { timeout: 12000 });
      // 原生合集侧栏晚于播放器挂载：整个过程不滚动，也不改变播放器尺寸。
      await page.evaluate(() => document.querySelector('.right-container')?.remove());
      await sleep(200);
      await page.evaluate(() => {
        const parent = document.querySelector('.video-container-v1');
        parent.style.position = 'relative'; parent.style.minHeight = '1800px';
        const side = document.createElement('div'); side.className = 'right-container';
        side.style.cssText = 'position:absolute;top:0;right:0;width:320px';
        const list = document.createElement('div'); list.className = 'video-pod'; list.textContent = '合集播放列表';
        list.style.margin = '0'; side.append(list); parent.append(side);
      });
      const gap = () => page.evaluate(() => document.querySelector('.right-container .video-pod').getBoundingClientRect().top - document.querySelector('.bpx-player-container').getBoundingClientRect().bottom);
      await page.waitForFunction(() => {
        const gap = document.querySelector('.right-container .video-pod').getBoundingClientRect().top - document.querySelector('.bpx-player-container').getBoundingClientRect().bottom;
        return Math.abs(gap - 16) < 2;
      }, null, { timeout: 3000 }).catch(() => {});
      const miss = [];
      const before = await gap();
      if (Math.abs(before - 16) >= 2) miss.push(`late sidebar was not positioned: gap=${before}`);
      // 用户滚动不应成为定位生效的触发条件，也不能改变播放器和侧栏之间的距离。
      await page.evaluate(() => scrollTo(0, 200)); await sleep(200);
      if (Math.abs((await gap()) - before) > 4) miss.push('sidebar jumped after scrolling');
      await page.evaluate(() => document.querySelector('.bpx-player-container').setAttribute('data-screen', 'normal'));
      await page.waitForFunction(() => !document.documentElement.classList.contains('margin-wide'));
      if (await page.evaluate(() => document.documentElement.style.getPropertyValue('--m-wide-pad') !== '')) miss.push('wide padding was not cleared');
      return miss;
    });

    await reset();
  }

  // 模块挂载失败时回到原版：用调试钩子 margin:test-throw 让模块故意抛错
  if (theme === THEMES[0] && !ONLY) for (const [name, url, key] of [
    ['fallback-home', 'https://www.bilibili.com/', 'home'],
    ['fallback-watch', 'https://www.bilibili.com/video/BV1mdxN68E7F/', 'watch'],
    ['fallback-space', 'https://space.bilibili.com/2/video', 'space'],
  ]) {
    errors = [];
    let miss = [];
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.evaluate((k) => localStorage.setItem('margin:test-throw', k), key);
      await page.goto(url, { waitUntil: 'load' });
      await sleep(2500);
      miss = await page.evaluate(() => {
        const m = [];
        for (const id of ['margin-root', 'margin-watch-top', 'margin-hide', 'margin-watch-css']) if (document.getElementById(id)) m.push(`#${id} still present`);
        if (document.documentElement.classList.contains('margin-skin')) m.push('html.margin-skin still present');
        if (!document.body || getComputedStyle(document.body).display === 'none') m.push('native body hidden');
        localStorage.removeItem('margin:test-throw');
        return m;
      });
    } catch (e) { miss = [`goto: ${e.message}`]; }
    const expected = errors.filter((e) => e.includes('test-throw'));
    const unexpected = errors.filter((e) => !e.includes('test-throw'));
    if (!expected.length) miss.push('no [MARGIN] mount-failure log');
    const ok = !miss.length && !unexpected.length;
    if (!ok) failed++;
    results.push({ theme, name, ok, miss, errors: unexpected });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${theme.padEnd(5)} ${name.padEnd(15)}${miss.length ? ` problems: ${miss.join(', ')}` : ' native page restored'}${unexpected.length ? `\n      errors: ${unexpected.join('\n              ')}` : ''}`);
  }

  // 足迹热力图：不到 60 秒的日子不点亮；没有本机记录的日子用历史估算，提示里标明来源
  if (sw && theme === THEMES[0] && (!ONLY || ONLY.includes('home'))) {
    let miss = [];
    try {
      await sw.evaluate(async () => {
        const p = (n) => String(n).padStart(2, '0'), k = (d) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
        const a = {}, ago = (i) => { const d = new Date(); d.setDate(d.getDate() - i); return k(d); };
        a[ago(2)] = { s: 1800, f: '08:30' }; a[ago(3)] = { s: 30, f: '09:00' }; a[ago(4)] = { s: 0, h: 1200, hf: '21:00' };
        await chrome.storage.local.set({ 'margin:activity': a, 'margin:activity-bf': Date.now() });
      });
      await page.goto('https://www.bilibili.com/', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.getElementById('margin-root')?.shadowRoot?.querySelector('.fp-cells .fp-cell'), null, { timeout: 15000 });
      await sleep(800);
      miss = await page.evaluate(() => {
        const r = document.getElementById('margin-root').shadowRoot, m = [];
        const p = (n) => String(n).padStart(2, '0'), ago = (i) => { const d = new Date(); d.setDate(d.getDate() - i); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
        const cell = (i) => r.querySelector(`.fp-cell[data-k="${ago(i)}"]`);
        if (cell(3)?.dataset.l !== '0') m.push('30s day should not light');
        if (cell(2)?.dataset.l === '0') m.push('30min local day should light');
        if (cell(4)?.dataset.l === '0') m.push('history-only day should light');
        const tip = (i) => { cell(i).dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); return r.querySelector('.fp-tip').textContent; };
        if (!tip(2).includes('本机记录')) m.push('tooltip local source');
        if (!tip(4).includes('历史估算')) m.push('tooltip history source');
        return m;
      });
    } catch (e) { miss = [`footprint-ui: ${e.message}`]; }
    const ok = !miss.length;
    if (!ok) failed++;
    results.push({ theme, name: 'footprint-ui', ok, miss });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${theme.padEnd(5)} footprint-ui${miss.length ? ` problems: ${miss.join(', ')}` : ' 60s threshold + source tooltip'}`);
  }

  // 足迹计时在后台 service worker：打开过页面后今天应该有首次打开时间
  if (sw) {
    const today = await sw.evaluate(async () => {
      const d = new Date(), p = (n) => String(n).padStart(2, '0');
      const k = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      return (await chrome.storage.local.get('margin:activity'))['margin:activity']?.[k] ?? null;
    }).catch((e) => ({ error: e.message }));
    const ok = !!today?.f;
    if (!ok) failed++;
    results.push({ theme, name: 'footprint-sw', ok, today });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${theme.padEnd(5)} footprint service worker recorded first open: ${JSON.stringify(today)}`);
  } else {
    failed++;
    results.push({ theme, name: 'service-worker', ok: false });
    console.log(`FAIL ${theme} background service worker not running`);
  }
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
}

writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
console.log(failed ? `\n${failed} check(s) failed` : '\nall smoke checks passed');
process.exit(failed ? 1 : 0);
