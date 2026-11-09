import { beforeEach, describe, expect, it, vi } from 'vitest';
import { historyList, historySearch } from '../../src/content/api/history';
import { getJSON } from '../../src/content/api/http';

vi.mock('../../src/content/api/http', () => ({ getJSON: vi.fn(), postForm: vi.fn() }));
beforeEach(() => vi.mocked(getJSON).mockReset());

describe('历史记录的视频定位', () => {
  it.each(['list', 'search'])('%s 保留历史中的分 P 页码', async entry => {
    vi.mocked(getJSON).mockResolvedValue({ list: [{ history: { business: 'archive', bvid: 'BV1test', oid: 10, page: 4 } }] });
    const result = entry === 'list' ? await historyList('all', null) : await historySearch('test', 1);
    expect(new URL(result.list[0].url).searchParams.get('p')).toBe('4');
  });
  it('使用实际观看视频修正指向合集首集的 uri', async () => {
    vi.mocked(getJSON).mockResolvedValue({ list: [{ uri: 'https://www.bilibili.com/video/BV1first?p=1', history: { business: 'archive', bvid: 'BV1watched', oid: 20, page: 2 } }] });
    const url = new URL((await historyList('all', null)).list[0].url);
    expect(url.pathname).toBe('/video/BV1watched');
    expect(url.searchParams.get('p')).toBe('2');
  });
  it('保留当前视频 uri 的查询参数和片段', async () => {
    vi.mocked(getJSON).mockResolvedValue({ list: [{ uri: '//www.bilibili.com/video/BV1test/?t=35#reply', history: { business: 'archive', bvid: 'BV1test', page: 3 } }] });
    const url = new URL((await historyList('all', null)).list[0].url);
    expect(url.searchParams.get('t')).toBe('35');
    expect(url.searchParams.get('p')).toBe('3');
    expect(url.hash).toBe('#reply');
  });
  it('缺失分 P 字段时保留现有链接，番剧与直播沿用各自地址', async () => {
    vi.mocked(getJSON).mockResolvedValue({ list: [
      { uri: 'https://www.bilibili.com/video/BV1test?p=2', history: { business: 'archive', bvid: 'BV1test' } },
      { history: { business: 'pgc', epid: 123 } },
      { history: { business: 'live', oid: 456 } },
    ] });
    const { list } = await historyList('all', null);
    expect(list.map(x => x.url)).toEqual(['https://www.bilibili.com/video/BV1test?p=2', 'https://www.bilibili.com/bangumi/play/ep123', 'https://live.bilibili.com/456']);
  });
});
