import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' });
try {
  const page = await browser.newPage();
  const cards = count => Array.from({ length: count }, (_, n) =>
    `<div class="membersinfo-upcard-wrap"><a href="#member-${n}">成员 ${n + 1}</a></div>`).join('');
  await page.setContent(`<html class="margin-watch"><style>
    .up-panel-container { width:350px; box-sizing:border-box }
    .membersinfo-normal .container { display:flex; flex-wrap:wrap; overflow:hidden }
    .membersinfo-normal .init-no-wrap { flex-wrap:nowrap !important }
    .membersinfo-upcard-wrap { width:87px; flex:none; height:64px; text-align:center }
    .membersinfo-wide .container, .scroll-panel, .scroll-inside { display:flex }
    .scroll-panel { overflow:hidden }
    </style><div class="up-panel-container"><div class="membersinfo-normal">
    <div class="header">创作团队</div><div class="container init-no-wrap" style="max-height:64px">${cards(4)}</div>
    </div></div></html>`);
  await page.addStyleTag({ path: resolve(process.env.WATCH_CSS || 'src/content/watch.css') });
  const last = page.locator('.membersinfo-upcard-wrap a').last();
  const reachable = () => last.evaluate(a => {
    const r = a.getBoundingClientRect();
    return a.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  });
  assert(await reachable(), 'fourth member reachable before hydration without an expand button');
  const list = page.locator('.membersinfo-normal .container');
  await list.evaluate(el => el.classList.remove('init-no-wrap'));
  assert(await reachable(), 'fourth member reachable after hydration');
  await list.evaluate((el, html) => { el.innerHTML = html; }, cards(10));
  await page.locator('.header').evaluate(el => { el.innerHTML += '<span class="fold-btn unfold"></span>'; });
  assert.equal(await reachable(), false, 'native collapsed state');
  await page.locator('.fold-btn').evaluate(el => el.classList.remove('unfold'));
  assert(await reachable(), 'expanded list fits even with stale inline height');
  await page.locator('.up-panel-container').evaluate(el => { el.style.width = '260px'; });
  assert(await reachable(), 'expanded list adapts to narrower column');
  await page.locator('.up-panel-container').evaluate((el, html) => {
    el.innerHTML = `<div class="membersinfo-wide"><div class="container"><div class="scroll-panel"><div class="scroll-inside" style="transform:translateX(-348px)">${html}</div></div></div></div>`;
  }, cards(10));
  for (const a of await page.locator('.membersinfo-upcard-wrap a').all()) {
    const r = await a.boundingBox();
    assert(await a.evaluate((link, p) => link.contains(document.elementFromPoint(p.x + p.width / 2, p.y + p.height / 2)), r), 'wide mode member reachable');
  }
  await last.click();
  assert(page.url().endsWith('#member-9'));
  console.log('PASS cooperative video credits in normal, collapsed, expanded, resized and wide layouts');
} finally { await browser.close(); }
