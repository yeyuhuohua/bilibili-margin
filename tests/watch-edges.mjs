import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { transformRadii } from '../scripts/radius.mjs';
const out = resolve(process.env.SMOKE_OUT || 'delivery/watch-edges'); mkdirSync(out, { recursive: true });
const css = transformRadii(readFileSync('src/content/global.css', 'utf8') + readFileSync('src/content/watch.css', 'utf8'));
const browser = await chromium.launch({ channel: 'chromium', headless: true }); const checks = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.setContent(`<html class="margin-skin margin-watch"><head><style>
    body{margin:0}.video-page-card-small .pic-box{width:180px;height:100px}
    .video-page-card-small .card-box .info .upname a{display:inline-flex;width:180px;align-items:center}
    .video-page-card-small .card-box .info .upname .name{height:0;overflow:hidden}
    ${css}</style></head><body><div class="video-page-card-small"><div class="pic-box"></div>
    <div class="upname"><a><svg width="18" height="18"></svg><span class="name">晚加载的长名称 UP 主</span></a></div></div></body></html>`);
  for (const ratio of [0, .5, 1, 1.5]) {
    await page.evaluate(n => document.documentElement.style.setProperty('--margin-rk', n), String(ratio));
    const metrics = await page.locator('.pic-box').evaluate(el => ({ radius: getComputedStyle(el).borderTopLeftRadius, clip: getComputedStyle(el).clipPath }));
    assert.equal(metrics.radius, `${10 * ratio}px`); assert(ratio ? metrics.clip.includes(`round ${10 * ratio}px`) : metrics.clip === 'inset(0px)', JSON.stringify(metrics));
    checks.push(`149 cover radius and clipping agree at ${ratio}`);
  }
  const author = page.locator('.name'); assert((await author.boundingBox()).height >= 18);
  await author.evaluate(el => { el.textContent = ''; }); await page.waitForTimeout(20); await author.evaluate(el => { el.textContent = '后加载的UP主名称'; });
  assert((await author.boundingBox()).height >= 18); checks.push('author line survives collapsed height and late text');
  await page.setContent(`<html class="margin-skin margin-watch margin-webscreen margin-webscroll" style="--m-ws-x:0px;--m-ws-y:0px;--m-ws-w:100vw"><head><style>
    body{margin:0}.bpx-player-container{position:relative;width:100%;height:100%;background:#111}
    .bpx-player-shadow-progress-area{position:absolute;left:0;right:0;bottom:-2px;height:2px;background:#00aeec}
    ${css}</style></head><body><div class="mode-webscreen"><div class="bpx-player-container" data-screen="web"><div class="bpx-player-shadow-progress-area"></div></div></div></body></html>`);
  for (const height of [720, 900, 1030]) {
    await page.setViewportSize({ width: 1440, height });
    const player = await page.locator('.mode-webscreen').boundingBox(), bar = await page.locator('.bpx-player-shadow-progress-area').boundingBox();
    assert.equal(player.height, height); assert.equal(bar.y + bar.height, height); assert(bar.height > 0);
    assert.equal(await page.evaluate(() => scrollY), 0); checks.push(`152 mini progress stays in dynamic viewport at ${height}px`);
  }
  await page.screenshot({ path: join(out, 'webscreen-edge.png') });
} finally { await browser.close(); writeFileSync(join(out, 'report.json'), JSON.stringify({ checks, passed: checks.length, scope: 'Actual built-rule transform in native-shaped fixtures. Includes negative native bottom-offset and late author-height guard; does not prove every intermittent live author issue.' }, null, 2)); }
console.log(JSON.stringify({ passed: checks.length }));
