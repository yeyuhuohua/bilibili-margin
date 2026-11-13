import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ backfill: vi.fn() }));
vi.mock('../../src/content/footprint/store', async importOriginal => ({ ...await importOriginal<object>(), backfill: fixture.backfill }));
vi.mock('../../src/shared/settings', () => ({ loadSettings: async () => ({ enabled: true, privacyExternal: true }) }));

let data: Record<string, unknown>;
const completed = { status: 'ok', pages: 42, entries: 1200, days: 23 };
beforeEach(() => {
  vi.resetModules(); data = {};
  fixture.backfill.mockReset().mockResolvedValue({ ...completed });
  vi.stubGlobal('navigator', {});
  vi.stubGlobal('chrome', { runtime: { getURL: () => 'chrome-extension://fixture/' }, storage: { local: {
    get: vi.fn(async (key: string) => ({ [key]: data[key] })),
    set: vi.fn(async (next: Record<string, unknown>) => { Object.assign(data, next); }),
  }, onChanged: { addListener: vi.fn() } } });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Firefox content-script boundaries', () => {
  it('does not replace a completed sync result with a Web Locks cross-compartment rejection', async () => {
    chrome.runtime.getURL = () => 'moz-extension://fixture/';
    const request = vi.fn(async (_name, _options, callback) => {
      await callback({});
      throw new Error('Permission denied to access property "then"');
    });
    vi.stubGlobal('navigator', { locks: { request } });
    const { syncHistory, SYNC_KEY } = await import('../../src/content/footprint/sync');
    const result = await syncHistory(new Date(0));
    expect(result).toMatchObject(completed);
    expect(request).not.toHaveBeenCalled();
    expect(fixture.backfill).toHaveBeenCalledTimes(1);
    expect(data[SYNC_KEY]).toMatchObject({ result: completed });
  });
  it('does not access the page LockManager getter in Firefox and still shares an in-flight job', async () => {
    chrome.runtime.getURL = () => 'moz-extension://fixture/';
    const getter = vi.fn(() => { throw new Error('Permission denied'); });
    vi.stubGlobal('navigator', Object.defineProperty({}, 'locks', { get: getter }));
    const { syncHistory } = await import('../../src/content/footprint/sync');
    const first = syncHistory(new Date(0)), second = syncHistory(new Date(0));
    expect(first).toBe(second);
    expect(await first).toMatchObject(completed);
    expect(getter).not.toHaveBeenCalled();
  });
  it('retains Chromium cross-tab exclusion and busy reporting', async () => {
    const request = vi.fn(async (_name, _options, callback) => callback(null));
    vi.stubGlobal('navigator', { locks: { request } });
    const { syncHistory } = await import('../../src/content/footprint/sync');
    expect(await syncHistory(new Date(0))).toEqual({ status: 'busy', pages: 0, days: 0, entries: 0 });
    expect(request).toHaveBeenCalledWith('margin-footprint-history-v2', { ifAvailable: true }, expect.any(Function));
    expect(fixture.backfill).not.toHaveBeenCalled();
  });
  it('still reports real storage failures and preserves completed page counts', async () => {
    chrome.runtime.getURL = () => 'moz-extension://fixture/';
    vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(new Error('quota'));
    const { syncHistory } = await import('../../src/content/footprint/sync');
    expect(await syncHistory(new Date(0))).toMatchObject({ ...completed, status: 'fail', reason: 'storage' });
  });
  it('uses safe query/header traversal even when native keys iterators are not Xray iterable', async () => {
    const noIterator = () => ({ next: () => ({ done: true, value: undefined }) }) as unknown as IterableIterator<string>;
    const queryKeys = vi.spyOn(URLSearchParams.prototype, 'keys').mockImplementation(noIterator);
    const headerKeys = vi.spyOn(Headers.prototype, 'keys').mockImplementation(noIterator);
    const fetcher = vi.fn(async () => new Response('{}')); vi.stubGlobal('fetch', fetcher);
    const { optionalFetch } = await import('../../src/shared/privacy');
    await optionalFetch('weather', 'https://api.open-meteo.com/v1/forecast?latitude=30.67&longitude=104.07', { headers: { Accept: 'application/json' } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' }));
    expect(queryKeys).not.toHaveBeenCalled(); expect(headerKeys).not.toHaveBeenCalled();
  });
  it('continues rejecting sensitive parameters and headers without iterator access', async () => {
    const noIterator = () => ({ next: () => ({ done: true, value: undefined }) }) as unknown as IterableIterator<string>;
    vi.spyOn(URLSearchParams.prototype, 'keys').mockImplementation(noIterator);
    vi.spyOn(Headers.prototype, 'keys').mockImplementation(noIterator);
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const { optionalFetch } = await import('../../src/shared/privacy');
    await expect(optionalFetch('ip', 'https://ipwho.is/?access_key=private')).rejects.toThrow('不允许的参数');
    await expect(optionalFetch('ip', 'https://ipwho.is/', { headers: { Authorization: 'private' } })).rejects.toThrow('请求头不受支持');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
