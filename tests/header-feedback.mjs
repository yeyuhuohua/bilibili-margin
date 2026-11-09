import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installMocks } from './mocks.mjs';

const ext = resolve(process.env.SMOKE_EXT || 'dist');
const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/header-feedback');
mkdirSync(out, { recursive: true });
const results = [], errors = [];
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-header-feedback-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, viewport: { width: 1440, height: 1000 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
try {
  await installMocks(context);
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const seed = patch => worker.evaluate(async patch => {
    const saved = (await chrome.storage.local.get('margin:settings'))['margin:settings'];
    await chrome.storage.local.set({ 'margin:settings': { ...saved, ...patch } });
  }, patch);
  const page = context.pages()[0];
  page.on('pageerror', error => errors.push(error.message));
  for (const [name, url, host] of [
    ['home', 'https://www.bilibili.com/', 'margin-root'],
    ['watch', 'https://www.bilibili.com/video/BV1mdxN68E7F/', 'margin-watch-top'],
    ['message', 'https://message.bilibili.com/', 'margin-root'],
  ]) {
    await seed({ theme: 'light', intro: false, bg: { mode: 'off' } });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.locator(`#${host} .ts`).waitFor();
    for (const delay of [0, 35, 35, 35]) {
      await seed({ theme: 'light' });
      await page.waitForFunction(host => document.getElementById(host).shadowRoot.querySelector('.ts').dataset.state === 'light', host);
      await page.waitForTimeout(400);
      const result = { name, delay, ok: false };
      results.push(result);
      const clicks = await page.evaluate(async ({ host, delay }) => {
        const root = document.getElementById(host).shadowRoot, button = root.querySelector('.ts');
        window.instantChanges = 0;
        const observer = new MutationObserver(() => { if (button.classList.contains('ts-still')) window.instantChanges++; });
        observer.observe(button, { attributes: true });
        const clicks = [];
        for (let i = 0; i < 12; i++) {
          const before = button.dataset.state;
          button.click();
          clicks.push({ before, after: button.dataset.state });
          if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        }
        setTimeout(() => observer.disconnect(), 800);
        return clicks;
      }, { host, delay });
      await page.waitForTimeout(900);
      result.stored = await worker.evaluate(async () => (await chrome.storage.local.get('margin:settings'))['margin:settings'].theme);
      result.state = await page.locator(`#${host} .ts`).getAttribute('data-state');
      result.discontinuities = clicks.filter((click, i) => i > 0 && click.before !== clicks[i - 1].after).length;
      result.instantChanges = await page.evaluate(() => window.instantChanges);
      try {
        assert.equal(result.stored, 'light'); assert.equal(result.state, 'light');
        assert.equal(result.discontinuities, 0, 'old storage notifications reversed the latest click');
        assert.equal(result.instantChanges, 0, 'old storage notifications interrupted the animation');
        result.ok = true;
      } catch (error) { result.error = error.message; }
      console.log(`${result.ok ? 'PASS' : 'FAIL'} ${name} rapid theme ${delay}ms`);
    }
    if (name === 'watch') {
      const ruler = page.locator(`#${host} .sr`);
      const box = await ruler.boundingBox();
      await page.locator(`#${host} .top [aria-label="设置"]`).click();
      await page.waitForTimeout(500);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(400);
      const result = { name: 'settings-covers-ruler', ok: false, ...await ruler.evaluate(element => {
        const rect = element.getBoundingClientRect(), root = element.getRootNode();
        return { visibility: getComputedStyle(element).visibility, opacity: Number(getComputedStyle(element).opacity),
          hitRuler: element.contains(root.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)) };
      }) };
      result.ok = !result.hitRuler && (result.visibility === 'hidden' || result.opacity === 0);
      results.push(result);
      await page.screenshot({ path: join(out, 'watch-settings.png') });
      await page.keyboard.press('Escape');
      await page.mouse.move(400, 100);
      await page.waitForTimeout(300);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(400);
      assert.equal(await ruler.evaluate(element => getComputedStyle(element).visibility), 'visible');
      console.log(`${result.ok ? 'PASS' : 'FAIL'} settings-covers-ruler`);
    }
  }
} finally {
  writeFileSync(join(out, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  await context.close();
}
if (results.some(result => !result.ok) || errors.length) process.exitCode = 1;
