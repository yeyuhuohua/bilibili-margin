import { beforeEach, describe, expect, it, vi } from 'vitest';
import { spaceArticles, spaceAudio } from '../../src/content/api/space-content';
import { publicFolders, publicFolder } from '../../src/content/api/fav';
import { getJSON, nav } from '../../src/content/api/http';
vi.mock('../../src/content/api/http', () => ({ getJSON: vi.fn(), nav: vi.fn() }));
beforeEach(() => { vi.mocked(getJSON).mockReset(); vi.mocked(nav).mockReset(); vi.mocked(nav).mockResolvedValue({ isLogin: false, wbi_img: { img_url: '', sub_url: '' } }); });

describe('空间图文、音频与公开收藏夹', () => {
  it('图文保留长 ID、无封面条目和游标分页', async () => {
    vi.mocked(getJSON).mockResolvedValue({ items: [{ opus_id: '1234567890123456789', content: '文字', jump_url: '//www.bilibili.com/opus/1234567890123456789', cover: null, stat: { like: '1.2万' } }], offset: 'next', has_more: true });
    const r = await spaceArticles(2, 'prev');
    expect(getJSON).toHaveBeenCalledWith('/x/polymer/web-dynamic/v1/opus/feed/space', { host_mid: 2, offset: 'prev', type: 'all' });
    expect(r).toMatchObject({ more: true, offset: 'next', list: [{ id: '1234567890123456789', cover: '', likes: '1.2万' }] });
  });
  it('重复图文游标停止重复分页', async () => {
    vi.mocked(getJSON).mockResolvedValue({ items: [], offset: 'same', has_more: true });
    expect((await spaceArticles(2, 'same')).more).toBe(false);
  });
  it('音频沿用原生地址并按总页数加载', async () => {
    vi.mocked(getJSON).mockResolvedValue({ data: [{ id: 123, title: '音频', cover: 'http://i0.hdslb.com/a.jpg', uname: '作者', statistic: { play: 42 }, passtime: 100 }], pageCount: 3 });
    const r = await spaceAudio(2, 2);
    expect(getJSON).toHaveBeenCalledWith('/audio/music-service/web/song/upper', { uid: 2, pn: 2, ps: 30, order: 1 });
    expect(r).toMatchObject({ more: true, list: [{ url: 'https://www.bilibili.com/audio/au123', views: 42, published: 100 }] });
    vi.mocked(getJSON).mockResolvedValue(null);
    expect(await spaceAudio(2, 1)).toEqual({ list: [], more: false });
  });
  it('公开收藏夹过滤私有项并保留后续页', async () => {
    vi.mocked(getJSON).mockResolvedValue({ list: [{ id: 1, title: '公开', media_count: 2, attr: 0 }, { id: 2, title: '私密', media_count: 3, attr: 3 }], has_more: true });
    const r = await publicFolders(2, 1);
    expect(r.list.map(x => x.id)).toEqual([1]);
    expect(r.more).toBe(true);
  });
  it.each([{ mid: 2, attr: 1 }, { mid: 3, attr: 0 }])('直接收藏夹链接校验所有者和公开状态 %j', async row => {
    vi.mocked(getJSON).mockResolvedValue({ id: 10, title: '隐藏内容', media_count: 2, ...row });
    await expect(publicFolder(2, 10)).rejects.toThrow('收藏夹');
  });
  it('本人空间保留自己的私密收藏夹及直接链接', async () => {
    vi.mocked(nav).mockResolvedValue({ isLogin: true, mid: 2, wbi_img: { img_url: '', sub_url: '' } });
    vi.mocked(getJSON).mockResolvedValueOnce({ list: [{ id: 10, title: '自己的私密夹', media_count: 3, attr: 3 }] }).mockResolvedValueOnce({ id: 10, mid: 2, title: '自己的私密夹', media_count: 3, attr: 3 });
    expect((await publicFolders(2, 1)).list).toMatchObject([{ id: 10, isPrivate: true }]);
    expect(await publicFolder(2, 10)).toMatchObject({ id: 10, mid: 2, isPrivate: true });
  });
  it('本人登录也不能越权读取另一位 UP 的私密收藏夹', async () => {
    vi.mocked(nav).mockResolvedValue({ isLogin: true, mid: 1, wbi_img: { img_url: '', sub_url: '' } });
    vi.mocked(getJSON).mockResolvedValue({ id: 10, mid: 2, title: '私密夹', media_count: 3, attr: 3 });
    await expect(publicFolder(2, 10)).rejects.toThrow('未公开');
  });
  it('公开夹直接访问不额外查询登录状态', async () => {
    vi.mocked(getJSON).mockResolvedValue({ id: 10, mid: 2, title: '公开夹', media_count: 3, attr: 0 });
    expect(await publicFolder(2, 10)).toMatchObject({ isPrivate: false });
    expect(nav).not.toHaveBeenCalled();
  });
  it('接口失败抛给页面重试', async () => {
    vi.mocked(getJSON).mockRejectedValue(new Error('暂时不可用'));
    await expect(spaceArticles(2, '')).rejects.toThrow('暂时不可用');
    await expect(spaceAudio(2, 1)).rejects.toThrow('暂时不可用');
    await expect(publicFolders(2, 1)).rejects.toThrow('暂时不可用');
  });
});
