import { afterEach, expect, it, vi } from 'vitest';
import { appPoll } from '../../src/content/api/appfeed';

afterEach(() => vi.unstubAllGlobals());

it('reports failed background credential saves instead of successful authorization', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, data: { access_token: 'fixture_token_123456', mid: 123, expires_in: 3600 } }))));
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(async () => ({ ok: false, error: '保存失败' })) } });
  expect(await appPoll('abcd')).toEqual({ ok: false, state: 'error', error: '保存失败' });
});
