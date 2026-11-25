// Mounted extension, deterministic offline cover. Run after npm run build.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { installMocks } from './mocks.mjs';

const ext = resolve(process.env.SMOKE_EXT || 'dist');
const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/folder-pocket');
mkdirSync(out, { recursive: true });
const cover = readFileSync(new URL('./fixtures/folder-cover.svg', import.meta.url));
const src = 'https://i0.hdslb.com/bfs/mock/folder-pocket';
const longTitle = '北岸档案：沿海灯塔、港口与胶片摄影手记';
const folders = [
  { id: 101, attr: 0, title: longTitle, media_count: 4, cover: src + '/coast.jpg' },
  { id: 202, attr: 3, title: '未命名的底片', media_count: 0, cover: '' },
];
// A comb provides measurable edges: brightness alone cannot shift their x positions.
const comb = '<svg xmlns="http://www.w3.org/2000/svg" width="728" height="592"><defs><pattern id="p" width="28" height="28" patternUnits="userSpaceOnUse" patternTransform="rotate(-22)"><rect width="28" height="28" fill="#1c3f51"/><path d="M0 0h11v28H0z" fill="#f3df9b"/></pattern></defs><rect width="728" height="592" fill="url(#p)"/></svg>';
const frame = i => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 544 368"><rect width="544" height="368" fill="${['#b4a78c', '#93afa5', '#a3b7be', '#bba191'][i]}"/><path d="M0 180l86 -29 48 12 127 -51 92 35 68 -21 123 47v120H0z" fill="#577a79"/><path d="M0 220q70 -18 148 -2t180 -3 216 -11v164H0z" fill="#32595e"/></svg>`;
const profile = mkdtempSync(join(tmpdir(), 'margin-folder-pocket-'));
const context = await chromium.launchPersistentContext(profile, {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  viewport: { width: 1380, height: 960 }, deviceScaleFactor: 1.5, headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const report = { extension: ext, checks: [], pixels: {}, pageErrors: [] };
const check = (name, value) => { assert.ok(value, name); report.checks.push(name); };
try {
  let diagnostic = true;
  await installMocks(context, url => {
    const u = new URL(url);
    if (u.pathname.includes('/fav/folder/created/list')) return { code: 0, data: { list: folders, count: folders.length, has_more: false } };
    if (u.pathname.includes('/fav/resource/list')) return { code: 0, data: { has_more: false, medias: diagnostic || u.searchParams.get('media_id') !== '101' ? [] : [0, 1, 2, 3].map(i => ({
      id: 1000 + i, bvid: 'BV1mock0000' + i, type: 2, attr: 0, title: '海岸采样 ' + (i + 1), cover: src + `/frame-${i}.jpg`, duration: 80, upper: { mid: 1, name: '离线样本' },
    })) } };
  });
  await context.route(src + '/**', r => {
    const i = /\/frame-(\d)\./.exec(r.request().url());
    return r.fulfill({ contentType: 'image/svg+xml', body: i ? frame(Number(i[1])) : diagnostic && !r.request().url().includes('/art-control') ? comb : cover });
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page = context.pages()[0];
  report.browser = await page.evaluate(() => navigator.userAgent);
  page.setDefaultTimeout(6000);
  page.on('pageerror', error => report.pageErrors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const settings = async (glass, theme = 'light', extra = {}) => {
    await worker.evaluate(value => chrome.storage.local.set({ 'margin:settings': value }), {
      intro: false, theme, glass, favDirect: false, favColumns: 2, weather: false, footprint: false, bg: { mode: 'off' }, ...extra,
    });
  };
  const waitSettings = (glass, theme = 'light') => page.locator(`#margin-root .app[data-glass="${glass}"][data-theme="${theme}"]`).waitFor();
  const openDrawer = async () => {
    await page.goto('https://www.bilibili.com/');
    await page.locator('#margin-root .top').waitFor();
    await page.evaluate(() => dispatchEvent(new Event('margin:open-fav', { cancelable: true })));
    const dialog = page.getByRole('dialog', { name: '收藏夹', exact: true });
    await dialog.locator('.gf-root[data-id="101"][data-entered]').waitFor();
    if (!diagnostic) await dialog.locator('.gf-root[data-id="101"] .gf-tilt > .gf-files img').nth(3).waitFor();
    return dialog;
  };
  const raster = async stage => (await stage.screenshot({ scale: 'css', animations: 'disabled' })).toString('base64');
  // Pixel comparison on a *browser screenshot*, not on the input image or computed styles.
  const bands = (a, b, leftTop, y0, y1) => page.evaluate(async ([a, b, leftTop, y0, y1]) => {
    const decode = async value => {
      const img = await createImageBitmap(await (await fetch('data:image/png;base64,' + value)).blob());
      const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0); return ctx.getImageData(0, 0, img.width, img.height);
    };
    const [one, two] = await Promise.all([a, b].map(decode));
    if (one.width !== two.width || one.height !== two.height) throw Error('card moved/resized across A/B');
    const { width: w, height: h } = one;
    function sample(left, top, right, bottom) {
      let count = 0, changed = 0, peak = 0, total = 0, edgeShiftedRows = 0, rows = 0;
      for (let y = Math.ceil(top * h); y < bottom * h; ++y) {
        const x0 = Math.ceil(left * w), x1 = Math.floor(right * w), shiftScores = [];
        for (let x = x0; x < x1; ++x) {
          const i = (y * w + x) * 4;
          const d = Math.max(...[0, 1, 2].map(c => Math.abs(one.data[i + c] - two.data[i + c])));
          ++count; total += d; peak = Math.max(peak, d); if (d > 8) ++changed;
        }
        for (let dx = -5; dx <= 5; ++dx) {
          let dot = 0, aa = 0, bb = 0;
          for (let x = x0 + 6; x < x1 - 6; ++x) {
            const i = (y * w + x) * 4, j = i + dx * 4;
            const p = one.data[i] - one.data[i - 4], q = two.data[j] - two.data[j - 4];
            dot += p * q; aa += p * p; bb += q * q;
          }
          shiftScores.push({ dx, score: dot / Math.sqrt(aa * bb || 1) });
        }
        const stationary = shiftScores[5].score, best = shiftScores.sort((p, q) => q.score - p.score)[0];
        if (Math.abs(best.dx) >= 1 && best.score > .65 && best.score > stationary + .07) ++edgeShiftedRows;
        ++rows;
      }
      return { changed, count, peak, mean: total / count, edgeShiftedRows, rows };
    }
    // Check name/count, not the separately composited ··· button on the right.
    return { exposed: sample(.55, .12, .86, .21), aboveNotch: sample(.55, y0 - .075, .85, y0 - .02), leftFold: sample(.09, leftTop, .30, leftTop + y1 - y0), fold: sample(.56, y0, .85, y1), belowFold: sample(.56, y1 + .025, .85, y1 + .07), foot: sample(.08, .62, .70, .94) };
  }, [a, b, leftTop, y0, y1]);
  const drawerBands = (a, b) => bands(a, b, 74 / 272, 106 / 272, 123 / 272);
  const spaceBands = (a, b) => bands(a, b, .31, .417, .473);

  await settings('soft');
  const dialog = await openDrawer();
  const file = dialog.locator('.gf-root[data-id="101"]'), stage = file.locator('.gf-stage');
  await file.locator('.gf-back > img').first().evaluate(img => img.decode());
  // Calibrate with no video previews: only the actual folder photo can produce the shifted edges.
  check('drawer calibration uses the real cover with no preview leaves', await file.locator('.gf-tilt > .gf-files img').count() === 0);
  await waitSettings('soft');
  const still = await raster(stage);
  await settings('liquid'); await waitSettings('liquid');
  const liquid = await raster(stage);
  writeFileSync(join(out, 'calibration-soft.png'), Buffer.from(still, 'base64'));
  writeFileSync(join(out, 'calibration-liquid.png'), Buffer.from(liquid, 'base64'));

  const delta = report.pixels.drawer = await drawerBands(still, liquid);
  console.log('drawer optical A/B', JSON.stringify(delta));
  check('liquid visibly displaces actual cover detail on both levels of the stepped rim', [delta.leftFold, delta.fold].every(s => s.edgeShiftedRows >= 2 && s.changed > 30));

  // Moving between compositing paths can change gradient dither by one or two RGB levels.
  check('the exposed cover and lower name/count plate stay unchanged by the lens', delta.foot.peak <= 2 && delta.exposed.peak <= 2);

  check('no rectangular optical tile across the clear area above the lower right lip', delta.aboveNotch.peak <= 2);
  check('the translucent shoulder immediately below the fold is not refracted', delta.belowFold.peak <= 2);
  await file.locator('.gf-back > img').evaluate(async (img, url) => { img.src = url; await img.decode(); }, src + '/art-control.jpg');
  const change = report.pixels.coverSwap = await drawerBands(liquid, await raster(stage));
  check('changing the actual photo changes the exposed cover, not the lower name/count background', change.exposed.changed > 100 && change.foot.peak <= 2);

  await page.goto('https://space.bilibili.com/1/favlist');
  const spaceCard = page.locator('.sp-collection').filter({ has: page.getByRole('button', { name: '打开' + longTitle, exact: true }) });
  const spaceCover = spaceCard.locator('.cover');
  await spaceCover.locator('img').evaluate(img => img.decode());
  await waitSettings('liquid');
  const spaceLiquid = await raster(spaceCover);
  await settings('soft'); await waitSettings('soft');
  const spaceDelta = report.pixels.space = await spaceBands(await raster(spaceCover), spaceLiquid);
  console.log('space optical A/B', JSON.stringify(spaceDelta));
  check('the personal favlist refracts its own visible cover on both levels of the rim', [spaceDelta.leftFold, spaceDelta.fold].every(s => s.edgeShiftedRows >= 2 && s.changed > 20));
  check('the personal favlist does not filter its text or exposed photo', spaceDelta.foot.peak <= 2 && spaceDelta.exposed.peak <= 2);
  check('the personal favlist also leaves the stepped notch clear', spaceDelta.aboveNotch.peak <= 2);
  check('the personal favlist shoulder below the lens does not shift', spaceDelta.belowFold.peak <= 2);
  diagnostic = false;
  await settings('liquid', 'light');
  await openDrawer();
  const blank = dialog.locator('.gf-root[data-id="202"]');
  await Promise.all((await file.locator('.gf-tilt > .gf-files img').all()).map(el => el.evaluate(img => img.decode())));
  await blank.locator('canvas.gf-art[data-ready]').waitFor();
  check('only the original folder photo and four actual fan leaves are mounted', await file.locator('img').count() === 5);
  check('one visible generated cover (not a duplicate) for a folder with no cover', await blank.locator('canvas').count() === 1 && await blank.locator('img').count() === 0);
  check('the two cards share optics; no per-card filter nodes', await dialog.locator('filter').count() === 0 && await page.locator('#margin-root #gf-prism').count() === 1);
  for (const theme of ['light', 'dark']) {
    await settings('liquid', theme); await waitSettings('liquid', theme);
    await file.locator('.gf-back img').evaluate(img => img.decode());
    await stage.screenshot({ path: join(out, `coast-${theme}.png`) });
    await dialog.screenshot({ path: join(out, `drawer-${theme}.png`) });
    const text = await file.evaluate(card => {
      const name = card.querySelector('.gf-title'), count = card.querySelector('.gf-meta');
      const titleBox = name.getBoundingClientRect(), countBox = count.getBoundingClientRect(), key = card.querySelector('.gf-key').getBoundingClientRect();
      return { fits: name.scrollWidth <= name.clientWidth + 1 && name.scrollHeight <= name.clientHeight + 1, separated: titleBox.right < key.left && titleBox.bottom <= countBox.top, label: card.querySelector('.gf-hit').getAttribute('aria-label') };
    });
    check(`${theme}: a common long CJK title fits the plate without colliding with count or more`, text.fits && text.separated && text.label.includes(longTitle));
  }
  const lip = file.locator('.gf-lip'), optical = () => lip.evaluate(el => getComputedStyle(el).backdropFilter);
  check('the full folder name is available on the pointer target, not just the inert label', await file.locator('.gf-hit').getAttribute('title') === longTitle);
  for (const glass of ['soft', 'flat']) {
    await settings(glass); await waitSettings(glass);
    check(`${glass} never applies an optical filter to the cover`, await optical() === 'none');
    if (glass === 'flat') check('flat uses a solid face without its transparent shoulder', await file.locator('.gf-plate').evaluate(el => getComputedStyle(el).maskImage === 'none'));
  }
  await settings('liquid', 'light', { uiEffects: false }); await waitSettings('liquid');
  await page.locator('#margin-root .app.margin-ui-still').waitFor();
  check('turning off UI effects disables refraction', await optical() === 'none');
  await settings('liquid'); await page.locator('#margin-root .app:not(.margin-ui-still)').waitFor();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  check('reduced transparency selects the opaque, unfiltered face', await optical() === 'none' && await file.locator('.gf-plate').evaluate(el => getComputedStyle(el).maskImage === 'none'));
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  check('restoring the preference re-enables only the liquid lip', (await optical()).includes('gf-prism'));

  const hit = file.locator('.gf-hit'), key = file.locator('.gf-key');
  await hit.focus(); await page.keyboard.press('Enter');
  check('Enter expands the fan and exposes the actual links', await hit.getAttribute('aria-expanded') === 'true' && !await file.locator('.gf-files').evaluate(el => el.inert));
  await page.keyboard.press('Tab');
  check('a real video link takes keyboard focus in the expanded fan', await file.locator('a.gf-sheet:focus-visible').count() === 1);
  const link = file.locator('a.gf-sheet:focus-visible'), target = await link.getAttribute('href');
  const [video] = await Promise.all([page.waitForEvent('popup'), page.keyboard.press('Enter')]);
  await video.waitForURL(target); await video.close();
  check('the focused fan preview opens its original video URL', video.url() === target);

  // Start a native drag on the actually exposed part of a fan leaf, not on a mock handler.
  const drag = await file.evaluate(card => {
    const tree = card.getRootNode();
    for (const a of card.querySelectorAll('a.gf-sheet')) {
      const r = a.getBoundingClientRect();
      for (let y = Math.max(2, r.top + 5); y < Math.min(innerHeight, r.bottom) - 5; y += 6) {
        const x = r.left + r.width / 2;
        if (tree.elementFromPoint(x, y)?.closest('a.gf-sheet') !== a) continue;
        card.addEventListener('dragstart', e => { card.dataset.dragged = e.dataTransfer.getData('text/uri-list'); }, { once: true });
        return { x, y, href: a.href };
      }
    }
  });
  assert.ok(drag, 'expanded fan has exposed, hit-testable links');
  await page.mouse.move(drag.x, drag.y); await page.mouse.down(); await page.mouse.move(drag.x + 26, drag.y + 5, { steps: 8 }); await page.mouse.up();
  check('decorative glass does not steal a native video-link drag', await file.getAttribute('data-dragged') === drag.href);
  await page.keyboard.press('Escape');
  check('Escape collapses the fan, restores folder focus and keeps the drawer open', await hit.evaluate(el => el.matches(':focus') && el.getAttribute('aria-expanded') === 'false') && await dialog.isVisible());
  await key.click(); await page.keyboard.press('End');
  check('More menu remains navigable with the keyboard', await file.locator('[role="menuitem"]:focus').innerText() === '在 B 站打开');
  await page.keyboard.press('Escape');
  check('closing the menu restores focus to its key', await key.evaluate(el => el.matches(':focus') && el.getAttribute('aria-expanded') === 'false'));

  await page.goto('https://space.bilibili.com/1/favlist');
  await spaceCover.locator('img').evaluate(img => img.decode());
  for (const theme of ['light', 'dark']) {
    await settings('liquid', theme); await waitSettings('liquid', theme);
    await spaceCard.screenshot({ path: join(out, `space-${theme}.png`) });
    check(`${theme}: space title and count are fully within the lower plate`, await spaceCard.evaluate(card => {
      const title = card.querySelector('.title'), t = title.getBoundingClientRect(), c = card.querySelector('.dur').getBoundingClientRect(), b = card.querySelector('.cover').getBoundingClientRect();
      return title.scrollWidth <= title.clientWidth + 1 && title.scrollHeight <= title.clientHeight + 1 && t.top >= b.top + b.height * .55 && t.bottom <= c.top && c.bottom < b.bottom;
    }));
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await spaceCard.scrollIntoViewIfNeeded();
  check('on a narrow personal favlist the long title and private count stay on their own plates', await page.locator('.sp-favorite-folder').evaluateAll(cards => cards.every(card => {
    const title = card.querySelector('.title'), t = title.getBoundingClientRect(), c = card.querySelector('.dur').getBoundingClientRect(), b = card.querySelector('.cover').getBoundingClientRect();
    return t.top >= b.top + b.height * .55 && t.bottom <= c.top && c.bottom < b.bottom && t.left >= b.left && c.right <= b.right && b.right <= innerWidth && title.scrollHeight <= title.clientHeight + 1;
  })));
  await page.setViewportSize({ width: 1380, height: 960 });
  const spaceBlank = page.locator('.sp-favorite-folder').filter({ hasText: folders[1].title });
  check('private, coverless personal folder retains both the icon and private count', await spaceBlank.locator('.sp-folder-art svg').count() === 1 && await spaceBlank.locator('.dur').innerText() === '0 个内容 · 私密');
  for (const control of ['.title', '.cover']) {
    if (control === '.title') { await spaceCard.locator(control).focus(); await page.keyboard.press('Space'); }
    else await spaceCard.locator(control).click({ position: { x: 40, y: 28 } });
    await page.waitForURL('**/1/favlist?fid=101');
    await page.getByRole('heading', { name: longTitle, exact: true }).waitFor();
    check(`${control}: personal folder opens directly without a drawer`, !await dialog.isVisible());
    await page.locator('.sp-collection-head').getByRole('button', { name: '收藏夹', exact: true }).click();
    await spaceCard.waitFor();
  }
  await page.goto('https://space.bilibili.com/2/favlist');
  await spaceCard.waitFor();
  check('another profile cannot render the private folder returned by the mock', await spaceBlank.count() === 0);
  check('no uncaught browser errors', !report.pageErrors.length);
} catch (error) {
  report.error = error.message; throw error;
} finally {
  writeFileSync(join(out, 'results.json'), JSON.stringify(report, null, 2));
  await context.close(); rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
}
console.log(`${report.checks.length} checks passed`);
