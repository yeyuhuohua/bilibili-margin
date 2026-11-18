import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installMocks } from './mocks.mjs';

const ext = resolve(process.env.SMOKE_EXT || 'dist');
const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/vote-theme');
mkdirSync(out, { recursive: true });
const results = [], errors = [];
// The native H5 vote page has its own white #bp-app and a white button reset.
// Scoped result selectors and theme classes match vote.addea78b.css.
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#fff;color:#18191c;font:14px/1.5 system-ui}
#bp-app{max-width:600px;margin:auto;background:#fff;min-height:100vh;overflow:hidden}
#bp-app.light #app{background:#fff}#bp-app.dark--story,#bp-app.dark--story #app{background:#18191c;color:#c9ccd0}
.vote{padding:24px}.vote-title{font-size:24px;color:var(--text1,#18191c)}.vote-info{color:var(--text2,#61666d)}
.desc-title[data-v-7e028a06]{color:#61666d}.option-li[data-v-7e028a06]{position:relative;display:flex;align-items:center;height:52px;margin:12px 0;border:1px solid var(--line_light,#eee);background:var(--graph_bg_thin,#eee);border-radius:6px;overflow:hidden}
button{background:#fff;border:0;padding:0}.percentage-bar[data-v-7e028a06]{position:absolute;top:0;left:0;height:100%}
.option-text,.vote-percentage{position:relative;z-index:1;color:var(--text1,#18191c);pointer-events:none}.option-text{padding-left:14px}.vote-percentage{margin-left:auto;padding-right:14px}
.is-web .is-max .option-text,.is-web .is-max .vote-percentage{color:var(--brand_blue,#00aeec)}
.is-upower .is-max .option-text,.is-upower .is-max .vote-percentage{color:var(--brand_pink,#fb7299)!important}
.desc{color:#212121}.vote-extra{height:580px}#unrelated{background:#fff;color:#17181a}
</style></head><body><div id="bp-app" class="light"><div id="app"><section class="vote is-web is-upower">
<h1 class="vote-title">你更喜欢哪种设计？</h1><p class="vote-info">映间编辑部 发起 · 1897847 人参与</p>
<h2 class="desc-title" data-v-7e028a06>投票选项</h2><div class="options-list voted">
${[47,7,46].map((n,i)=>`<div class="option-li ${i===0?'is-max':''}" data-v-7e028a06><button type="button" aria-label="选择方案${i+1}" class="percentage-bar ${i===0?'is-max':''}" data-v-7e028a06 style="width:${n}%"></button><span class="option-text">方案${i+1}</span><span class="vote-percentage">${n}%</span></div>`).join('')}
</div><p class="desc">投票结束后展示结果</p><div class="vote-extra"></div></section></div></div>
<button id="unrelated">普通原站按钮</button><script>window.voteClicks=0;window.frameState='retained';document.querySelector('.percentage-bar').onclick=()=>window.voteClicks++;</script>
</body></html>`;
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-vote-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, viewport: { width: 1280, height: 1000 },
  args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
try {
  await installMocks(ctx);
  await ctx.route(/https:\/\/(?:t|www)\.bilibili\.com\/vote\/h5\/index\//, route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
  const worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  const inspect = async () => page.evaluate(() => {
    const style = sel => { const s=getComputedStyle(document.querySelector(sel)); return { bg:s.backgroundColor,color:s.color }; };
    return { root:style('#bp-app'),title:style('.vote-title'),label:style('.option-li:not(.is-max) .option-text'),
      bar:style('.option-li:not(.is-max) .percentage-bar'),track:style('.option-li:not(.is-max)'),desc:style('.desc'),
      widths:[...document.querySelectorAll('.percentage-bar')].map(e=>e.style.width),unrelated:style('#unrelated'),
      count:document.querySelectorAll('#bp-app').length,state:window.frameState };
  });
  for (const host of ['t', 'www']) {
    await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': { theme:'dark',intro:false,bg:{mode:'off'} } }));
    await page.goto(`https://${host}.bilibili.com/vote/h5/index/?theme_blue=1#/result?vote_id=1&dynamic_id=900001&isWeb=1`);
    await page.locator('#margin-watch-top .top').waitFor();
    await page.locator('html[data-margin-theme="dark"]').waitFor({state:'attached'});
    const initial=await inspect();results.push({host,theme:'dark',...initial});
    await page.screenshot({path:join(out,`${host}-dark.png`),fullPage:true});
    assert.equal(initial.root.bg,'rgb(26, 26, 28)','native vote root stays white in dark mode');
    assert.equal(initial.label.color,'rgb(237, 237, 238)');
    assert.notEqual(initial.bar.bg,'rgb(255, 255, 255)','native button reset leaves a white progress bar');
    assert.equal(initial.desc.color,'rgb(176, 177, 182)');
    await page.locator('.percentage-bar').first().click({position:{x:5,y:5}});
    assert.equal(await page.evaluate(()=>window.voteClicks),1,'native click handler changed');
    for (const theme of ['light','dark','light']) {
      await worker.evaluate(theme=>chrome.storage.local.set({'margin:settings':{theme,intro:false,bg:{mode:'off'}}}),theme);
      await page.locator(`html[data-margin-theme="${theme}"]`).waitFor({state:'attached'});
      // A late native stylesheet must not restore the hard-coded white panel.
      await page.evaluate(()=>{const s=document.createElement('style');s.textContent='#bp-app{background:#fff}button{background:#fff}';document.head.append(s);});
      const current=await inspect();results.push({host,theme,...current});
      assert.equal(current.root.bg,theme==='dark'?'rgb(26, 26, 28)':'rgb(255, 255, 255)');
      assert.equal(current.label.color,theme==='dark'?'rgb(237, 237, 238)':'rgb(23, 24, 26)');
      assert.deepEqual(current.widths,['47%','7%','46%']);
      assert.equal(current.state,'retained');assert.equal(current.count,1);
      assert.equal(current.unrelated.bg,'rgb(255, 255, 255)','unrelated native buttons must not be recolored');
      await page.screenshot({path:join(out,`${host}-${theme}.png`),fullPage:true});
    }
    await page.evaluate(()=>document.querySelector('.vote').classList.remove('is-upower'));
    assert.equal(await page.locator('.is-max .option-text').evaluate(e=>getComputedStyle(e).color),'rgb(0, 137, 192)','ordinary votes retain the theme link accent');
    await page.emulateMedia({colorScheme:'dark'});
    await worker.evaluate(()=>chrome.storage.local.set({'margin:settings':{theme:'auto',intro:false,bg:{mode:'off'}}}));
    await page.locator('html[data-margin-theme="dark"]').waitFor({state:'attached'});
    assert.equal((await inspect()).root.bg,'rgb(26, 26, 28)');
    await page.emulateMedia({colorScheme:'light'});
    await page.locator('html[data-margin-theme="light"]').waitFor({state:'attached'});
    assert.equal((await inspect()).root.bg,'rgb(255, 255, 255)');
    results.push({host,automaticThemeSwitch:true,nativeVoteClicks:await page.evaluate(()=>window.voteClicks)});
  }
  assert.deepEqual(errors,[]);
  console.log('PASS vote themes on both hosts, live switching, late CSS, native clicks and progress values');
} finally {
  writeFileSync(join(out,'results.json'),JSON.stringify({results,errors},null,2));
  await ctx.close();
}
