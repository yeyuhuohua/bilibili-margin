import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { installMocks } from './mocks.mjs';
const ext = resolve(process.env.SMOKE_EXT || 'dist'), out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/feed-follow-avatars');
mkdirSync(out, { recursive: true });
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-feed-faces-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, viewport: { width: 1440, height: 1000 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const results = [], errors = [];
try {
  await installMocks(ctx);
  const worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  const seed = patch => worker.evaluate(async patch => { const saved = (await chrome.storage.local.get('margin:settings'))['margin:settings']; await chrome.storage.local.set({ 'margin:settings': { ...saved, ...patch } }); }, patch);
  await seed({ intro: false, theme: 'dark', feedLayout: 'classic', feedFollowList: true, bg: { mode: 'off' } });
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto('https://t.bilibili.com/');
  const follows = page.locator('#margin-root .fd-follows');
  const rows = follows.locator('.fd-follow-row'); await rows.first().waitFor();
  for (const theme of ['dark', 'light']) {
    await seed({ theme });
    for (const width of [1440, 2560]) {
      await page.setViewportSize({ width, height: 1000 });
      const geometry = await rows.evaluateAll(rows => rows.map(row => {
        const img = row.querySelector('img.fd-follow-face'), name = row.querySelector('.fd-follow-name');
        const image = img.getBoundingClientRect(), box = row.getBoundingClientRect(), label = name.getBoundingClientRect();
        return {
          image: [image.x, image.y, image.width, image.height],
          row: [box.x, box.y, box.width, box.height],
          labelLeft: label.x,
          direction: getComputedStyle(row).flexDirection,
          radius: parseFloat(getComputedStyle(img).borderRadius),
        };
      }));
      results.push({ theme, width, geometry });
      await follows.screenshot({ path: join(out, `${theme}-${width}.png`) });
      assert(geometry.length > 0);
      for (const face of geometry) {
        assert.equal(face.direction, 'row', 'follow rows must lay out horizontally');
        assert(Math.abs(face.image[2] - 30) < .5 && Math.abs(face.image[3] - 30) < .5, `follow avatar must stay 30px circle: ${JSON.stringify(face)}`);
        assert(face.image[0] >= face.row[0] && face.image[0] + face.image[2] <= face.labelLeft + .5 && face.image[1] >= face.row[1] && face.image[1] + face.image[3] <= face.row[1] + face.row[3] + .5);
        assert(face.radius >= 15, `follow avatar must stay circular: ${face.radius}`);
      }
    }
  }
  const row = rows.first(); await row.click();
  assert(await page.locator('#margin-root .fd-list').isVisible(), 'follow selection must retain the dynamic list');
  await seed({ feedLayout: 'sidebar' });
  await page.locator('#margin-root .fd-left .fd-ups').waitFor();
  const sideFace = page.locator('#margin-root .fd-ups-row .fd-up-face img').first(); await sideFace.waitFor();
  assert.equal(Math.round((await sideFace.boundingBox()).width), 36);
  await seed({ feedLayout: 'classic' }); await follows.waitFor({ state: 'visible' });
  assert.equal(Math.round((await rows.first().locator('img.fd-follow-face').boundingBox()).width), 30);
  assert.deepEqual(errors, []);
} finally { writeFileSync(join(out, 'results.json'), JSON.stringify({ results, errors }, null, 2)); await ctx.close(); }
console.log('PASS follow avatars fit their circular frames in both themes and layouts');
