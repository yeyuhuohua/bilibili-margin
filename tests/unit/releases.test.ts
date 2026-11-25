import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkRelease, checkViaReleasePage, ReleaseRateLimited, newerRelease } from '../../src/shared/releases';
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
  it('失败不覆盖旧缓存', async () => {
    vi.mocked(optionalFetch).mockRejectedValue(new Error('网络错误'));
    await expect(checkRelease(true)).rejects.toThrow('网络错误');
    expect(saved).not.toHaveBeenCalled();
  });
  it('外部辅助服务被关闭时不走发布页回退，也不发第二次请求', async () => {
    const blocked = new Error('可选外部服务已关闭'); blocked.name = 'PrivacyBlocked';
    vi.mocked(optionalFetch).mockRejectedValue(blocked);
    await expect(checkRelease(true)).rejects.toThrow('可选外部服务已关闭');
    expect(optionalFetch).toHaveBeenCalledTimes(1); expect(saved).not.toHaveBeenCalled();
  });
});

/** 造一个带最终地址的响应：回退通道靠 response.url 取版本号 */
function redirectTo(url: string, status = 200): Response {
  const response = new Response('{}', { status });
  Object.defineProperty(response, 'url', { value: url });
  return response;
}

describe('可选发布页查询', () => {
  const contains = vi.fn();
  beforeEach(() => {
    vi.stubGlobal('chrome', { storage: { local: { get: read, set: saved } }, permissions: { contains } });
    contains.mockResolvedValue(true);
  });
  it.each([403, 429])('仅手动检查遇到限流才提示备用入口（%d）', async status => {
    vi.mocked(optionalFetch).mockImplementation(async () => new Response('rate limit exceeded', { status }));
    await expect(checkRelease()).rejects.not.toBeInstanceOf(ReleaseRateLimited);
    await expect(checkRelease(true)).rejects.toBeInstanceOf(ReleaseRateLimited);
    expect(optionalFetch).toHaveBeenCalledTimes(2);
    expect(contains).not.toHaveBeenCalled();
  });
  it('普通权限错误不会提示备用入口', async () => {
    vi.mocked(optionalFetch).mockResolvedValue(new Response('Forbidden', {status:403}));
    await expect(checkRelease(true)).rejects.toThrow('HTTP 403');
    expect(optionalFetch).toHaveBeenCalledTimes(1);
  });
  it('未授权或授权已撤回时不会请求发布页', async () => {
    contains.mockResolvedValue(false);
    await expect(checkViaReleasePage()).rejects.toThrow('未授权');
    expect(optionalFetch).not.toHaveBeenCalled(); expect(saved).not.toHaveBeenCalled();
  });
  it('已获授权时只读正式版的地址并缓存版本', async () => {
    vi.mocked(optionalFetch).mockResolvedValue(redirectTo(info.url));
    await expect(checkViaReleasePage()).resolves.toMatchObject({ tag:info.tag, url:info.url });
    expect(optionalFetch).toHaveBeenCalledWith('release-page', 'https://github.com/jiuyang5354/bilibili-margin/releases/latest', { method:'HEAD' });
    expect(saved).toHaveBeenCalledTimes(1);
  });
  it.each([['https://github.com/other/repo/releases/tag/v9.0',200], ['https://github.com/jiuyang5354/bilibili-margin/releases',200], [info.url,503]] as const)('拒绝无效发布结果 %s %d', async (url,status) => {
    vi.mocked(optionalFetch).mockResolvedValue(redirectTo(url,status));
    await expect(checkViaReleasePage()).rejects.toThrow();
    expect(saved).not.toHaveBeenCalled();
  });
});
