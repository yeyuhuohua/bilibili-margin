import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let api: typeof import('../../src/content/api/msg');
let listener: (changes: Record<string, unknown>, area: string) => void;
const set = vi.fn(async () => {});
const removeListener = vi.fn();
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers(); set.mockClear(); removeListener.mockClear();
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('chrome', { storage: { local: { set }, onChanged: { addListener: (fn: typeof listener) => { listener = fn; }, removeListener } } });
  api = await import('../../src/content/api/msg');
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const response = (reply: number) => new Response(JSON.stringify({ code: 0, data: { reply, follow_unread: 0, unfollow_unread: 0 } }));

describe('cross-tab unread synchronization', () => {
  it('coalesces a burst while broadcasting later reads within ten seconds', async () => {
    api.markMsgRead(); api.markMsgRead(); api.markMsgRead();
    await vi.advanceTimersByTimeAsync(150);
    expect(set).toHaveBeenCalledTimes(1);
    api.markMsgRead();
    await vi.advanceTimersByTimeAsync(150);
    expect(set).toHaveBeenCalledTimes(2);
  });
  it('debounces receiver updates and cancels delayed retries on disposal', async () => {
    const callback = vi.fn();
    const stop = api.onMsgRead(callback);
    listener({ 'margin:msg-read': { newValue: 1 } }, 'sync');
    expect(callback).not.toHaveBeenCalled();
    listener({ 'margin:msg-read': { newValue: 2 } }, 'local');
    listener({ 'margin:msg-read': { newValue: 3 } }, 'local');
    await vi.advanceTimersByTimeAsync(80);
    expect(callback).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1420);
    expect(callback).toHaveBeenCalledTimes(2);
    listener({ 'margin:msg-read': { newValue: 4 } }, 'local');
    stop(); await vi.advanceTimersByTimeAsync(1600);
    expect(callback).toHaveBeenCalledTimes(2);
    expect(removeListener).toHaveBeenCalledWith(listener);
  });
  it('shares simultaneous count requests across header and message panels', async () => {
    const fetcher = vi.fn(async () => response(5)); vi.stubGlobal('fetch', fetcher);
    const a = api.unread(), b = api.unread();
    expect(a).toBe(b);
    expect((await a).reply).toBe(5);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('supersedes responses issued before a successful read', async () => {
    const pending: ((response: Response) => void)[] = [];
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => pending.push(resolve))));
    const stale = api.unread();
    api.markMsgRead();
    vi.stubGlobal('fetch', vi.fn(async () => response(0)));
    const fresh = await api.unread();
    pending.forEach(resolve => resolve(response(8)));
    expect((await stale).reply).toBe(0);
    expect(fresh.reply).toBe(0);
  });
});
