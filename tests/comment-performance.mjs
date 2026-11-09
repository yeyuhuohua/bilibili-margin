// Real-DOM regression fixture for comment skinning and reply ordering.
// No live Bilibili APIs or extension privileges are used. Optional baseline:
// COMMENT_BASELINE=/path/to/original/src/content/ui/comment-skin.ts node tests/comment-performance.mjs
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';
import ts from 'typescript';

const out = resolve(process.env.COMMENT_OUT || 'tests/artifacts/comment-performance/results.json');
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'],
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }),
});
const context = await browser.newContext();
const results = [];
const errors = [];

async function run(file, label) {
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(`${label}: ${error.message}`));
  try {
    // Keep the module's actual functions, DOM operations and observer callbacks;
    // replace only its external settings and scheduler inputs with controllable ones.
    const source = readFileSync(file, 'utf8').replace(/^import .+;\r?\n/gm, '').replace(/export function /g, 'function ');
    const shim = `const __listeners = []; let __tick;
      const every = (_ms, fn) => { __tick = fn; return () => {}; };
      const loadSettings = async () => ({ replyTree: true });
      const onSettingsChange = fn => __listeners.push(fn);`;
    const expose = `globalThis.commentFixture = { skinComments, nest,
      tick: () => __tick(), settings: value => __listeners.forEach(fn => fn({ replyTree: value })) };`;
    const code = ts.transpileModule(shim + '\n' + source + '\n' + expose, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    }).outputText;
    await page.setContent('<!doctype html><html><head></head><body></body></html>');
    await page.addScriptTag({ content: code });
    const result = await page.evaluate(async () => {
      const check = (value, message) => { if (!value) throw new Error(message); };
      const flush = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const host = tag => {
        const el = document.createElement(tag);
        el.attachShadow({ mode: 'open' });
        return el;
      };
      const info = [
        { name: '甲', to: '' },
        { name: '乙', to: '' },
        { name: '甲', to: '甲' },
        { name: '丙', to: '甲' },
        { name: '甲', to: '丙' },
        { name: '丁', to: '不存在' },
        { name: '戊', to: '甲' },
        { name: '乙', to: '乙' },
      ];
      const expectedOrder = ['0', '5', '1', '2', '3', '7', '4', '6'];
      const expectedDepth = [null, null, '1', '2', '3', null, '3', '1'];
      const bc = host('bili-comments');
      document.body.append(bc);
      // A large existing comment tree makes rescanning observable and deterministic.
      for (let i = 0; i < 500; i++) {
        const item = host('bili-comment-thread-renderer');
        item.shadowRoot.innerHTML = '<span class="tag">已有评论</span>';
        bc.shadowRoot.append(item);
      }
      const replies = host('bili-comment-replies-renderer');
      replies.shadowRoot.innerHTML = '<div id="expander-contents"></div>';
      const list = replies.shadowRoot.querySelector('#expander-contents');
      const modern = info.map(({ name, to }) => {
        const reply = host('bili-comment-reply-renderer');
        const user = host('bili-comment-user-info');
        const text = host('bili-rich-text');
        user.shadowRoot.innerHTML = '<span id="user-name"></span>';
        user.shadowRoot.querySelector('#user-name').textContent = name;
        text.shadowRoot.innerHTML = '<span id="contents"></span>';
        text.shadowRoot.querySelector('#contents').textContent = to ? `回复 @${to} ：正文` : '正文';
        reply.shadowRoot.append(user, text);
        list.append(reply);
        return reply;
      });
      bc.shadowRoot.append(replies);
      const oldList = document.createElement('div');
      oldList.className = 'sub-reply-list';
      const legacy = info.map(({ name, to }) => {
        const reply = document.createElement('div');
        reply.className = 'sub-reply-item';
        reply.innerHTML = '<span class="sub-user-name"></span><span class="reply-content"></span>';
        reply.querySelector('.sub-user-name').textContent = name;
        reply.querySelector('.reply-content').textContent = to ? `回复 @${to}:正文` : '正文';
        oldList.append(reply);
        return reply;
      });
      document.body.append(oldList);
      const late = document.createElement('bili-comment-box');
      bc.shadowRoot.append(late);
      commentFixture.skinComments();
      await flush();
      await flush();
      const assertOrder = (items, label) => {
        check(JSON.stringify(items.map(r => r.style.order)) === JSON.stringify(expectedOrder), `${label}: reply order changed`);
        check(JSON.stringify(items.map(r => r.dataset.mDepth ?? null)) === JSON.stringify(expectedDepth), `${label}: reply depth changed`);
      };
      assertOrder(modern, 'modern');
      assertOrder(legacy, 'legacy');
      check(oldList.classList.contains('m-tree'), 'legacy tree class missing');
      check(modern.every((r, i) => list.children[i] === r), 'native modern reply nodes moved');
      check(legacy.every((r, i) => oldList.children[i] === r), 'native legacy reply nodes moved');
      commentFixture.settings(false);
      await flush();
      check([...modern, ...legacy].every(r => !r.style.order && r.dataset.mDepth === undefined), 'disabled tree kept order or indentation');
      check(!oldList.classList.contains('m-tree'), 'disabled legacy tree kept class');
      commentFixture.settings(true);
      await flush();
      assertOrder(modern, 'modern re-enabled');
      assertOrder(legacy, 'legacy re-enabled');
      // Track querySelectorAll('*') traversal only, excluding fixture assertions.
      let scans = { calls: 0, elements: 0 };
      for (const prototype of [Element.prototype, ShadowRoot.prototype]) {
        const query = prototype.querySelectorAll;
        prototype.querySelectorAll = function(selector) {
          const matches = query.call(this, selector);
          if (selector === '*') { scans.calls++; scans.elements += matches.length; }
          return matches;
        };
      }
      const added = host('bili-comment-thread-renderer');
      const wrapper = document.createElement('div');
      const nested = host('bili-comment-box');
      nested.shadowRoot.innerHTML = '<span class="tag">新增嵌套评论</span>';
      const nestedReplies = host('bili-comment-replies-renderer');
      nestedReplies.shadowRoot.innerHTML = '<div id="expander-contents"></div>';
      wrapper.append(nested, nestedReplies);
      added.shadowRoot.append(wrapper);
      scans = { calls: 0, elements: 0 };
      bc.shadowRoot.append(added);
      await flush();
      const insertionScans = { ...scans };
      check([added, nested, nestedReplies].every(el => el.shadowRoot.adoptedStyleSheets.length > 0), 'dynamic nested shadow roots were not styled');
      check(nestedReplies.shadowRoot.adoptedStyleSheets.length === 2, 'new nested reply root missed tree styles');
      check(nested.shadowRoot.adoptedStyleSheets[0].cssRules.length > 2, 'comment-box skin missing');
      // An already present custom element may attach its root after observation.
      late.attachShadow({ mode: 'open' }).innerHTML = '<span class="tag">迟到 root</span>';
      commentFixture.tick();
      await flush();
      check(late.shadowRoot.adoptedStyleSheets.length === 1, 'fallback scan missed late shadow root');
      const adoptedCounts = [late, added, nested, nestedReplies].map(el => el.shadowRoot.adoptedStyleSheets.length);
      commentFixture.tick();
      await flush();
      check(JSON.stringify(adoptedCounts) === JSON.stringify([late, added, nested, nestedReplies].map(el => el.shadowRoot.adoptedStyleSheets.length)), 'fallback duplicated adopted sheets');
      // Reapplying unchanged replies must preserve all native nodes; count writes
      // using MutationObserver, which sees native CSSOM and dataset mutations.
      const mutations = [];
      const observer = new MutationObserver(records => mutations.push(...records));
      for (const reply of modern) observer.observe(reply, { attributes: true, attributeFilter: ['style', 'data-m-depth'] });
      commentFixture.nest(modern, info);
      await Promise.resolve();
      const unchangedWrites = mutations.length;
      observer.disconnect();
      // Deep reply chains are detached DOM nodes to isolate the ordering algorithm.
      const chain = Array.from({ length: 12000 }, () => document.createElement('div'));
      const chainInfo = chain.map((_, i) => ({ name: `author${i}`, to: i ? `author${i - 1}` : '' }));
      let deepChain;
      try {
        commentFixture.nest(chain, chainInfo);
        deepChain = chain[11999].style.order === '11999' && chain[11999].dataset.mDepth === '3';
      } catch (error) { deepChain = error.name; }
      return {
        insertionScans, unchangedWrites, deepChain,
        coverage: ['modern replies', 'legacy replies', 'duplicate authors', 'self replies', 'missing parents', 'replyTree off/on', 'native node identity/order', 'nested shadow insertion', 'dynamic reply styles', 'late shadow root', 'no duplicate sheets'],
      };
    });
    return { label, ...result };
  } finally { await page.close(); }
}

try {
  if (process.env.COMMENT_BASELINE) results.push(await run(resolve(process.env.COMMENT_BASELINE), 'baseline'));
  const optimized = await run(resolve('src/content/ui/comment-skin.ts'), 'optimized');
  results.push(optimized);
  assert.equal(optimized.unchangedWrites, 0, 'unchanged reply ordering rewrote attributes');
  assert.equal(optimized.deepChain, true, 'deep reply chain overflowed or changed depth');
  assert(optimized.insertionScans.elements < 20, 'incremental insertion scanned existing comments');
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log(JSON.stringify({ results, errors }, null, 2));
} finally {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ browser: await browser.version(), scope: 'real DOM comment fixture; no live site or GPU FPS claim', results, errors }, null, 2));
  await browser.close();
}
