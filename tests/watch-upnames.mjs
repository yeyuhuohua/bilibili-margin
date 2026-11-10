import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const out = resolve(process.env.SMOKE_OUT || 'artifacts/new-issues-20261109/upnames'); mkdirSync(out, { recursive: true });
// Native recommendation structure/rules observed on /video/av170001/ (2026-11-09).
const native = `.video-page-card-small .card-box .info .upname { height:20px;margin:2px 0 }
  .video-page-card-small .card-box .info .upname a { display:inline-flex;align-items:center;width:100%;height:100% }
  .video-page-card-small .card-box .info .upname a svg { margin-right:4px }
  .video-page-card-small .card-box .info .upname a .name { width:calc(100% - 24px);display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden;text-overflow:ellipsis;word-break:break-all;line-break:anywhere }`;
const css = readFileSync('src/content/global.css', 'utf8') + readFileSync('src/content/watch.css', 'utf8');
const results = [];
for (const [name, type] of [['chromium', chromium], ['firefox', firefox]]) {
  const browser = await type.launch({ headless: true, ...(name === 'chromium' && process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 500, height: 360 } });
    await page.setContent(`<html class="margin-skin margin-watch"><head><style>${native}\n${css}
      body{margin:0;padding:20px;font:14px Arial;background:var(--m-canvas)}
      .video-page-card-small{margin:12px 0}.info{width:186px}
      </style></head><body>${['测试UP主的长名称不能被整行裁掉', 'FoolishJoker', '有 空格的 UP 名称'].map(text => `<div class="video-page-card-small"><div class="card-box"><div class="info"><div class="upname"><a href="https://space.bilibili.com/1"><svg width="18" height="18" viewBox="0 0 18 18"><rect x="2" y="2" width="14" height="14" fill="none" stroke="currentColor"/></svg><span class="name">${text}</span></a></div></div></div></div>`).join('')}</body></html>`);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => { document.documentElement.dataset.marginTheme = theme; }, theme);
      for (const width of [186, 270]) {
        await page.locator('.info').evaluateAll((nodes, width) => nodes.forEach(node => node.style.width = width + 'px'), width);
        const labels = page.locator('.upname .name');
        for (const label of await labels.all()) {
          const metrics = await label.evaluate(el => {
            const box = el.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(el);
            const glyph = range.getBoundingClientRect(), style = getComputedStyle(el);
            return { width: box.width, height: box.height, overlaps: glyph.left < box.right && glyph.top < box.bottom && glyph.bottom > box.top, color: style.color };
          });
          assert.ok(metrics.width > 80 && metrics.height >= 16 && metrics.overlaps, JSON.stringify(metrics));
          assert.notEqual(metrics.color, 'rgba(0, 0, 0, 0)');
          const clip = await label.boundingBox();
          const shown = await page.screenshot({ clip });
          await label.evaluate(el => el.style.visibility = 'hidden');
          const hidden = await page.screenshot({ clip });
          assert.ok(!shown.equals(hidden), 'The username must paint visible glyphs');
          await label.evaluate(el => el.style.visibility = '');
          await label.hover(); assert.ok(await label.isVisible());
        }
        await page.screenshot({ path: join(out, `${name}-${theme}-${width}.png`) });
        results.push(`${name}: ${theme} usernames paint at ${width}px`);
      }
    }
    console.log(`PASS ${name} native recommendation usernames`);
  } finally { await browser.close(); }
}
writeFileSync(join(out, 'results.json'), JSON.stringify({ results }, null, 2));
