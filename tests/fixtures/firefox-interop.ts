import { optionalFetch } from '../../src/shared/privacy';
import { syncHistory, SYNC_KEY } from '../../src/content/footprint/sync';

// Runs inside a real Firefox content script. Only history/weather HTTP responses
// are fixtures; Web Locks, Xrays, extension storage and messaging remain native.
void (async () => {
  const report: Record<string, unknown> = { firefox: chrome.runtime.getURL('').startsWith('moz-extension:') };
  await chrome.storage.local.set({ 'margin:settings': { enabled: true, privacyExternal: true } });
  let pages = 0;
  globalThis.fetch = async address => {
    if (!String(address).includes('history/cursor')) return new Response('{}');
    const page = pages++, at = Math.floor(Date.now() / 1000) - 3600;
    return new Response(JSON.stringify({ code: 0, data: {
      list: page ? [] : [{ view_at: at, duration: 600, progress: 300, history: { bvid: 'BVfixture001', business: 'archive' } }],
      cursor: { max: page + 1, view_at: at, business: 'archive' },
    } }));
  };
  try {
    await optionalFetch('weather', 'https://api.open-meteo.com/v1/forecast?latitude=30&longitude=104', { headers: { Accept: 'application/json' } });
    report.weather = { ok: true };
  } catch (error) { report.weather = { ok: false, error: String(error) }; }
  const first = syncHistory(new Date(Date.now() - 86400_000));
  report.deduplicated = first === syncHistory(new Date(Date.now() - 86400_000));
  report.sync = await first;
  report.historyPages = pages;
  report.saved = (await chrome.storage.local.get(SYNC_KEY))[SYNC_KEY];
  return report;
})().then(report => {
  const result = document.createElement('pre');
  result.id = 'firefox-interop-result'; result.textContent = JSON.stringify(report); document.body.append(result);
}).catch(error => {
  const result = document.createElement('pre');
  result.id = 'firefox-interop-result'; result.textContent = JSON.stringify({ fatal: String(error) }); document.body.append(result);
});
