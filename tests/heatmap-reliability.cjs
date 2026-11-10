/* Run from the repository: node --test tests/heatmap-reliability.cjs
 * Uses the project's existing TypeScript compiler; no additional test dependency.
 * Real production modules run with an in-memory Chrome/API boundary, not real Bilibili data.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require(process.env.MARGIN_TYPESCRIPT || 'typescript');
const ROOT = path.resolve(__dirname, '..');
const KEY = 'margin:activity', META = 'margin:activity-sync-v2', OLD = 'margin:activity-bf';
const LEGACY = 'margin-activity-v1', MIGRATED = 'margin:activity-migrated-v2';
const realDate = Date;
const plain = x => JSON.parse(JSON.stringify(x));
const epoch = s => +new Date(`${s}T12:00:00Z`) / 1000;
const item = (date, progress = 180, id = date) => ({ view_at: epoch(date), duration: 600, progress, history: { business: 'archive', bvid: id } });
const response = (list, cursor = { max: 0, view_at: 0, business: '' }) => ({ ok: true, json: async () => ({ code: 0, data: { list, cursor } }) });
const since = () => new Date('2025-11-01T00:00:00Z');

function harness(options = {}) {
  const state = structuredClone(options.state || {});
  const calls = { fetch: [], sends: [], sets: [] };
  let now = +new Date('2026-11-09T09:50:00Z'), setFailure = options.setFailure || false;
  let queue = Promise.resolve();
  class Clock extends realDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const chrome = {
    storage: {
      local: {
        async get(keys) {
          if (options.getFailure) throw new Error('read denied');
          if (typeof keys === 'string') keys = [keys];
          return structuredClone(Object.fromEntries((keys || Object.keys(state)).filter(k => k in state).map(k => [k, state[k]])));
        },
        async set(values) {
          calls.sets.push(structuredClone(values));
          if (setFailure || (options.failSet && options.failSet(values))) throw new Error('quota exceeded');
          Object.assign(state, structuredClone(values));
        },
      },
    },
    runtime: {
      async sendMessage(m) {
        calls.sends.push(structuredClone(m));
        if (options.sender) return options.sender(m);
        const p = queue.then(() => load('src/background/footprint.ts').handleFootprint(m));
        queue = p.catch(() => {});
        // sw.ts returns {ok:false} to the sender on a handler failure.
        return p.catch(e => ({ ok: false, error: String(e) }));
      },
    },
  };
  let fetchCount = 0;
  const context = vm.createContext({
    console, chrome, Date: Clock, URL, URLSearchParams, AbortController, DOMException,
    navigator: options.navigator || {},
    setTimeout: (fn, ms) => setTimeout(fn, ms === 250 ? 0 : ms >= 8000 ? 15 : ms),
    clearTimeout,
    fetch: async (url, init) => {
      calls.fetch.push({ url, init });
      const n = fetchCount++;
      if (options.fetch) return options.fetch(url, init, n);
      const r = (options.responses || [response([])])[n];
      if (!r) throw new Error('unexpected request');
      if (r instanceof Error) throw r;
      return r;
    },
  });
  const cache = new Map();
  function load(name) {
    const abs = path.resolve(ROOT, name.endsWith('.ts') ? name : name + '.ts');
    if (cache.has(abs)) return cache.get(abs).exports;
    const source = fs.readFileSync(abs, 'utf8');
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: abs }).outputText;
    const mod = { exports: {} }; cache.set(abs, mod);
    vm.runInContext(`(function(require,module,exports){${js}\n})`, context, { filename: abs })(
      id => load(path.relative(ROOT, path.resolve(path.dirname(abs), id))), mod, mod.exports);
    return mod.exports;
  }
  return { state, calls, chrome, load, setNow: value => { now = value; }, now: () => now, allowWrites: () => { setFailure = false; },
    store: load('src/content/footprint/store.ts'), sync: load('src/content/footprint/sync.ts'), backend: load('src/background/footprint.ts') };
}

test('legacy records merge even after a heartbeat creates the current key; old source retained', async () => {
  const h = harness({ state: { [KEY]: { '2026-11-09': { s: 60, f: '09:00' } }, [LEGACY]: { '2026-10-01': { s: 600 }, '2026-11-09': { s: 30, f: '08:00' } } } });
  const r = await h.store.loadActivity();
  assert.equal(r['2026-10-01'].s, 600); assert.equal(r['2026-11-09'].s, 60);
  assert.equal(r['2026-11-09'].f, '08:00'); assert.equal(h.state[MIGRATED], true);
  assert.ok(h.state[LEGACY]);
  await h.store.loadActivity(); assert.equal(h.calls.sets.length, 1);
});
test('legacy-only read migrates and returns data', async () => {
  const h = harness({ state: { [LEGACY]: { '2026-10-01': { s: 900 } } } });
  assert.equal((await h.store.loadActivity())['2026-10-01'].s, 900);
});
test('failed migration writes neither the marker nor a replacement history', async () => {
  const h = harness({ setFailure: true, state: { [LEGACY]: { '2026-10-01': { s: 900 } } } });
  await assert.rejects(h.store.loadActivity()); assert.equal(h.state[MIGRATED], undefined); assert.equal(h.state[KEY], undefined);
  h.allowWrites(); assert.equal((await h.store.loadActivity())['2026-10-01'].s, 900);
});
test('read acknowledgements are validated, including missing data', async () => {
  for (const reply of [undefined, { ok: false }, { ok: true }, { ok: true, data: [] }]) {
    await assert.rejects(harness({ sender: async () => reply }).store.loadActivity());
  }
});
test('overlapping heartbeats are counted once and cannot overwrite migrated records', async () => {
  const h = harness({ state: { [LEGACY]: { '2026-10-01': { s: 600 } } } });
  const message = { margin: 'fp', op: 'beat', from: h.now() - 60000, to: h.now() };
  await Promise.all([h.chrome.runtime.sendMessage(message), h.chrome.runtime.sendMessage(message)]);
  const data = await h.store.loadActivity();
  assert.equal(data['2026-10-01'].s, 600); assert.equal(data['2026-11-09'].s, 60);
});
test('invalid heartbeat intervals are rejected', async () => {
  const h = harness();
  for (const [from, to] of [[NaN, 12], [1, Infinity], [2, 1]])
    assert.equal((await h.backend.handleFootprint({ margin: 'fp', op: 'beat', from, to })).ok, false);
});
test('history merge preserves larger old estimates, local seconds and earlier first times', async () => {
  const h = harness({ state: { [KEY]: { '2026-11-08': { s: 600, h: 5000, f: '09:00', hf: '08:00' } } } });
  await h.backend.handleFootprint({ margin: 'fp', op: 'merge', days: { '2026-11-08': { h: 0, hf: '10:00' } } });
  assert.deepEqual(h.state[KEY]['2026-11-08'], { s: 600, h: 5000, f: '09:00', hf: '08:00' });
});
test('backup import retains merge semantics', async () => {
  const h = harness({ state: { [KEY]: { '2026-11-08': { s: 600 } } } });
  const r = await h.backend.handleFootprint({ margin: 'fp', op: 'import', days: { '2026-11-08': { s: 900, f: '09:00' } } });
  assert.equal(r.ok, true); assert.equal(h.state[KEY]['2026-11-08'].s, 900);
});
test('60-second threshold, source preference and conservative history cap remain intact', () => {
  const { store: s } = harness();
  assert.equal(s.activeOf({ s: 59 }), false); assert.equal(s.activeOf({ s: 60 }), true);
  assert.equal(s.secondsOf({ s: 60, h: 5000 }), 60);
  assert.equal(s.itemSeconds({ progress: -1, duration: 4000 }), 1200);
  assert.equal(s.itemSeconds({ progress: 0, duration: 600 }), 0);
  assert.equal(s.itemSeconds({ progress: Infinity, duration: Infinity }), 0);
  assert.equal(s.itemSeconds({ progress: -2, duration: 600 }), 0);
});
test('successful history is written with credentials and acknowledged before success', async () => {
  const h = harness({ responses: [response([item('2026-11-08')])] });
  const r = await h.store.backfill(since());
  assert.equal(r.status, 'ok'); assert.equal(r.days, 1); assert.equal(h.state[KEY]['2026-11-08'].h, 180);
  assert.equal(h.calls.fetch[0].init.credentials, 'include');
  assert.equal(new URL(h.calls.fetch[0].url).hostname, 'api.bilibili.com');
});
test('zero progress is not fabricated into a lit day', async () => {
  const h = harness({ responses: [response([item('2026-11-08', 0)])] });
  const r = await h.store.backfill(since());
  assert.equal(r.status, 'ok'); assert.equal(h.store.activeOf(h.state[KEY]['2026-11-08']), false);
  assert.equal(h.store.sourceOf(h.state[KEY]['2026-11-08']), 'history');
  assert.match(h.sync.syncNote(r, h.state[KEY]), /不足 1 分钟/);
});
test('max=0 with a nonzero view_at cursor continues pagination', async () => {
  const h = harness({ responses: [response([item('2026-11-08')], { max: 0, view_at: epoch('2026-11-08') }), response([item('2026-11-07')])] });
  const r = await h.store.backfill(since()); assert.equal(r.status, 'ok'); assert.equal(r.days, 2); assert.equal(h.calls.fetch.length, 2);
});
test('a second-page network error yields partial and does not write the incomplete oldest day', async () => {
  const h = harness({ responses: [response([item('2026-11-08'), item('2026-11-07')], { max: 1, view_at: epoch('2026-11-07') }), new Error('offline')] });
  const r = await h.store.backfill(since()); assert.equal(r.status, 'partial'); assert.equal(r.reason, 'network'); assert.equal(r.days, 1);
  assert.ok(h.state[KEY]['2026-11-08']); assert.equal(h.state[KEY]['2026-11-07'], undefined);
});
test('first-page login failure is distinguished from a network failure', async () => {
  const h = harness({ responses: [{ ok: true, json: async () => ({ code: -101 }) }] });
  assert.equal((await h.store.backfill(since())).status, 'nologin');
});
test('mid-pagination login expiry is partial, not complete', async () => {
  const h = harness({ responses: [response([item('2026-11-08'), item('2026-11-07')], { max: 1 }), { ok: true, json: async () => ({ code: -101 }) }] });
  const r = await h.store.backfill(since()); assert.equal(r.status, 'partial'); assert.equal(r.reason, 'nologin');
});
test('HTTP errors are not treated as JSON success', async () => {
  const h = harness({ responses: [{ ok: false, json: async () => ({ code: 0, data: { list: [] } }) }] });
  assert.equal((await h.store.backfill(since())).reason, 'http');
});
test('missing list, invalid code and non-JSON responses are explicit errors', async () => {
  const bad = [{ code: 0 }, { code: 0, data: { list: {} } }, {}, null];
  for (const value of bad) {
    const r = await harness({ responses: [{ ok: true, json: async () => value }] }).store.backfill(since());
    assert.equal(r.status, 'fail'); assert.equal(r.reason, 'malformed');
  }
  assert.equal((await harness({ responses: [{ ok: true, json: async () => { throw new Error('bad JSON'); } }] }).store.backfill(since())).reason, 'malformed');
});
test('non-login API errors remain failures', async () => {
  assert.equal((await harness({ responses: [{ ok: true, json: async () => ({ code: -412 }) }] }).store.backfill(since())).reason, 'api');
});
test('repeated cursor stops and duplicate identified entries are not counted twice', async () => {
  const page = response([item('2026-11-08'), item('2026-11-07')], { max: 1, view_at: 1 });
  const h = harness({ responses: [page, page] });
  const r = await h.store.backfill(since()); assert.equal(r.status, 'partial'); assert.equal(r.reason, 'cursor'); assert.equal(r.entries, 2);
  assert.equal(h.state[KEY]['2026-11-08'].h, 180); assert.equal(h.calls.fetch.length, 2);
});
test('missing cursor on a nonempty page is partial instead of a false terminal success', async () => {
  const h = harness({ responses: [{ ok: true, json: async () => ({ code: 0, data: { list: [item('2026-11-08')] } }) }] });
  assert.equal((await h.store.backfill(since())).reason, 'cursor');
});
test('the 60-page limit is reported as partial; not a six-hour success', async () => {
  const h = harness({ fetch: async (_, __, i) => response([item('2026-11-08', 1, `BV${i}`)], { max: i + 1, view_at: i + 1 }) });
  const r = await h.sync.syncHistory(since()); assert.equal(r.status, 'partial'); assert.equal(r.reason, 'limit');
  assert.equal(r.pages, 60); assert.equal(h.state[OLD], undefined); assert.equal(h.state[META].result.status, 'partial');
});
test('records outside the requested date range are not imported', async () => {
  const h = harness({ responses: [response([item('2025-10-01')], { max: 1 })] });
  const r = await h.store.backfill(since()); assert.equal(r.status, 'empty'); assert.equal(r.days, 0); assert.equal(h.state[KEY], undefined);
});
test('malformed timestamps do not create NaN dates or success metadata', async () => {
  const h = harness({ responses: [response([{ view_at: 'bad', duration: 60, progress: 60 }])] });
  const r = await h.sync.syncHistory(since()); assert.equal(r.status, 'partial'); assert.equal(r.reason, 'malformed');
  assert.equal(h.state[OLD], undefined);
});
test('negative worker acknowledgement blocks success', async () => {
  const h = harness({ responses: [response([item('2026-11-08')])], sender: async () => ({ ok: false }) });
  const r = await h.sync.syncHistory(since()); assert.equal(r.status, 'fail'); assert.equal(r.reason, 'storage'); assert.equal(h.state[OLD], undefined);
});
test('rejected worker request blocks success', async () => {
  const h = harness({ responses: [response([item('2026-11-08')])], sender: async () => { throw new Error('Extension context invalidated'); } });
  assert.equal((await h.store.backfill(since())).reason, 'storage');
});
test('unanswered worker request times out', async () => {
  await assert.rejects(harness({ sender: () => new Promise(() => {}) }).store.loadActivity(), /超时/);
});
test('a hanging fetch is aborted and reported as timeout', async () => {
  const h = harness({ fetch: (_, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))) });
  assert.equal((await h.store.backfill(since())).reason, 'timeout');
});
test('pre-aborted backfill makes no request and writes nothing', async () => {
  const h = harness(); const a = new AbortController(); a.abort();
  assert.equal((await h.sync.syncHistory(since(), { signal: a.signal })).reason, 'cancelled');
  assert.equal(h.calls.fetch.length, 0); assert.equal(h.calls.sets.length, 0);
});
test('an aborted in-flight request is not cached as a failure or success', async () => {
  const h = harness({ fetch: (_, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))) });
  const a = new AbortController(); const p = h.sync.syncHistory(since(), { signal: a.signal });
  await new Promise(r => setTimeout(r, 1)); a.abort();
  assert.equal((await p).reason, 'cancelled'); assert.equal(h.state[META], undefined);
});
test('old success timestamp is ignored on the first repaired sync', async () => {
  const h = harness({ state: { [OLD]: +new Date('2026-11-09T09:49:00Z') }, responses: [response([item('2026-11-08')])] });
  const r = await h.sync.syncHistory(since()); assert.equal(r.status, 'ok'); assert.equal(h.calls.fetch.length, 1);
  assert.equal(h.state[META].nextRetry - h.state[META].at, 6 * 3600000);
});
test('a complete acknowledged sync is cached for six hours', async () => {
  const h = harness({ responses: [response([item('2026-11-08')])] });
  await h.sync.syncHistory(since()); h.setNow(h.now() + 60000);
  assert.equal((await h.sync.syncHistory(since())).cached, true); assert.equal(h.calls.fetch.length, 1);
});
test('empty history has a short retry window rather than six hours', async () => {
  const h = harness(); const r = await h.sync.syncHistory(since());
  assert.equal(r.status, 'empty'); assert.equal(h.state[META].nextRetry - h.state[META].at, 300000); assert.equal(h.state[OLD], undefined);
});
test('failure uses progressive backoff; manual retry has a 15-second cooldown', async () => {
  const h = harness({ fetch: async () => { throw new Error('offline'); } });
  await h.sync.syncHistory(since()); assert.equal(h.state[META].nextRetry - h.state[META].at, 30000);
  assert.equal((await h.sync.syncHistory(since(), { force: true })).cached, true);
  h.setNow(h.now() + 16000); await h.sync.syncHistory(since(), { force: true });
  assert.equal(h.state[META].nextRetry - h.state[META].at, 120000);
  assert.equal(h.calls.fetch.length, 2); assert.equal(h.state[OLD], undefined);
});
test('automatic retry succeeds once backoff expires', async () => {
  const h = harness({ responses: [new Error('offline'), response([item('2026-11-08')])] });
  await h.sync.syncHistory(since()); h.setNow(h.now() + 31000);
  assert.equal((await h.sync.syncHistory(since())).status, 'ok'); assert.equal(h.state[META].failures, 0);
});
test('metadata write failure is reported instead of showing successful sync', async () => {
  const h = harness({ responses: [response([item('2026-11-08')])], failSet: v => META in v });
  const r = await h.sync.syncHistory(since()); assert.equal(r.status, 'fail'); assert.equal(r.reason, 'storage');
  assert.ok(h.state[KEY]['2026-11-08']); assert.equal(h.state[META], undefined);
});
test('concurrent calls share one pending synchronization', async () => {
  const h = harness({ responses: [response([item('2026-11-08')])] });
  const a = h.sync.syncHistory(since()), b = h.sync.syncHistory(since());
  assert.equal(a, b); await a; assert.equal(h.calls.fetch.length, 1);
});
test('an occupied cross-tab Web Lock causes no requests or state writes', async () => {
  const h = harness({ navigator: { locks: { request: async (_, opts, cb) => { assert.equal(opts.ifAvailable, true); return cb(null); } } } });
  assert.equal((await h.sync.syncHistory(since())).status, 'busy'); assert.equal(h.calls.fetch.length, 0); assert.equal(h.calls.sets.length, 0);
});
test('an acquired cross-tab Web Lock runs the normal sync', async () => {
  const h = harness({ navigator: { locks: { request: async (_, opts, cb) => cb({ name: 'test' }) } } });
  assert.equal((await h.sync.syncHistory(since())).status, 'empty'); assert.equal(h.calls.fetch.length, 1);
});
test('bad or future sync state cannot indefinitely suppress recovery', () => {
  const h = harness();
  assert.equal(h.sync.parseSyncState({ version: 1 }), null);
  assert.equal(h.sync.parseSyncState({ version: 2, at: h.now() + 1e9, nextRetry: h.now() + 2e9, failures: 0, result: { status: 'ok', pages: 1, days: 1, entries: 1 } }), null);
});
test('empty and failure notices do not claim the user never opened Bilibili', () => {
  const h = harness();
  for (const r of [null, { status: 'empty' }, { status: 'fail' }, { status: 'nologin' }])
    assert.doesNotMatch(h.sync.syncNote(r, {}), /没有打开 B 站/);
});
test('malformed primary storage is reported without overwriting the stored value', async () => {
  const h = harness({ state: { [KEY]: 'unexpected-corrupt-value' } });
  await assert.rejects(h.store.loadActivity()); assert.equal(h.state[KEY], 'unexpected-corrupt-value');
});
test('a synchronous Web Lock exception becomes a handled failure', async () => {
  const h = harness({ navigator: { locks: { request: () => { throw new Error('denied'); } } } });
  assert.equal((await h.sync.syncHistory(since())).status, 'fail'); assert.equal(h.calls.fetch.length, 0);
});
test('metadata read failure is handled without starting an uncontrolled request', async () => {
  const h = harness({ getFailure: true });
  assert.equal((await h.sync.syncHistory(since())).reason, 'storage'); assert.equal(h.calls.fetch.length, 0);
});
test('quota failure preserves the previously stored activity', async () => {
  const original = { '2026-10-01': { s: 900, h: 1800 } };
  const h = harness({ setFailure: true, state: { [KEY]: original }, responses: [response([item('2026-11-08')])] });
  assert.equal((await h.store.backfill(since())).reason, 'storage'); assert.deepEqual(h.state[KEY], original);
});
