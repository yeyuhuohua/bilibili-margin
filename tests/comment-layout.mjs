import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import ts from 'typescript';

const baseline = process.argv.includes('--baseline');
const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/comment-layout');
mkdirSync(out, { recursive: true });
const source = readFileSync(baseline ? 'artifacts/triage-20261108/comment-before-121.ts' : 'src/content/ui/comment-skin.ts', 'utf8').replace(/^import .+;\r?\n/gm, '').replace(/export function /g, 'function ');
const code = ts.transpileModule(`const every=()=>()=>{};const loadSettings=async()=>({replyTree:true});const onSettingsChange=()=>{};\n${source}\nglobalThis.startComments=skinComments;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }) });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  await page.setContent('<!doctype html><html class="margin-detail"><body style="margin:0;padding-top:180px;font:16px/24px Arial"><div class="bili-tabs__content" style="width:620px;box-sizing:border-box"><div class="comment-wrap"><div class="bili-comment-container" style="padding:0 24px"><bili-comments style="display:block"></bili-comments></div></div></div></body></html>');
  await page.addStyleTag({ content: readFileSync(baseline ? 'artifacts/triage-20261108/detail-before-121.css' : 'src/content/detail.css', 'utf8') });
  await page.evaluate(() => {
    const comments = document.querySelector('bili-comments').attachShadow({ mode: 'open' });
    const replies = document.createElement('bili-comment-replies-renderer');
    replies.style.display = 'block';
    const root = replies.attachShadow({ mode: 'open' });
    root.innerHTML = '<div id="expander-contents" style="min-height:1300px"></div>';
    const reply = document.createElement('bili-comment-reply-renderer');
    reply.style.cssText = 'display:block;padding-left:80px;margin-left:4px';
    reply.attachShadow({ mode: 'open' }).innerHTML = '<style>.metadata{display:flex;gap:20px;margin-left:32px;line-height:24px}span{min-width:0}button{font:inherit;border:0;background:none;padding:0}</style><p>回复正文</p><div class="metadata"><span>2026-11-07 21:57</span><span class="third-party-ip">IP属地：浙江</span><span>赞181</span><button>回复</button></div>';
    root.querySelector('#expander-contents').append(reply);
    comments.append(replies);
  });
  await page.addScriptTag({ content: code });
  await page.evaluate(() => startComments());
  const toggle = page.locator('.margin-replies-toggle');
  await toggle.waitFor();
  const labels = await page.locator('bili-comment-reply-renderer').evaluate(reply => [...reply.shadowRoot.querySelectorAll('.metadata > *')].map(el => ({ text: el.textContent, height: el.getBoundingClientRect().height })));
  const before = await toggle.boundingBox();
  await page.evaluate(() => scrollTo(0, 240));
  const after = await toggle.boundingBox();
  const result = { baseline, labels, collapseMovement: before.y - after.y };
  writeFileSync(`${out}/${baseline ? 'before' : 'after'}.json`, JSON.stringify(result, null, 2));
  await page.screenshot({ path: `${out}/${baseline ? 'before' : 'after'}.png` });
  assert.ok(labels.every(label => label.height <= 25), JSON.stringify(labels));
  assert.ok(Math.abs(result.collapseMovement - 240) < 1, JSON.stringify(result));
  await page.evaluate(() => scrollTo(0, 0));
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  console.log('PASS third-party IP metadata width, scrolling collapse control and expand/collapse');
} finally { await browser.close(); }
