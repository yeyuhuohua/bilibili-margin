import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { firefox } from 'playwright';

const styles = readFileSync('src/content/styles/08-home-search.css', 'utf8');
const browser = await firefox.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 420, height: 700 } });
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>${styles}
    .idcl-card { width: 236px; height: 425px; }
    .idcl-face { font-family: Arial,sans-serif; }
    .idcl-header, .idcl-roleline, .idcl-stats, .idcl-idrow, .idcl-footer { min-height:38px; }
    .idcl-header { min-height:74px; }
  </style><div class="idcl-stage idcl-lite"><div class="idcl-card"><div class="idcl-face idcl-front">
    <div class="idcl-hole"></div>
    <div class="idcl-header">
      <div class="idcl-brand"><div class="idcl-brand-text"><b>BILIBILI</b><small>Margin · 映间</small></div></div>
      <div class="idcl-pillars"><span>LV3</span><span>UID 3707011621456341</span><i></i></div>
    </div>
    <div class="idcl-photo"></div>
    <h2 class="idcl-name">挂卡用户名 Shecatep</h2>
    <div class="idcl-roleline">大会员</div>
    <div class="idcl-exp"></div>
    <div class="idcl-stats"><div>关注</div><div>粉丝</div><div>硬币</div></div>
    <div class="idcl-idrow">等级</div>
    <div class="idcl-footer">未读消息</div>
  </div></div></div>`);
  const { height, lineHeight, uidOverflow } = await page.locator('.idcl-name').evaluate(el => {
    const uid = el.closest('.idcl-front').querySelector('.idcl-pillars');
    return { height: el.getBoundingClientRect().height, lineHeight: parseFloat(getComputedStyle(el).lineHeight),
      uidOverflow: uid.scrollWidth > uid.clientWidth };
  });
  assert(height >= lineHeight - .1, `nickname height ${height}px is below line height ${lineHeight}px`);
  assert.equal(uidOverflow, false, 'long UID should stay within its column');
  console.log(`PASS: Firefox nickname is ${height}px with ${lineHeight}px line height; long UID stays inside its column`);
} finally {
  await browser.close();
}
