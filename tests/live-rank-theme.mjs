import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installMocks } from './mocks.mjs';

const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/live-rank-theme');
mkdirSync(out, { recursive: true });
const extension = resolve(process.env.SMOKE_EXT || 'dist'), results = [], errors = [];
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-rank-theme-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  viewport: { width: 1440, height: 900 }, locale: 'zh-CN',
});
const luminance = value => {
  const rgb = value.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
};
try {
  await installMocks(context);
  await context.route('https://live.bilibili.com/3', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html><head><meta charset="utf-8"><style>
    :root{--Ga9:#18191c;--Ga0:#f6f7f8;--Ga2:#e3e5e7;--text_white:#fff}body{margin:0}
    .app-body{display:grid;grid-template-columns:1fr 360px;gap:24px;margin:50px auto;width:1200px;padding-top:80px}
    #player-ctnr{height:540px;background:#000}#rank-list-vm{height:300px}#rank-list-ctnr-box{padding:16px}
    .tabs .tab-list{display:flex;gap:24px;padding-bottom:18px}.tabs .tab-list .item{color:var(--text3)}.tabs .tab-list .item.active{color:var(--Ga9)}
    .tabs.isThousand .item{color:var(--text_white)!important}.tabs.isThousand .item.active{color:#ffe9bd!important}
    .gift-rank-list-item{display:flex;gap:16px;align-items:center;height:44px;color:var(--Ga9)}.score{margin-left:auto}
    .guard-rank-cntr.thousand .list .item .uname .live-skin-main-a-text{color:var(--text_white)!important}
    .own{padding:10px;background:var(--Ga0);color:var(--Ga9)}.fans-medal{color:white;background:#a11a50;border-radius:3px;padding:2px 4px}
  </style></head><body><main class="app-body"><div id="player-ctnr"><video></video><div class="danmaku-test" style="color:rgb(255,255,0)">播放器弹幕</div></div><aside id="aside-area-vm">
    <section id="rank-list-vm" class="rank-list-section"><div id="rank-list-ctnr-box" class="rank-list-ctnr">
      <div class="tabs"><div class="tab-list"><span class="item active">高能榜</span><span class="item">大航海</span></div></div>
      <div class="rank-list-content guard-rank-cntr"><div class="list"><div class="item gift-rank-list-item"><span class="rank">1</span><span class="fans-medal">粉丝牌</span><span class="uname name"><a class="live-skin-main-a-text" href="https://space.bilibili.com/1">排行榜用户</a></span><span class="score">1280</span></div></div></div>
      <div class="own">我的排名</div>
    </div></section><div class="chat-history-panel">聊天区</div></aside></main></body></html>` }));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  for (const theme of ['dark', 'light']) {
    await worker.evaluate(theme => chrome.storage.local.set({ 'margin:settings': { intro: false, theme, bg: { mode: 'off' } } }), theme);
    await page.goto('https://live.bilibili.com/3');
    await page.locator('#margin-watch-top .top').waitFor();
    for (const skin of [false, true]) {
      await page.evaluate(skin => {
        document.querySelector('.tabs').classList.toggle('isThousand', skin);
        document.querySelector('.guard-rank-cntr').classList.toggle('thousand', skin);
        document.querySelector('#rank-list-ctnr-box').style.backgroundImage = skin ? 'linear-gradient(#ddd,#ccc)' : 'none';
      }, skin);
      const values = await page.evaluate(() => {
        const css = sel => getComputedStyle(document.querySelector(sel));
        return { background: css('.rank-list-ctnr').backgroundColor, image: css('.rank-list-ctnr').backgroundImage,
          texts: ['.tabs .active', '.tabs .item:not(.active)', '.gift-rank-list-item', '.uname a', '.own'].map(sel => ({ sel, color: css(sel).color, background: sel === '.own' ? css(sel).backgroundColor : css('.rank-list-ctnr').backgroundColor })),
          medal: css('.fans-medal').color, danmaku: css('.danmaku-test').color };
      });
      for (const text of values.texts) {
        const a = luminance(text.color), b = luminance(text.background);
        const contrast = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
        assert(contrast >= 4.5, `${theme}/${skin} ${text.sel} contrast ${contrast.toFixed(2)}`);
      }
      assert.equal(values.image, 'none');
      assert.equal(values.medal, 'rgb(255, 255, 255)'); assert.equal(values.danmaku, 'rgb(255, 255, 0)');
      results.push({ theme, skin, values });
      await page.screenshot({ path: join(out, `${theme}-${skin}.png`) });
      console.log(`PASS ${theme} rank skin=${skin}`);
    }
  }
  assert.deepEqual(errors, []);
} finally { writeFileSync(join(out, 'results.json'), JSON.stringify({ results, errors }, null, 2)); await context.close(); }
