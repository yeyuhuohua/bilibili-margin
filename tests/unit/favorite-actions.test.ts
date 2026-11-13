import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/content/api/http', () => ({ getJSON: vi.fn(), nav: vi.fn() }));
import { getJSON } from '../../src/content/api/http';
import { folderPlayUrl, folderVideos, removeFolderVideo, type Folder } from '../../src/content/api/fav';
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal('document', { cookie: 'bili_jct=test-csrf' }); });
afterEach(() => vi.unstubAllGlobals());
describe('收藏夹原站操作', () => {
  it('保留资源 aid 用于移除，连续播放复用原生列表', async () => {
    vi.mocked(getJSON).mockResolvedValue({ medias: [{ id: 123, bvid: 'BVtest', type: 2, attr: 0, title: '视频' }] });
    expect((await folderVideos(101, 1)).list[0].aid).toBe(123);
    expect(folderPlayUrl({ id: 101 } as Folder)).toBe('https://www.bilibili.com/list/ml101?sid=101');
  });
  it('只移除当前收藏夹的一个视频资源，发送现有 CSRF', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ code: 0, data: {} }))); vi.stubGlobal('fetch', fetcher);
    await removeFolderVideo(101, 123);
    const call = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const body = new URLSearchParams(call[1].body as string);
    expect(call[0]).toBe('https://api.bilibili.com/x/v3/fav/resource/batch-del');
    expect(body.get('resources')).toBe('123:2'); expect(body.get('media_id')).toBe('101'); expect(body.get('csrf')).toBe('test-csrf');
  });
  it('缺少视频 ID 不请求，接口失败交给界面保留视频并重试', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ code: -111, message: 'csrf failed' }))); vi.stubGlobal('fetch', fetcher);
    await expect(removeFolderVideo(101, NaN)).rejects.toThrow('视频标识'); expect(fetcher).not.toHaveBeenCalled();
    await expect(removeFolderVideo(101, 123)).rejects.toThrow('csrf failed');
  });
});
