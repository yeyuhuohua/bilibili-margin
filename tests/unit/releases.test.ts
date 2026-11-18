import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkRelease, newerRelease } from '../../src/shared/releases';
import { optionalFetch } from '../../src/shared/privacy';
vi.mock('../../src/shared/privacy', () => ({ optionalFetch: vi.fn() }));
const saved = vi.fn(), read = vi.fn();
const info = { at: Date.now(), tag: '0.60.75', name: 'v0.6.75', url: 'https://github.com/jiuyang5354/bilibili-margin/releases/tag/v0.60.75' };
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('chrome', { storage: { local: { get: read, set: saved } } }); read.mockResolvedValue({});
  vi.mocked(optionalFetch).mockResolvedValue(new Response(JSON.stringify({ tag_name: 'v0.60.75', name: 'v0.6.75', html_url: info.url })));
});
describe('正式版本检查', () => {
  it('按内部数字版本比较，支持四段，不使用显示名称排序', () => {
    expect(newerRelease('0.60.75', '0.60.74')).toBe(true);
    expect(newerRelease('0.60.74', '0.60.74')).toBe(false);
    expect(newerRelease('0.60.74.1', '0.60.74')).toBe(true);
    expect(newerRelease('0.6.99', '0.60.74')).toBe(false);
  });
  it('自动检查复用缓存，手动检查绕过缓存并保存新结果', async () => {
    read.mockResolvedValue({ 'margin:update-check': info });
    expect(await checkRelease()).toEqual(info); expect(optionalFetch).not.toHaveBeenCalled();
    expect(await checkRelease(true)).toMatchObject({ tag: info.tag, name: info.name, url: info.url });
    expect(optionalFetch).toHaveBeenCalledTimes(1); expect(saved).toHaveBeenCalledTimes(1);
  });
  it.each([{ tag_name: 'v0.60.75', html_url: 'https://evil.test/' }, { tag_name: 'bad', html_url: info.url }, { tag_name: 'v0.60.75', html_url: info.url, prerelease: true }])('无效信息不缓存：%j', async value => {
    vi.mocked(optionalFetch).mockResolvedValue(new Response(JSON.stringify(value)));
    await expect(checkRelease(true)).rejects.toThrow('正式版信息'); expect(saved).not.toHaveBeenCalled();
  });
  it('失败不覆盖旧缓存，不自动重试或绕过隐私选择', async () => {
    vi.mocked(optionalFetch).mockRejectedValue(new Error('可选服务已关闭'));
    await expect(checkRelease(true)).rejects.toThrow('可选服务已关闭');
    expect(optionalFetch).toHaveBeenCalledTimes(1); expect(saved).not.toHaveBeenCalled();
  });
});
