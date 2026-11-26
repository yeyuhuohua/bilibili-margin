import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { installMocks } from './mocks.mjs';

const ext = resolve(process.env.SMOKE_EXT || 'dist');
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'margin-comment-loc-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
  headless: true,
  viewport: { width: 1440, height: 900 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});

const errors = [];
try {
  await installMocks(ctx);
  const worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({ 'margin:settings': { intro: false, theme: 'dark', bg: { mode: 'off' } } }));
  const page = await ctx.newPage();
  page.on('pageerror', error => errors.push(error.message));

  await page.goto('https://www.bilibili.com/video/BV1mdxN68E7F/', { waitUntil: 'domcontentloaded' });
  await page.locator('#margin-watch-top').waitFor();

  const instant = await page.evaluate(async () => {
    class MockActions extends HTMLElement {
      constructor() { super(); this.attachShadow({ mode: 'open' }); }
      updated() {
        if (!this.shadowRoot.querySelector('#pubdate')) {
          this.shadowRoot.innerHTML = '<style>:host{font:13px/20px Arial}</style><div id="pubdate"><span>刚刚</span></div><button>回复</button>';
        }
      }
    }
    class MockComment extends HTMLElement {
      constructor() { super(); this.attachShadow({ mode: 'open' }); }
      updated() {}
    }
    class MockReply extends HTMLElement {
      constructor() { super(); this.attachShadow({ mode: 'open' }); }
      updated() {}
    }
    customElements.define('bili-comment-action-buttons-renderer', MockActions);
    customElements.define('bili-comment-renderer', MockComment);
    customElements.define('bili-comment-reply-renderer', MockReply);
    await Promise.resolve();

    const comments = document.createElement('bili-comments');
    const root = comments.attachShadow({ mode: 'open' });
    const renderer = document.createElement('bili-comment-renderer');
    renderer.data = { reply_control: { location: 'IP属地：广东' } };
    const actions = document.createElement('bili-comment-action-buttons-renderer');
    actions.data = renderer.data;
    renderer.shadowRoot.append(actions);

    const reply = document.createElement('bili-comment-reply-renderer');
    reply.data = { reply_control: { location: 'IP属地：江苏' } };
    const replyActions = document.createElement('bili-comment-action-buttons-renderer');
    replyActions.data = reply.data;
    reply.shadowRoot.append(replyActions);

    root.append(renderer, reply);
    document.querySelector('#commentapp').append(comments);

    // 1. Synchronous push on initial updated() — no 1s polling or scroll wait.
    actions.updated();
    const initialSync = actions.shadowRoot.querySelector('[data-margin-location-label]')?.textContent ?? null;
    const hasSheet = actions.shadowRoot.adoptedStyleSheets.length > 0;

    // 2. Synchronous push on nested sub-reply.
    replyActions.updated();
    const replySync = replyActions.shadowRoot.querySelector('[data-margin-location-label]')?.textContent ?? null;

    // 3. Synchronous update + HTML escaping on recycled comment row (e.g. sort switch / pagination).
    renderer.data = { reply_control: { location: '<b>IP属地：北京</b>' } };
    actions.data = renderer.data;
    renderer.updated();
    const labelEl = actions.shadowRoot.querySelector('[data-margin-location-label]');
    const recycledSync = labelEl?.textContent ?? null;
    const escapedChildCount = labelEl?.children.length ?? -1;

    // 4. Synchronous removal when recycled row has no location.
    renderer.data = { reply_control: {} };
    actions.data = renderer.data;
    renderer.updated();
    const clearedSync = actions.shadowRoot.querySelector('[data-margin-location-label]')?.textContent ?? null;

    // 5. Delayed #pubdate mount inside an already-observed shadowRoot (without updated()).
    const latePubHost = document.createElement('bili-comment-renderer');
    latePubHost.data = { reply_control: { location: 'IP属地：上海' } };
    const lateActions = document.createElement('bili-comment-action-buttons-renderer');
    lateActions.data = latePubHost.data;
    latePubHost.shadowRoot.append(lateActions);
    root.append(latePubHost);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const pub = document.createElement('div');
    pub.id = 'pubdate';
    pub.textContent = '1分钟前';
    lateActions.shadowRoot.append(pub);
    await Promise.resolve();
    const latePubSync = lateActions.shadowRoot.querySelector('[data-margin-location-label]')?.textContent ?? null;

    // 6. Delayed shadowRoot attachment on a custom element (caught within 2 rAFs, no 1s wait).
    const delayed = document.createElement('bili-comment-thread-renderer');
    root.append(delayed);
    await Promise.resolve();
    const dsr = delayed.attachShadow({ mode: 'open' });
    const dcr = document.createElement('bili-comment-renderer');
    dcr.data = { reply_control: { location: 'IP属地：四川' } };
    const da = document.createElement('bili-comment-action-buttons-renderer');
    da.data = dcr.data;
    da.shadowRoot.innerHTML = '<div id="pubdate"><span>2分钟前</span></div>';
    dcr.shadowRoot.append(da);
    dsr.append(dcr);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const delayedShadowSync = da.shadowRoot.querySelector('[data-margin-location-label]')?.textContent ?? null;

    // 7. Inactive when margin-skin is removed.
    document.documentElement.classList.remove('margin-skin');
    const offRenderer = document.createElement('bili-comment-renderer');
    offRenderer.data = { reply_control: { location: 'IP属地：福建' } };
    const offActions = document.createElement('bili-comment-action-buttons-renderer');
    offActions.data = offRenderer.data;
    offRenderer.shadowRoot.append(offActions);
    root.append(offRenderer);
    offActions.updated();
    const offSync = offActions.shadowRoot.querySelector('[data-margin-location-label]')?.textContent ?? null;

    return {
      initialSync, hasSheet, replySync, recycledSync, escapedChildCount,
      clearedSync, latePubSync, delayedShadowSync, offSync,
    };
  });

  assert.deepEqual(instant, {
    initialSync: 'IP属地：广东',
    hasSheet: true,
    replySync: 'IP属地：江苏',
    recycledSync: '<b>IP属地：北京</b>',
    escapedChildCount: 0,
    clearedSync: null,
    latePubSync: 'IP属地：上海',
    delayedShadowSync: 'IP属地：四川',
    offSync: null,
  });
  assert.deepEqual(errors, []);
  console.log('PASS: instant Lit updated() comment IP sync, sub-reply, row recycling, XSS escaping, delayed #pubdate, delayed shadowRoot, and inactive guard');
} finally {
  await ctx.close();
}
