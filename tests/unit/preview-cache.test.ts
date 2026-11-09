import { beforeEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ getJSON: vi.fn(), getWbi: vi.fn() }));
vi.mock('../../src/content/api/http', () => api);
beforeEach(() => { vi.resetModules(); api.getJSON.mockReset(); api.getWbi.mockReset(); });

describe('封面预览缓存', () => {
  it('CID 失败可重试，并合并成功请求', async () => {
    api.getJSON.mockRejectedValueOnce(new Error('offline')).mockResolvedValue([{ cid: 10 }]);
    const { cidOf } = await import('../../src/content/api/play');
    expect(await cidOf('BV1')).toBe(0);
    expect(await Promise.all([cidOf('BV1'), cidOf('BV1')])).toEqual([10, 10]);
    expect(api.getJSON).toHaveBeenCalledTimes(2);
  });
  it('播放地址失败可重试，媒体失败后可换取新地址', async () => {
    api.getWbi.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ durl: [{ url: 'http://media/preview.mp4' }] });
    const { previewUrl, invalidatePreview } = await import('../../src/content/api/play');
    expect(await previewUrl('BV1', 10)).toBeNull();
    expect(await previewUrl('BV1', 10)).toBe('https://media/preview.mp4');
    await previewUrl('BV1', 10);
    expect(api.getWbi).toHaveBeenCalledTimes(2);
    invalidatePreview('BV1', 10);
    await previewUrl('BV1', 10);
    expect(api.getWbi).toHaveBeenCalledTimes(3);
  });
});
