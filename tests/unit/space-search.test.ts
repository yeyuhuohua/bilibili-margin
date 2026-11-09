import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normQuery, createSpaceSearch } from '../../src/content/api/space';
import { getJSON, getWbi } from '../../src/content/api/http';

vi.mock('../../src/content/api/http', () => ({ getJSON: vi.fn(), getWbi: vi.fn() }));

/** getJSON / getWbi 是泛型函数，测试里统一按「返回 unknown」注入假响应 */
const json = (fn: (path: string) => Promise<unknown>) => vi.mocked(getJSON).mockImplementation(fn as never);
const wbi = (fn: () => Promise<unknown>) => vi.mocked(getWbi).mockImplementation(fn as never);
const searchSpace = (mid: number, query: string, order: 'pubdate' | 'click') => createSpaceSearch(mid, query, order)();

const upload = (bvid: string, title: string, created: number, play: number) => ({
  bvid, title, pic: '', length: '01:40', author: 'UP', mid: 2, play, video_review: 0, created,
});
const archive = (bvid: string, title: string, pubdate: number, view = 0) => ({
  bvid, title, pic: '', duration: 100, pubdate, stat: { view },
});
const seasonList = (seasons: { id: number; name: string; total: number }[], total = seasons.length) => ({
  items_lists: { page: { total }, seasons_list: seasons.map((s) => ({ meta: { season_id: s.id, name: s.name, total: s.total } })), series_list: [] },
});

beforeEach(() => {
  vi.mocked(getJSON).mockReset();
  vi.mocked(getWbi).mockReset();
});

describe('空间搜索：合集补搜（#113）', () => {
  it('关键词归一化去掉所有空白并转小写', () => {
    expect(normQuery('  从零开始的 AI 学习 ')).toBe('从零开始的ai学习');
    expect(normQuery('【Re:从零开始的AI学习】')).toBe('【re:从零开始的ai学习】');
    expect(normQuery(undefined)).toBe('');
  });

  it('合集名命中：并入合集视频，按 bvid 去重并按发布时间倒序', async () => {
    wbi(async () => ({ list: { vlist: [upload('BVbase', '【从零开始的 AI 学习】基础', 1000, 10)] }, page: { count: 1 } }));
    json(async (path) => {
      if (path === '/x/polymer/web-space/seasons_series_list') return seasonList([{ id: 7, name: '【从零开始的 AI 学习】', total: 3 }]);
      if (path === '/x/polymer/web-space/seasons_archives_list') {
        return { page: { total: 3 }, archives: [
          archive('BVbase', '【从零开始的 AI 学习】基础', 1000, 10),
          archive('BVc2', '【从零开始的AI学习】提示词', 2000, 20),
          archive('BVc3', '【从零开始的AI学习】Agent', 3000, 30),
        ] };
      }
      throw new Error(`unexpected ${path}`);
    });
    const r = await searchSpace(9101, '从零开始的 AI 学习', 'pubdate');
    expect(r.collections[0]?.name).toBe('【从零开始的 AI 学习】');
    expect(r.list.map((v) => v.bvid)).toEqual(['BVc3', 'BVc2', 'BVbase']);
    expect(r.list.find(v => v.bvid === 'BVbase')?.author).toBe('UP');
  });

  it('投稿结果为空时扫合集首屏按标题兜底', async () => {
    wbi(async () => ({ list: { vlist: [] }, page: { count: 0 } }));
    json(async (path) => {
      if (path === '/x/polymer/web-space/seasons_series_list') return seasonList([{ id: 1, name: '合集甲', total: 2 }, { id: 2, name: '合集乙', total: 2 }]);
      if (path === '/x/polymer/web-space/seasons_archives_list') {
        return { page: { total: 2 }, archives: [archive('BVa', '甲集 第一期', 100), archive('BVb', '甲集 第二期', 200)] };
      }
      throw new Error(`unexpected ${path}`);
    });
    const r = await searchSpace(9102, '第二期', 'pubdate');
    expect(r.list.map((v) => v.bvid)).toEqual(['BVb']);
    expect(r.collections[0]).toBeUndefined();
  });

  it('合集接口失败时只返回投稿结果，不把搜索拖垮', async () => {
    wbi(async () => ({ list: { vlist: [upload('BVok', '正常视频', 100, 1)] }, page: { count: 1 } }));
    json(async () => { throw new Error('-352'); });
    const r = await searchSpace(9103, '正常', 'pubdate');
    expect(r.list.map((v) => v.bvid)).toEqual(['BVok']);
    expect(r.collections[0]).toBeUndefined();
  });

  it('order=click 时按播放量排序', async () => {
    wbi(async () => ({ list: { vlist: [upload('BV1', '合集 一', 100, 5)] }, page: { count: 1 } }));
    json(async (path) => {
      if (path === '/x/polymer/web-space/seasons_series_list') return seasonList([{ id: 9, name: '合集', total: 2 }]);
      if (path === '/x/polymer/web-space/seasons_archives_list') {
        return { page: { total: 2 }, archives: [archive('BV1', '合集 一', 100, 5), archive('BV2', '合集 二', 200, 99)] };
      }
      throw new Error(`unexpected ${path}`);
    });
    const r = await searchSpace(9104, '合集', 'click');
    expect(r.list.map((v) => v.bvid)).toEqual(['BV2', 'BV1']);
  });

  it('同一次搜索完成后不重复请求', async () => {
    wbi(async () => ({ list: { vlist: [] }, page: { count: 0 } }));
    json(async (path) => {
      if (path === '/x/polymer/web-space/seasons_series_list') return seasonList([{ id: 1, name: '甲', total: 1 }], 1);
      if (path === '/x/polymer/web-space/seasons_archives_list') return { page: { total: 1 }, archives: [archive('BV1', '甲', 10)] };
      throw new Error(`unexpected ${path}`);
    });
    const next = createSpaceSearch(9105, '甲', 'pubdate');
    const first = await next();
    const calls = vi.mocked(getJSON).mock.calls.length;
    const second = await next();
    expect(second).toEqual(first);
    expect(vi.mocked(getJSON).mock.calls.length).toBe(calls);
  });

  it('合集目录和视频第4页仍可搜索，投稿有结果也继续按合集标题补全', async () => {
    wbi(async () => ({ list: { vlist: [upload('BVbase', '目标', 1, 1)] }, page: { count: 1 } }));
    vi.mocked(getJSON).mockImplementation(async (path, params) => {
      const page = Number(params?.page_num);
      if (path.endsWith('seasons_series_list')) return seasonList([{ id: page, name: '课程', total: page === 4 ? 120 : 1 }], 4) as never;
      const id = Number(params?.season_id);
      return { page: { total: id === 4 ? 120 : 1 }, archives: Array.from({ length: id === 4 ? 30 : 1 }, (_, i) => archive(`BV${id}-${page}-${i}`, id === 4 && page === 4 && i === 29 ? '目 标' : '其他', page)) } as never;
    });
    const next = createSpaceSearch(2, '目标', 'pubdate');
    let result = await next();
    for (let i = 0; i < 12 && !result.done; i++) result = await next();
    expect(result.done).toBe(true);
    expect(result.list.map(v => v.bvid)).toContain('BV4-4-29');
    expect(result.list.map(v => v.bvid)).toContain('BVbase');
  });

  it('投稿搜索保留后续分页', async () => {
    vi.mocked(getWbi).mockImplementation(async (_path, params) => ({ list: { vlist: [upload(`BV${params.pn}`, '目标', Number(params.pn), 1)] }, page: { count: 2 } }) as never);
    json(async () => seasonList([]));
    const next = createSpaceSearch(2, '目标', 'pubdate');
    expect((await next()).done).toBe(false);
    expect((await next()).list.map(v => v.bvid)).toEqual(['BV2', 'BV1']);
  });

  it('合集失败可重试，取消查询停止结果提交', async () => {
    wbi(async () => ({ list: { vlist: [] }, page: { count: 0 } }));
    let failed = true;
    json(async () => { if (failed) throw new Error('temporary'); return seasonList([]); });
    const next = createSpaceSearch(2, '目标', 'pubdate');
    expect(await next()).toMatchObject({ done: false, warning: true });
    failed = false;
    expect(await next()).toMatchObject({ done: true, warning: false });
    const controller = new AbortController(); controller.abort();
    await expect(next(controller.signal)).rejects.toThrow();
  });

  it('每批最多并发三个合集视频请求，保留后续合集', async () => {
    wbi(async () => ({ list: { vlist: [] }, page: { count: 0 } }));
    let active = 0, peak = 0;
    json(async path => {
      if (path.endsWith('seasons_series_list')) return seasonList(Array.from({ length: 12 }, (_, i) => ({ id: i, name: '目标合集', total: 1 })));
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--;
      return { page: { total: 1 }, archives: [archive('BV1', '目标', 1)] };
    });
    const next = createSpaceSearch(2, '目标', 'pubdate');
    let result = await next();
    expect(result.done).toBe(false);
    for (let i = 0; i < 3; i++) result = await next();
    expect(result.done).toBe(true);
    expect(peak).toBe(3);
  });
});
