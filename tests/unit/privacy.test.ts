import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanHistory, SEARCH_HISTORY_KEY, SEARCH_HISTORY_TTL } from '../../src/shared/privacy';
import { handleHistory, protectAuthStorage, trustedSender } from '../../src/background/privacy';

let data: Record<string, unknown>;
let listeners: ((changes: Record<string, { newValue?: unknown }>, area: string) => void)[];
beforeEach(() => {
  data = { 'margin:settings': { privacyExternal: true, searchHistory: true } };
  listeners = [];
  vi.stubGlobal('chrome', {
    runtime: { getURL: (path: string) => `moz-extension://fixture/${path}` },
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: data[key] })),
        set: vi.fn(async (patch: Record<string, unknown>) => Object.assign(data, patch)),
        remove: vi.fn(async (key: string) => { delete data[key]; }),
      },
      session: { setAccessLevel: vi.fn(async () => {}) },
      onChanged: { addListener: vi.fn((listener) => listeners.push(listener)) },
    },
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('最近搜索最小化', () => {
  it('丢弃过期、未来、重复、超长和畸形记录，最多保留八条', () => {
    const now = Date.now();
    const entries = cleanHistory([
      { text: 'expired', at: now - SEARCH_HISTORY_TTL },
      { text: 'future', at: now + 1 }, null,
      { text: 'a'.repeat(201), at: now },
      { text: 'same', at: now }, { text: 'same', at: now },
      ...Array.from({ length: 12 }, (_, index) => ({ text: String(index), at: now })),
    ], now);
    expect(entries).toHaveLength(8);
    expect(entries.map(entry => entry.text)).toEqual(['same', '0', '1', '2', '3', '4', '5', '6']);
  });
  it('未开启记录时，不保存搜索内容，并清除扩展内旧记录', async () => {
    data['margin:settings'] = {};
    data[SEARCH_HISTORY_KEY] = [{ text: 'old', at: Date.now() }];
    expect(await handleHistory({ margin: 'privacy', op: 'history-remember', query: 'private' })).toEqual({ ok: true, entries: [] });
    expect(data[SEARCH_HISTORY_KEY]).toBeUndefined();
  });
  it('开启后在扩展存储中去重、读取、删除', async () => {
    await handleHistory({ margin: 'privacy', op: 'history-remember', query: '  测试搜索  ' });
    await handleHistory({ margin: 'privacy', op: 'history-remember', query: '测试搜索' });
    const read = await handleHistory({ margin: 'privacy', op: 'history-read' });
    expect(read.entries.map(entry => entry.text)).toEqual(['测试搜索']);
    expect((await handleHistory({ margin: 'privacy', op: 'history-forget', query: '测试搜索' })).entries).toEqual([]);
    expect(data[SEARCH_HISTORY_KEY]).toBeUndefined();
  });
  it('拒绝异常消息参数', async () => {
    expect((await handleHistory({ margin: 'privacy', op: 'history-remember', query: 'x'.repeat(201) })).ok).toBe(false);
    expect((await handleHistory({ margin: 'privacy', op: 'history-remember', query: 1 as unknown as string })).ok).toBe(false);
    expect((await handleHistory({ margin: 'privacy', op: 'invalid' as 'history-read' })).ok).toBe(false);
    expect(data[SEARCH_HISTORY_KEY]).toBeUndefined();
  });
});

describe('消息来源与授权隔离', () => {
  it('仅接受本扩展的指定页面或内容脚本', () => {
    expect(trustedSender({ id: 'fixture', url: 'https://www.bilibili.com/video/BV1abc123456' }, 'fixture')).toBe(true);
    expect(trustedSender({ id: 'fixture', url: 'chrome-extension://fixture/popup.html' }, 'fixture')).toBe(true);
    for (const sender of [{ id: 'other', url: 'https://www.bilibili.com/' }, { id: 'fixture', url: 'https://www.bilibili.com.evil.test/' }, { id: 'fixture', url: 'http://www.bilibili.com/' }, { id: 'fixture', url: 'chrome-extension://fixture/arbitrary.html' }, { id: 'fixture' }]) {
      expect(trustedSender(sender, 'fixture')).toBe(false);
    }
  });
  it('限制会话存储读取权限，清理遗留持久凭据', async () => {
    data['margin:app-auth'] = { key: 'fixture-credential' };
    data['margin:settings'] = { theme: 'dark' };
    await protectAuthStorage();
    expect(chrome.storage.session.setAccessLevel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' });
    expect(data['margin:app-auth']).toBeUndefined();
    expect(data['margin:settings']).toEqual({ theme: 'dark' });
  });
});

describe('外部辅助请求', () => {
  it('未同意时零请求', async () => {
    data['margin:settings'] = {};
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const { optionalFetch } = await import('../../src/shared/privacy');
    await expect(optionalFetch('ip', 'https://ipwho.is/')).rejects.toThrow('可选外部服务已关闭');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['http://ipwho.is/', 'https://ipwho.is.evil.test/', 'https://user:pass@ipwho.is/', 'https://ipwho.is/not-allowed', 'https://ipwho.is/?access_key=fixture'])('拒绝越界请求 %s', async address => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const { optionalFetch } = await import('../../src/shared/privacy');
    await expect(optionalFetch('ip', address)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('强制不带凭据和来源，并禁止跟随重定向', async () => {
    const fetcher = vi.fn(async () => new Response('{}')); vi.stubGlobal('fetch', fetcher);
    const { optionalFetch } = await import('../../src/shared/privacy');
    await optionalFetch('ip', 'https://ipwho.is/', { credentials: 'include', referrerPolicy: 'unsafe-url', redirect: 'follow' });
    expect(fetcher).toHaveBeenCalledWith('https://ipwho.is/', expect.objectContaining({ credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' }));
  });
  it('拒绝请求体和敏感请求头', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const { optionalFetch } = await import('../../src/shared/privacy');
    await expect(optionalFetch('ip', 'https://ipwho.is/', { method: 'POST', body: 'fixture' })).rejects.toThrow();
    await expect(optionalFetch('ip', 'https://ipwho.is/', { headers: { Authorization: 'fixture' } })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('关闭开关会中止进行中的请求', async () => {
    let markStarted!: () => void;
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    vi.stubGlobal('fetch', vi.fn((_address, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      markStarted();
    })));
    const { optionalFetch } = await import('../../src/shared/privacy');
    const request = optionalFetch('ip', 'https://ipwho.is/');
    const checked = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    await started;
    listeners.forEach(listener => listener({ 'margin:settings': { newValue: { privacyExternal: false } } }, 'local'));
    await checked;
  });
});
