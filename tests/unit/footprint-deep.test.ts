import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

let calls: number, available: number, messages: any[], data: Record<string, unknown>;
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-09T12:00:00Z'));
  calls = 0; available = 500; messages = []; data = {};
  vi.stubGlobal('navigator', {});
  vi.stubGlobal('fetch', vi.fn(async () => {
    const i = calls++;
    return { ok: true, json: async () => ({ code: 0, data: { list: i < available ? [{ view_at: 1794225600 - i * 86400, duration: 60, progress: 60, history: { bvid: `BVhistory${i}`, business: 'archive' } }] : [], cursor: { max: i + 1, view_at: 1794225600 - i * 86400, business: 'archive' } } }) };
  }));
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(async m => { messages.push(m); return { ok: true, data: {} }; }) }, storage: { local: { get: async (key: string) => ({ [key]: data[key] }), set: async (patch: object) => { Object.assign(data, patch); } } } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const finish = async <T>(job: Promise<T>) => { await vi.runAllTimersAsync(); return job; };
const since = () => new Date('2025-11-01T00:00:00Z');

describe('bounded manual history expansion', () => {
  it('automatic reads retain the 60-page budget and discard an incomplete oldest day', async () => {
    const { backfill } = await import('../../src/content/footprint/store');
    const result = await finish(backfill(since()));
    expect(calls).toBe(60); expect(result.reason).toBe('limit'); expect(result.days).toBe(59);
  });
  it('manual expansion reads past page 60 and stops when the endpoint is exhausted', async () => {
    available = 61;
    const { backfill } = await import('../../src/content/footprint/store');
    const result = await finish(backfill(since(), undefined, { deep: true }));
    expect(calls).toBe(62); expect(result.status).toBe('ok'); expect(result.entries).toBe(61); expect(result.days).toBe(61);
  });
  it('manual reads still stop at 200 pages', async () => {
    const { backfill } = await import('../../src/content/footprint/store');
    const result = await finish(backfill(since(), undefined, { deep: true }));
    expect(calls).toBe(200); expect(result.reason).toBe('limit'); expect(result.days).toBe(199);
  });
  it('reports monotonic real page/entry progress', async () => {
    available = 2; const progress = vi.fn();
    const { backfill } = await import('../../src/content/footprint/store');
    await finish(backfill(since(), undefined, { deep: true, onProgress: progress }));
    expect(progress.mock.calls).toEqual([[1, 1], [2, 2], [3, 2]]);
  });
  it('manual expansion can follow an automatic limit without waiting six hours', async () => {
    available = 61;
    const { syncHistory, SYNC_KEY } = await import('../../src/content/footprint/sync');
    data[SYNC_KEY] = { version: 2, at: Date.now(), nextRetry: Date.now() + 21600000, failures: 1, result: { status: 'partial', reason: 'limit', pages: 60, entries: 60, days: 59 } };
    const result = await finish(syncHistory(since(), { force: true, deep: true }));
    expect(calls).toBe(62); expect(result.status).toBe('ok');
  });
  it('an aborted manual request does not issue network requests or clear records', async () => {
    const controller = new AbortController(); controller.abort();
    const { backfill } = await import('../../src/content/footprint/store');
    const result = await backfill(since(), controller.signal, { deep: true });
    expect(result.reason).toBe('cancelled'); expect(calls).toBe(0); expect(messages).toHaveLength(0);
  });
});
