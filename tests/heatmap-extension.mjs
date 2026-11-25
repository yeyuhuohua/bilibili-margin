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
  await check('raised glass follows actual seconds in week, year and month', async () => {
    const saved = await worker.evaluate(async () => (await chrome.storage.local.get('margin:activity'))['margin:activity']);
    const setSeconds = s => worker.evaluate(({saved, older, s}) =>
      chrome.storage.local.set({'margin:activity':{...saved,[older]:{s,f:'08:00'}}}), {saved, older, s});
    const dot = card.locator(`.fp-week [data-k="${older}"]`);
    await setSeconds(10799); await dot.waitFor();
    assert.equal(await dot.evaluate(el => el.classList.contains('fp-glass-day')), false);
    await setSeconds(10800);
    await card.locator(`.fp-week .fp-glass-day[data-k="${older}"]`).waitFor();
    await card.getByRole('button',{name:'展开全年'}).click();
    await cell(older).waitFor();
    assert.notEqual(await cell(older).evaluate(el => getComputedStyle(el,'::before').boxShadow), 'none');
    await cell(today).focus(); await page.keyboard.press('ArrowUp');
    assert.equal(await cell(day(-1)).evaluate(el => el.matches(':focus')), true);
    await card.getByRole('button',{name:'月',exact:true}).click();
    if (older.slice(0,7) !== today.slice(0,7)) await card.getByRole('button',{name:'上个月'}).click();
    const month = card.locator(`.fp-day-b[data-k="${older}"]`);
    await month.waitFor(); await month.click();
    assert.equal(await month.getAttribute('aria-pressed'),'true');
    assert.equal(await month.evaluate(el => getComputedStyle(el,'::before').getPropertyValue('--fp-depth').trim()), '3px');
    await setSeconds(10801); await page.emulateMedia({reducedMotion:'reduce'}); await month.hover();
    assert.equal(await month.evaluate(el => getComputedStyle(el,'::before').animationName),'none');
    await setSeconds(10799);
    await card.locator(`.fp-day-b:not(.fp-glass-day)[data-k="${older}"][title*="2 小时 59 分"]`).waitFor();
    await worker.evaluate(data => chrome.storage.local.set({'margin:activity':data}),saved);
    await card.getByRole('button',{name:'收起足迹'}).click();
    await page.emulateMedia({reducedMotion:'no-preference'});
  });
  await check('sparse histories show a real seven-day strip and remember keyboard expansion', async () => {
    const expand = card.getByRole('button', { name: '展开全年' });
    await expand.waitFor({timeout:4000});
    const dots = card.locator('.fp-week [data-k]');
    assert.deepEqual(await dots.evaluateAll(nodes => nodes.map(n => n.dataset.k)), Array.from({length:7}, (_,i) => day(i-6)));
    assert.equal(await card.locator(`.fp-week [data-k="${older}"]`).getAttribute('data-l'), '1');
    assert.equal(await card.locator('.fp-cells').count(), 0);
    await card.screenshot({path:join(out,'compact-card.png')});
    const compactHeight = (await card.boundingBox()).height;
    const first = page.locator('#margin-root .grid .card').first();
    await first.waitFor(); const compactFeedY = (await first.boundingBox()).y;
    await expand.focus(); await page.keyboard.press('Enter');
    await card.locator('.fp-graph').waitFor();
    const fullHeight = (await card.boundingBox()).height, fullFeedY = (await first.boundingBox()).y;
    console.log({compactHeight, fullHeight, compactFeedY, fullFeedY});
    assert.ok(fullHeight > compactHeight && fullFeedY > compactFeedY);
    assert.equal(await card.getByRole('button',{name:'收起足迹'}).evaluate(b=>b.matches(':focus')), true);
    await page.reload(); await card.locator('.fp-graph').waitFor();
    await card.getByRole('button',{name:'月',exact:true}).click();
    await page.reload(); await card.locator('.fp-strip').waitFor();
    await card.getByRole('button',{name:'收起足迹'}).click(); await expand.waitFor();
    // With no explicit preference, real backfilled days switch to the full view.
    const saved = await worker.evaluate(async () => (await chrome.storage.local.get('margin:activity'))['margin:activity']);
    await worker.evaluate(({saved,extra}) => chrome.storage.local.set({'margin:activity':{...saved,...extra}}), {saved,extra:{[day(-8)]:{s:900},[day(-9)]:{h:600}}});
    await card.locator('.fp-graph').waitFor();
    await worker.evaluate(saved => chrome.storage.local.set({'margin:activity':saved}),saved);
    await expand.waitFor(); await expand.click();
  });
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
  await check('only a genuine first active day gets the welcome headline', async () => {
    await card.getByRole('button',{name:'收起足迹'}).click();
    assert.equal(await card.locator('.fp-brief-title').innerText(), '今天是你在映间的第 1 天');
    await worker.evaluate(async old => {
      const key = 'margin:activity', data = (await chrome.storage.local.get(key))[key];
      await chrome.storage.local.set({ [key]: { ...data, [old]: {s:600} } });
    }, day(-370));
    await page.waitForFunction(() => document.querySelector('#margin-root').shadowRoot.querySelector('.fp-brief-title')?.textContent === '近一年留下了 1 天足迹', null, {timeout:4000});
  });
  assert.deepEqual(errors,[]);
} finally { writeFileSync(join(out,'results.json'),JSON.stringify({results,errors},null,2));await ctx.close(); }
