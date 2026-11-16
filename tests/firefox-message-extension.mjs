// node tests/firefox-message-extension.mjs — requires the Playwright Firefox installation.
// Installs an isolated temporary MV3 addon; never opens a real Bilibili account.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as tcpServer } from 'node:net';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { firefox } from 'playwright';
import { spawn } from 'node:child_process';
import { build } from 'vite';

const out = resolve(process.env.SMOKE_OUT || 'delivery/issues-181-184/firefox-editor');
mkdirSync(out, { recursive: true });
const addon = mkdtempSync(join(out, 'addon-'));
await build({ configFile: false, publicDir: false, logLevel: 'warn', build: {
  outDir: addon, emptyOutDir: false, minify: false,
  lib: { entry: resolve('tests/fixtures/firefox-message-editor.ts'), name: 'interop', formats: ['iife'], fileName: () => 'content.js' },
} });
writeFileSync(join(addon, 'manifest.json'), JSON.stringify({
  manifest_version: 3, name: 'MARGIN isolated Firefox interop test', version: '1.0.0',
  permissions: ['storage'], host_permissions: ['http://127.0.0.1/*'],
  background: { scripts: ['background.js'] },
  content_scripts: [{ matches: ['http://127.0.0.1/*'], js: ['content.js'], run_at: 'document_idle' }],
  browser_specific_settings: { gecko: { id: 'margin-interop@local.invalid' } },
}));
writeFileSync(join(addon, 'background.js'), "browser.runtime.onMessage.addListener(message => message.margin === 'fp' ? Promise.resolve({ok:true,data:{}}) : undefined);");
const server = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><body>Firefox content-script boundary test</body>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const portProbe = tcpServer();
await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve));
const port = portProbe.address().port;
await new Promise(resolve => portProbe.close(resolve));
const report = { scope: 'Native Firefox MV3 private-message composer in shadow DOM; no real account or sending' };
let context, processHandle, socket, nextId = 1;
const pending = new Map();
try {
  const profile = mkdtempSync(join(out, 'profile-'));
  if (!process.env.FIREFOX_PATH) context = await firefox.launchPersistentContext(profile, { headless:true,args:['--remote-debugging-port',String(port)] });
  else {
  processHandle = spawn(process.env.FIREFOX_PATH, ['-headless','-no-remote','-profile',profile,'--remote-debugging-port',String(port)], { windowsHide: true, stdio: 'pipe' });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Native Firefox startup timeout')), 20000);
    processHandle.stderr.on('data', data => { if (String(data).includes('WebDriver BiDi listening')) { clearTimeout(timer); resolve(); } });
    processHandle.once('error', error => { clearTimeout(timer); reject(error); });
    processHandle.once('exit', code => { clearTimeout(timer); reject(new Error('Firefox exited: '+code)); });
  });
  }
  socket = new WebSocket(`ws://127.0.0.1:${port}/session`);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Firefox BiDi connection timeout')), 15000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', error => { clearTimeout(timer); reject(error); }, { once: true });
  });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data), request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.type === 'error') request.reject(new Error(JSON.stringify(message)));
    else request.resolve(message.result);
  });
  const command = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++, timer = setTimeout(() => {
      pending.delete(id); reject(new Error('BiDi timeout: ' + method));
    }, 15000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  report.browser = (await command('session.new', { capabilities: {} })).capabilities?.browserVersion;
  await command('webExtension.install', { extensionData: { type: 'path', path: addon }, 'moz:allowPrivateBrowsing': true });
  let evaluate, key;
  if (context) {
    const page=await context.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/`);
    evaluate=expression=>page.evaluate(expression);
    const keys={'\uE010':'End','\uE011':'Home','\uE003':'Backspace','\uE017':'Delete'};
    key=value=>value.codePointAt(0)>127&&!keys[value]?page.keyboard.insertText(value):page.keyboard.press(keys[value]||value);
  } else {
    const { context: tab } = await command('browsingContext.create', { type: 'tab' });
    await command('browsingContext.navigate', { context: tab, url: `http://127.0.0.1:${server.address().port}/`, wait: 'complete' });
    evaluate = async expression => {
      const result = await command('script.evaluate', { expression, target: { context: tab }, awaitPromise: true });
      if (result.type === 'exception') throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    key = async value => command('input.performActions',{context:tab,actions:[{type:'key',id:'keyboard',actions:[{type:'keyDown',value},{type:'keyUp',value}]}]});
  }
  await evaluate(`new Promise(resolve => { const check=()=>document.querySelector('#editor-extension-test')?.shadowRoot?.querySelector('.wh-input') ? resolve(true) : setTimeout(check,20);check(); })`);
  await evaluate(`document.querySelector('#editor-extension-test').shadowRoot.querySelector('.wh-input').focus();true`);
  for (const character of 'abc') await key(character);
  await key('\uE010');await key('\uE003');
  report.afterBackspace = JSON.parse(await evaluate(`document.getElementById('editor-extension-report').textContent`));
  await key('\uE011');await key('\uE017');
  report.afterDelete = JSON.parse(await evaluate(`document.getElementById('editor-extension-report').textContent`));
  assert.equal(report.afterBackspace.text,'ab');assert.equal(report.afterDelete.text,'b');
  for (const character of '中文') await key(character);
  await key('\uE003');
  report.afterChineseDelete = JSON.parse(await evaluate(`document.getElementById('editor-extension-report').textContent`));
  assert.equal(report.afterChineseDelete.text,'中b');
  await evaluate(`(()=>{const input=document.querySelector('#editor-extension-test').shadowRoot.querySelector('.wh-input');const image=document.createElement('img');image.dataset.messageEmote='[开心]';image.contentEditable='false';input.replaceChildren(document.createTextNode('前'),image,document.createTextNode('后'));input.focus();const r=document.createRange();r.setStartAfter(image);r.collapse(true);getSelection().removeAllRanges();getSelection().addRange(r);input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
  await key('\uE003');
  report.afterEmojiDelete = JSON.parse(await evaluate(`document.getElementById('editor-extension-report').textContent`));
  assert.equal(report.afterEmojiDelete.text,'前后');
  console.log(JSON.stringify({browser:report.browser,checks:['Backspace','Delete','Chinese text','inline emoji']},null,2));
} catch (error) { report.error = String(error); throw error; }
finally {
  writeFileSync(join(out, 'results.json'), JSON.stringify(report, null, 2));
  socket?.close(); await context?.close(); processHandle?.kill(); await new Promise(resolve => server.close(resolve));
}
