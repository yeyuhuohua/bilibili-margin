// node tests/firefox-interop.mjs — requires the Playwright Firefox installation.
// Installs an isolated temporary MV3 addon; never opens a real Bilibili account.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as tcpServer } from 'node:net';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { firefox } from 'playwright';
import { build } from 'vite';

const out = resolve(process.env.SMOKE_OUT || 'tests/artifacts/firefox-interop');
mkdirSync(out, { recursive: true });
const addon = mkdtempSync(join(out, 'addon-'));
await build({ configFile: false, publicDir: false, logLevel: 'warn', build: {
  outDir: addon, emptyOutDir: false, minify: false,
  lib: { entry: resolve('tests/fixtures/firefox-interop.ts'), name: 'interop', formats: ['iife'], fileName: () => 'content.js' },
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
const report = { scope: 'Native Firefox MV3 content-script environment, synthetic history/weather responses' };
let context, socket, nextId = 1;
const pending = new Map();
try {
  context = await firefox.launchPersistentContext(mkdtempSync(join(out, 'profile-')), {
    headless: true, args: ['--remote-debugging-port', String(port)],
  });
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
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const result = page.locator('#firefox-interop-result');
  await result.waitFor({ timeout: 15000 }); report.result = JSON.parse(await result.textContent());
  assert.equal(report.result.firefox, true);
  assert.equal(report.result.weather.ok, true);
  assert.equal(report.result.deduplicated, true);
  assert.equal(report.result.sync.status, 'ok');
  assert.equal(report.result.sync.pages, 2);
  assert.equal(report.result.sync.entries, 1);
  assert.equal(report.result.historyPages, 2);
  assert.equal(report.result.saved.result.status, 'ok');
  console.log(JSON.stringify(report, null, 2));
} catch (error) { report.error = String(error); throw error; }
finally {
  writeFileSync(join(out, 'results.json'), JSON.stringify(report, null, 2));
  socket?.close(); await context?.close(); await new Promise(resolve => server.close(resolve));
}
