import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { installMocks } from './mocks.mjs';

const out = resolve(process.env.SMOKE_OUT || 'artifacts/heatmap-extension'); mkdirSync(out, { recursive: true });
const ext = resolve(process.env.SMOKE_EXT || 'dist'), results = [], errors = [];
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-heatmap-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true, viewport: { width: 1440, height: 1000 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const day = offset => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const check = async (name, run) => { await run(); results.push(name); console.log('PASS ' + name); };
try {
  await installMocks(ctx, u => u.includes('history/cursor') ? { code: -101 } : undefined);
  const worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  const today = day(0), older = day(-3);
  await worker.evaluate(({ today, older }) => chrome.storage.local.set({
    'margin:settings': { intro:false, theme:'dark', bg:{mode:'off'} },
    'margin:activity': { [today]: { s:0 } }, 'margin-activity-v1': { [older]: { s:600, f:'08:00' } },
  }), { today, older });
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto('https://www.bilibili.com/');
  const card = page.locator('#margin-root .fp-card'), cell = key => card.locator(`.fp-cells [data-k="${key}"]`);
  await check('legacy records survive a newer heartbeat key', async () => {
    await page.waitForFunction(key => document.getElementById('margin-root')?.shadowRoot?.querySelector(`.fp-cells [data-k="${key}"]`)?.dataset.l === '1', older);
    const data = await worker.evaluate(async () => (await chrome.storage.local.get('margin:activity'))['margin:activity']);
    assert.equal(data[older].s,600);
  });
  await check('storage writes repaint the heatmap promptly', async () => {
    await worker.evaluate(async today => {
      const data = (await chrome.storage.local.get('margin:activity'))['margin:activity']; data[today]={s:60,f:'09:00'};
      await chrome.storage.local.set({'margin:activity':data});
    }, today);
    await page.waitForFunction(key => document.getElementById('margin-root')?.shadowRoot?.querySelector(`.fp-cells [data-k="${key}"]`)?.dataset.l === '1', today, { timeout:3000 });
    assert.equal(await cell(today).getAttribute('data-l'),'1');
  });
  await check('read failure preserves the last graph and recovers after storage repair', async () => {
    const data = await worker.evaluate(async () => (await chrome.storage.local.get('margin:activity'))['margin:activity']);
    await worker.evaluate(() => chrome.storage.local.set({'margin:activity':'corrupt-test-value'}));
    await page.waitForFunction(() => document.getElementById('margin-root')?.shadowRoot?.querySelector('.fp-card')?.dataset.syncState === 'read-error');
    assert.equal(await cell(older).getAttribute('data-l'),'1');
    assert.match(await card.locator('.fp-status').textContent(),/无法读取/);
    await worker.evaluate(data => chrome.storage.local.set({'margin:activity':data}),data);
    await page.waitForFunction(() => document.getElementById('margin-root')?.shadowRoot?.querySelector('.fp-card')?.dataset.syncState !== 'read-error');
  });
  await check('repeated short real navigations accumulate a lit local day', async () => {
    await card.getByRole('button',{name:'同步 B 站观看历史',exact:true}).waitFor();
    await page.waitForFunction(() => !document.getElementById('margin-root')?.shadowRoot?.querySelector('.fp-sync-btn')?.disabled);
    await worker.evaluate(() => chrome.storage.local.remove(['margin:activity','margin:activity-slots','margin-activity-v1','margin:activity-migrated-v2','margin:activity-bf','margin:activity-sync-v2']));
    const started=Date.now();
    for(let i=0;i<14;i++) {
      await page.waitForTimeout(5000); await page.reload(); await card.locator('.fp-head').waitFor();
    }
    await page.waitForFunction(key => document.getElementById('margin-root')?.shadowRoot?.querySelector(`.fp-cells [data-k="${key}"]`)?.dataset.l !== '0', today, {timeout:3000});
    const data=await worker.evaluate(async()=> (await chrome.storage.local.get('margin:activity'))['margin:activity']);
    assert.ok(data[today].s >= 60,JSON.stringify(data)); assert.ok(!data[today].h,'No historical estimates may mask missing local time');
    await page.screenshot({path:join(out,'short-visits.png')});
    console.log(JSON.stringify({elapsedSeconds:Math.round((Date.now()-started)/1000),recordedSeconds:data[today].s}));
  });
  assert.deepEqual(errors,[]);
} finally { writeFileSync(join(out,'results.json'),JSON.stringify({results,errors},null,2));await ctx.close(); }
