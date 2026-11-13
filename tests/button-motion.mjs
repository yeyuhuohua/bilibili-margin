// Render actual source and native-shaped controls without making any real posts.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
import ts from 'typescript';
import { transformRadii } from '../scripts/radius.mjs';

const out = resolve('delivery/button-motion'); mkdirSync(out, { recursive: true });
const source = path => readFileSync(path, 'utf8').replace(/^import .+;\r?\n/gm, '').replace(/export (async )?function /g, '$1function ');
const code = ts.transpileModule(`const every=()=>()=>{};const loadSettings=async()=>({replyTree:true});const onSettingsChange=()=>{};
${source('src/content/ui/send-button.ts')}
${source('src/content/ui/comment-skin.ts')}
globalThis.start=skinComments;globalThis.decorate=decorateSendButton;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const browser = await chromium.launch({ channel: 'chromium', headless: true });
const results = [], errors = [];
const check = (name, value) => { assert.ok(value, name); results.push(name); };
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  page.on('pageerror', e => errors.push(e.message));
  await page.setContent(`<!doctype html><html class="margin-skin margin-search" data-margin-theme="dark"><head><style>
    html{--m-ink:#f3f4f7;--m-accent:#00aeec;--m-surface:#24262b;--m-canvas:#101114;--m-chip:#303238;--m-sans:system-ui}
    body{padding:50px;background:#171a20;color:#f3f4f7;font:14px system-ui}
    button{background:#085873;color:#fff;border:0;border-radius:999px;padding:0 18px;height:32px;cursor:pointer}
    button:disabled{opacity:.4;cursor:default}.vui_pagenation--btns{display:flex;gap:8px;align-items:center;margin:32px 0}
  </style></head><body><bili-comments></bili-comments>
  <div id="custom"></div><div class="vui_pagenation--btns"><button id="prev" class="vui_pagenation--btn vui_pagenation--btn-side" aria-label="上一页">上一页</button><button id="page2" class="vui_pagenation--btn">2</button><button id="next" class="vui_pagenation--btn vui_pagenation--btn-side" aria-label="下一页">下一页</button></div></body></html>`);
  await page.addStyleTag({ content: transformRadii(readFileSync('src/content/pages.css', 'utf8')) });
  await page.evaluate(() => {
    const comments = document.querySelector('bili-comments').attachShadow({ mode: 'open' });
    const box = document.createElement('bili-comment-box'); comments.append(box);
    box.attachShadow({ mode: 'open' }).innerHTML = '<style>button{height:32px;padding:0 18px;border:0;border-radius:999px;background:#085873;color:white;font:14px system-ui}button:disabled{opacity:.4}</style><div id="pub"><button type="button">\n<!--?lit$738059694$-->发布\n</button></div>';
    const custom = document.querySelector('#custom').attachShadow({ mode: 'open' });
    custom.innerHTML = '<style>button{height:36px;padding:0 18px;border:0;border-radius:999px;background:#085873;color:white}</style><button class="dy-send" type="button">发布</button>';
    window.native = box.shadowRoot.querySelector('button'); window.originalText = window.native.firstChild; window.posts = 0;
    window.native.addEventListener('click', () => window.posts++);
    window.turns = 0; document.querySelector('#prev').addEventListener('click', () => window.turns++);
  });
  await page.addScriptTag({ content: code });
  await page.evaluate(() => { start(); decorate(document.querySelector('#custom').shadowRoot.querySelector('button')); });
  const send = page.locator('bili-comment-box #pub button');
  await send.locator('.m-send-visual').waitFor({ state: 'attached', timeout: 2000 });
  check('native text node and button identity retained', await send.evaluate(el => el === window.native && el.firstChild === window.originalText));
  check('native and custom-shadow publish buttons are decorated', await page.locator('.margin-send-button').count() === 2);
  check('accessible name remains a single Chinese publish label', await page.getByRole('button', { name: '发布', exact: true }).count() === 2);
  check('overlay is visible through nested shadow style', await send.locator('.m-send-visual').evaluate(el => getComputedStyle(el).display === 'flex'));
  await send.hover(); await page.waitForTimeout(350);
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('bili-comments').shadowRoot.querySelector('bili-comment-box').shadowRoot.querySelector('.m-send-label')).transform.split(',')[4]) >= 69);
  const hover = await send.evaluate(el => ({ plane: getComputedStyle(el.querySelector('svg')).transform, label: getComputedStyle(el.querySelector('.m-send-label')).transform, font: getComputedStyle(el.querySelector('.m-send-label')).fontSize }));
  check('hover rotates the plane and moves text clear: ' + JSON.stringify(hover), hover.plane !== 'none' && Number(hover.label.split(',')[4]) >= 69);
  check('flight animation runs only on hover', await send.locator('.m-send-flight').evaluate(el => getComputedStyle(el).animationName === 'm-send-fly'));
  await page.screenshot({ path: join(out, 'publish-hover.png') });
  await send.click(); check('original click still posts exactly once', await page.evaluate(() => window.posts === 1));
  await send.evaluate(el => { el.disabled = true; }); await page.waitForTimeout(350);
  check('disabled button does not fly', await send.locator('.m-send-flight').evaluate(el => getComputedStyle(el).animationName === 'none'));
  await send.evaluate(el => { el.disabled = false; });
  await page.mouse.move(10, 10); await page.waitForTimeout(350);
  check('idle publish has no running animation', await send.locator('.m-send-flight').evaluate(el => getComputedStyle(el).animationName === 'none'));
  await page.keyboard.press('Tab'); await send.focus(); await page.waitForTimeout(350);
  check('keyboard focus is visible', await send.evaluate(el => getComputedStyle(el).outlineStyle !== 'none'));
  await page.keyboard.press('Enter'); check('keyboard activation preserves single submission', await page.evaluate(() => window.posts === 2));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  check('system reduced motion leaves label and plane still', await send.evaluate(el => getComputedStyle(el.querySelector('.m-send-flight')).animationName === 'none' && getComputedStyle(el.querySelector('svg')).transform === 'none'));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => document.documentElement.classList.add('margin-reduce'));
  check('extension reduced motion works inside shadow roots', await send.evaluate(el => getComputedStyle(el.querySelector('.m-send-flight')).animationName === 'none' && getComputedStyle(el.querySelector('.m-send-label')).transform === 'none'));
  await page.evaluate(() => document.documentElement.classList.remove('margin-reduce'));
  const prev = page.locator('#prev'), next = page.locator('#page2');
  await page.mouse.move(10, 10); await send.evaluate(el => el.blur()); await page.waitForTimeout(350);
  const adjacent = await next.boundingBox();
  check('arrow matches 32px native page-number height', await prev.evaluate(el => getComputedStyle(el, '::before').width === '32px' && el.getBoundingClientRect().width === 60 && el.getBoundingClientRect().height === 32));
  const box = await prev.boundingBox(); await page.mouse.move(box.x + 44, box.y + 16); await page.waitForTimeout(350);
  check('arrow expands to compact 60px on hover', await prev.evaluate(el => getComputedStyle(el, '::before').width === '60px'));
  check('adjacent native page numbers do not shift', Math.abs((await next.boundingBox()).x - adjacent.x) < .1);
  await prev.click(); check('native previous click retained', await page.evaluate(() => window.turns === 1));
  await page.screenshot({ path: join(out, 'arrow-hover.png') });
  await prev.evaluate(el => { el.blur(); el.disabled = true; }); await page.waitForTimeout(350);
  check('disabled previous stays circular', await prev.evaluate(el => getComputedStyle(el, '::before').width === '32px'));
  await prev.evaluate(el => { el.disabled = false; }); await page.mouse.move(10, 10); await page.waitForTimeout(350);
  check('transparent reserved area cannot receive clicks', await prev.evaluate(el => { const b=el.getBoundingClientRect();return document.elementFromPoint(b.x+10,b.y+16)!==el; }));
  await page.keyboard.press('Tab'); await prev.focus(); await page.waitForTimeout(350);
  check('previous arrow expands for keyboard focus', await prev.evaluate(el => getComputedStyle(el, '::before').width === '60px'));
  await page.keyboard.press('Enter'); check('keyboard pagination preserved', await page.evaluate(() => window.turns === 2));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  check('arrow honors system reduced motion', await prev.evaluate(el => getComputedStyle(el, '::after').transitionDuration === '0s'));
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await prev.evaluate(el => el.blur()); await page.mouse.move(10, 10);
  const right = page.locator('#next');
  check('next uses the matching compact circle, not the old text pill', await right.evaluate(el => getComputedStyle(el, '::before').width === '32px' && getComputedStyle(el).fontSize === '0px'));
  const rightBox = await right.boundingBox(); await page.mouse.move(rightBox.x + 16, rightBox.y + 16); await page.waitForTimeout(350);
  check('next expands to the right without shifting page numbers', await right.evaluate(el => getComputedStyle(el, '::before').width === '60px') && Math.abs((await next.boundingBox()).x - adjacent.x) < .1);
  await page.screenshot({ path: join(out, 'arrow-next-hover.png') });
  await right.evaluate(el => { el.disabled = true; }); await page.waitForTimeout(350);
  check('disabled next stays circular', await right.evaluate(el => getComputedStyle(el, '::before').width === '32px'));
  await right.evaluate(el => { el.disabled = false; }); await page.mouse.move(10, 10);
  await page.waitForTimeout(350); await page.screenshot({ path: join(out, 'buttons-idle.png') });
  await send.evaluate(el => { const b=document.createElement('button');b.type='button';b.append(document.createComment('?lit$738059694$'),document.createTextNode('发布'));el.replaceWith(b); });
  await page.locator('bili-comment-box .m-send-visual').waitFor({ state: 'attached' });
  check('native rerender receives artwork without periodic rescans', await page.locator('bili-comment-box .m-send-visual').count() === 1);
  await page.evaluate(() => document.documentElement.classList.remove('margin-skin'));
  check('extension disable restores native visual text', await page.locator('bili-comment-box #pub button').evaluate(el => getComputedStyle(el).fontSize === '14px' && getComputedStyle(el.querySelector('.m-send-visual')).display === 'none'));
  check('no browser errors', errors.length === 0);
} finally {
  writeFileSync(join(out, 'report.json'), JSON.stringify({ passed: results.length, results, errors, scope: 'Native-shaped browser fixtures, actual module code and CSS; posts counted locally, no real publication.' }, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ passed: results.length, errors }));
