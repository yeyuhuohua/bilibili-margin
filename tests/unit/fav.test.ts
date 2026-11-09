import { beforeEach, describe, expect, it, vi } from 'vitest';
import { collectedFolders, folderUrl, folderVideos, folders, seasonVideos } from '../../src/content/api/fav';
import { getJSON, nav } from '../../src/content/api/http';

vi.mock('../../src/content/api/http', () => ({ getJSON: vi.fn(), nav: vi.fn() }));
beforeEach(() => {
  vi.mocked(getJSON).mockReset();
  vi.mocked(nav).mockResolvedValue({ isLogin: true, mid: 42, wbi_img: { img_url: '', sub_url: '' } });
});

describe('订阅合集和收藏夹', () => {
  it('独立读取订阅列表，保留同号的合集与收藏夹并支持翻页', async () => {
    vi.mocked(getJSON).mockResolvedValue({ has_more: true, list: [
      { id: 7, type: 21, title: '订阅合集', media_count: 24, cover: '//i0.hdslb.com/a.jpg' },
      { id: 7, type: 11, title: '他人的收藏夹', media_count: 2, cover: '' },
      { id: 8, type: 99, title: '其他类型' },
    ] });
    const result = await collectedFolders(2);
    expect(getJSON).toHaveBeenCalledWith('/x/v3/fav/folder/collected/list', { up_mid: 42, pn: 2, ps: 50, platform: 'web' });
    expect(result).toMatchObject({ more: true, list: [
      { id: 7, kind: 'season', mid: 42, cover: 'https://i0.hdslb.com/a.jpg', count: 24, isDefault: false },
      { id: 7, kind: 'collected', mid: 42, count: 2, isDefault: false },
    ] });
  });
  it('未登录时跳过订阅请求，显示登录状态', async () => {
    vi.mocked(nav).mockResolvedValue({ isLogin: false, wbi_img: { img_url: '', sub_url: '' } });
    expect(await collectedFolders()).toBeNull();
    expect(getJSON).not.toHaveBeenCalled();
  });
  it('空订阅与接口失败分别处理', async () => {
    vi.mocked(getJSON).mockResolvedValueOnce({ list: null, has_more: false }).mockRejectedValueOnce(new Error('HTTP 503'));
    expect(await collectedFolders()).toEqual({ list: [], more: false });
    await expect(collectedFolders()).rejects.toThrow('HTTP 503');
  });
  it('我的收藏仍只请求自己创建的列表', async () => {
    vi.mocked(getJSON).mockResolvedValue({ list: [{ id: 7, title: '默认收藏夹', media_count: 4, attr: 0 }] });
    const result = await folders();
    expect(getJSON).toHaveBeenCalledTimes(1);
    expect(getJSON).toHaveBeenCalledWith('/x/v3/fav/folder/created/list', { up_mid: 42, pn: 1, ps: 50 });
    expect(result?.[0]).toMatchObject({ id: 7, isDefault: true });
  });
  it('合集接口返回完整列表，接受缺省的 type 和 attr 并补全作者', async () => {
    vi.mocked(getJSON).mockResolvedValue({ info: { upper: { name: '作者', mid: 9, face: '//i0.hdslb.com/up.jpg' } }, medias: [
      { id: 1, bvid: 'BVsample', title: '合集视频', cover: 'http://i0.hdslb.com/v.jpg', duration: 65, pubtime: 123, cnt_info: { play: 100, danmaku: 2 } },
      { id: 2, bvid: '', title: '失效视频' },
    ] });
    expect(await seasonVideos(7)).toMatchObject([{ bvid: 'BVsample', title: '合集视频', cover: 'https://i0.hdslb.com/v.jpg', author: '作者', mid: 9, duration: 65, pubdate: 123, views: 100 }]);
    expect(getJSON).toHaveBeenCalledWith('/x/space/fav/season/list', { season_id: 7 });
  });
  it('他人的收藏夹沿用资源列表和有效视频过滤', async () => {
    vi.mocked(getJSON).mockResolvedValue({ medias: [
      { type: 2, attr: 0, bvid: 'BVvalid', title: '视频' }, { type: 2, attr: 9, bvid: 'BVinvalid' }, { type: 12, attr: 0, bvid: 'BVother' },
    ], has_more: true });
    expect(await folderVideos(7, 2)).toMatchObject({ list: [{ bvid: 'BVvalid' }], more: true });
    expect(getJSON).toHaveBeenCalledWith('/x/v3/fav/resource/list', { media_id: 7, pn: 2, ps: 20, platform: 'web' });
  });
  it.each([['season', '21'], ['collected', '11']] as const)('%s 跳转回原站对应的订阅项', (kind, ctype) => {
    const url = new URL(folderUrl({ id: 7, mid: 42, kind, title: '', count: 0, cover: '', isDefault: false, isPrivate: false }));
    expect(url.pathname).toBe('/42/favlist');
    expect(url.searchParams.get('fid')).toBe('7');
    expect(url.searchParams.get('ftype')).toBe('collect');
    expect(url.searchParams.get('ctype')).toBe(ctype);
  });
});
