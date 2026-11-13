import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';
import { build } from 'vite';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { installMocks } from './mocks.mjs';
import { draftValue, selectDraftText } from './message-draft.mjs';

const out = resolve(process.env.SMOKE_OUT || 'artifacts/new-issues-20261109/editor'); mkdirSync(out, { recursive: true });
const bundle = join(out, 'composer.js');
const entry = join(out, 'entry.ts');
writeFileSync(entry, `import { createMessageComposer } from ${JSON.stringify(resolve('src/content/ui/message-composer.ts').replaceAll('\\', '/'))};
  window.mountComposer = () => {
    const host = document.createElement('section'); host.id = 'composer-test'; document.body.append(host);
    const root = host.attachShadow({mode:'open'}), app = document.createElement('div'); app.className='app';
    const style=document.createElement('style');style.textContent=window.composerCSS;root.append(style,app);
    window.composerNotices=[];
    const composer=createMessageComposer({me:1,to:2,name:'测试联系人',csrf:()=> 'test-csrf',say:text=>window.composerNotices.push(text),onSent:async()=>{}});
    app.append(composer.el);
  };`);
await build({ configFile: false, publicDir: false, logLevel: 'error', plugins: process.env.MESSAGE_EDITOR_BASELINE ? [{
  name: 'editor-regression-baseline', enforce: 'pre', transform(_code, id) {
    if (id.replaceAll('\\', '/').endsWith('/src/content/ui/message-editor.ts')) return readFileSync(process.env.MESSAGE_EDITOR_BASELINE, 'utf8');
  },
}] : [], build: { outDir: out, emptyOutDir: false, lib: { entry, name: 'composerHarness', formats: ['iife'], fileName: () => 'composer.js' } } });
const css = readdirSync('src/content/styles').filter(name => name.endsWith('.css')).sort().map(name => readFileSync(join('src/content/styles', name), 'utf8')).join('\n')
  + readFileSync('src/content/takeover.css', 'utf8') + '\n.app{position:relative;inset:auto;min-height:800px;overflow:visible;padding:360px 24px 24px;width:760px;max-width:100%;--ink:#222;--muted:#777;--canvas:#fafafa;--surface:#fff;--line:#ddd;--chip:#eee;font:14px Arial}';
const results = [];
for (const [name, type] of [['chromium', chromium], ['firefox', firefox]]) {
  const browser = await type.launch({ headless: true, ...(name === 'chromium' && process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const context = await browser.newContext({ viewport: { width: 900, height: 800 } });
  const sent = [], errors = [];
  try {
    await installMocks(context, url => url.includes('/x/emote/user/panel/web') ? { code: 0, data: { packages: [{ id: 1, text: '小电视', emote: [{ text: '[tv_doge]', url: 'https://i0.hdslb.com/doge.png' }] }] } } : undefined);
    await context.route('**/web_im/v1/web_im/send_msg', async route => {
      const body = new URLSearchParams(route.request().postData()); sent.push({ text: JSON.parse(body.get('msg[content]')).content, face: body.get('msg[new_face_version]') });
      await route.fulfill({ json: { code: 0, data: {} }, headers: { 'access-control-allow-origin': 'https://message.bilibili.com', 'access-control-allow-credentials': 'true' } });
    });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto('https://message.bilibili.com/');
    await page.evaluate(css => { document.body.replaceChildren(); window.composerCSS = css; }, css);
    await page.addScriptTag({ path: bundle }); await page.evaluate(() => window.mountComposer());
    const input = page.locator('#composer-test .wh-input');
    await input.fill('abc中文'); await input.press('End'); await input.press('Backspace');
    assert.equal(await draftValue(input), 'abc中');
    await input.press('Home'); await input.press('Delete');
    assert.equal(await draftValue(input), 'bc中');
    results.push(name + ': Backspace and Delete edit plain text inside shadow root');
    const insertEmoji = async () => { await page.getByRole('button', { name: '选择表情', exact: true }).click(); await page.getByRole('button', { name: '[tv_doge]', exact: true }).click(); };
    await input.fill('ab');
    await input.evaluate(el => {
      const root = el.getRootNode(), original = root.getSelection?.bind(root) || document.getSelection.bind(document);
      Object.defineProperty(root, 'getSelection', { configurable: true, value: () => {
        const selected = original();
        return new Proxy(selected, { get(target, key) {
          if (key === 'getRangeAt') return () => { const r = document.createRange(); r.setStartBefore(root.host); r.collapse(true); return r; };
          if (key === 'getComposedRanges') return () => [new StaticRange({ startContainer: el.firstChild, startOffset: 1, endContainer: el.firstChild, endOffset: 1 })];
          const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
        } });
      } });
    });
    await selectDraftText(input, 1, 1); await insertEmoji();
    await input.evaluate(el => { delete el.getRootNode().getSelection; });
    assert.equal(await draftValue(input), 'a[tv_doge]b');
    results.push(name + ': composed selection survives host-retargeted getRangeAt');
    await input.fill('abc'); await selectDraftText(input, 1, 2); await insertEmoji();
    assert.equal(await draftValue(input), 'a[tv_doge]c'); assert.equal(await input.locator('img').count(), 1);
    await input.press('Control+z'); assert.equal(await draftValue(input), 'abc');
    await input.press('Control+Shift+z'); assert.equal(await draftValue(input), 'a[tv_doge]c');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#composer-test').shadowRoot.querySelector('.wh-count').textContent === '0/500');
    assert.deepEqual(sent[0], { text: 'a[tv_doge]c', face: '1' });
    results.push(name + ': inline emoji, selection replacement, undo/redo and canonical send');

    await input.fill('第一行'); await input.press('End'); await input.press('Shift+Enter'); await input.pressSequentially('第二行');
    assert.equal(await draftValue(input), '第一行\n第二行');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#composer-test').shadowRoot.querySelector('.wh-count').textContent === '0/500');
    assert.equal(sent.at(-1).text, '第一行\n第二行');
    await input.evaluate(el => {
      const clipboard = new DataTransfer(); clipboard.setData('text/plain', '安全文本'); clipboard.setData('text/html', '<img src=x onerror=alert(1)><script>alert(1)</script>');
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: clipboard });
      el.dispatchEvent(event);
    });
    assert.equal(await draftValue(input), '安全文本'); assert.equal(await input.locator('img,script').count(), 0);
    results.push(name + ': Shift+Enter and plain-text paste reject clipboard markup');

    await input.fill('中'.repeat(500)); await input.press('End'); await input.pressSequentially('x'); assert.equal((await draftValue(input)).length, 500);
    await input.fill('中'.repeat(499)); await input.press('End'); await insertEmoji(); assert.equal(await input.locator('img').count(), 0); assert.equal((await draftValue(input)).length, 499);
    await page.keyboard.press('Escape'); await input.focus();
    await input.evaluate(el => {
      el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); el.textContent = '你'.repeat(501);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
      el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    });
    assert.equal((await draftValue(input)).length, 500);
    results.push(name + ': length limits and composition completion');
    await input.fill('前后'); await selectDraftText(input, 1, 1); await insertEmoji(); await input.press('Backspace');
    assert.equal(await draftValue(input), '前后'); await input.press('Control+z'); assert.equal(await draftValue(input), '前[tv_doge]后');
    await page.screenshot({ path: join(out, name + '-inline-emote.png') });
    assert.deepEqual(errors, []); results.push(name + ': atomic emoji deletion');
    console.log('PASS ' + name + ' rich message editor');
  } finally { await browser.close(); writeFileSync(join(out, 'results.json'), JSON.stringify({ results }, null, 2)); }
}
