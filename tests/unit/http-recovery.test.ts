import { beforeEach, describe, expect, it, vi } from 'vitest';
const setGuard = vi.hoisted(() => vi.fn());
vi.mock('../../src/content/native-guard', () => ({ setGuard }));
const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
const nav = { code: 0, data: { isLogin: true, wbi_img: { img_url: 'https://i0.hdslb.com/abcdefghijklmnopqrstuvwxyz012345.png', sub_url: 'https://i0.hdslb.com/012345abcdefghijklmnopqrstuvwxyz.png' } } };
beforeEach(() => { vi.resetModules(); vi.unstubAllGlobals(); setGuard.mockReset(); });

describe('API 错误与重试恢复', () => {
  it('HTML 响应提供可理解错误，下一次 GET 可以恢复', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('<!DOCTYPE html><html>blocked</html>')).mockResolvedValueOnce(json({ code: 0, data: ['ok'] }));
    vi.stubGlobal('fetch', fetcher);
    const { getJSON } = await import('../../src/content/api/http');
    await expect(getJSON('/test')).rejects.toThrow('非 JSON');
    await expect(getJSON('/test')).resolves.toEqual(['ok']);
  });
  it('签名信息请求失败不会永久缓存失败 Promise', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('<html>temporary</html>')).mockResolvedValueOnce(json(nav)).mockResolvedValueOnce(json({ code: 0, data: ['video'] }));
    vi.stubGlobal('fetch', fetcher);
    const { getWbi } = await import('../../src/content/api/http');
    await expect(getWbi('/x/space/wbi/arc/search', {})).rejects.toThrow('非 JSON');
    await expect(getWbi('/x/space/wbi/arc/search', {})).resolves.toEqual(['video']);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('签名 GET 的 HTTP 412 标记原生验证恢复路径', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(nav)).mockResolvedValueOnce(new Response('blocked', { status: 412 })));
    const { getWbi } = await import('../../src/content/api/http');
    await expect(getWbi('/test', {})).rejects.toThrow('HTTP 412');
    expect(setGuard).toHaveBeenCalledWith(false);
  });
  it('签名字段缺失时下一次请求重新获取', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ code: 0, data: {} })).mockResolvedValueOnce(json(nav)).mockResolvedValueOnce(json({ code: 0, data: 1 })));
    const { getWbi } = await import('../../src/content/api/http');
    await expect(getWbi('/test', {})).rejects.toThrow('签名信息');
    await expect(getWbi('/test', {})).resolves.toBe(1);
  });
});
