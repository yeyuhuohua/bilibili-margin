import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RecommendationFeed } from '../../src/content/api/feed';

const mocks = vi.hoisted(() => ({ getWbi: vi.fn() }));
vi.mock('../../src/content/api/http', () => mocks);
const item = (id: number) => ({ id, goto: 'av', bvid: `BVtest${id}`, title: 'Video', owner: {}, stat: {} });
const params = (index: number) => mocks.getWbi.mock.calls[index][1];
let feed: RecommendationFeed;
let signal: AbortSignal;
beforeEach(() => {
  vi.stubGlobal('document', { cookie: 'home_feed_column=5; browser_resolution=1920-1080' });
  vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' });
  mocks.getWbi.mockReset().mockResolvedValue({ item: [item(1)] });
  feed = new RecommendationFeed();
  signal = new AbortController().signal;
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('sends initial, scroll and whole-list refresh scenes with independent counters', async () => {
  await feed.load('scroll', 6, signal);
  await feed.load('scroll', 4, signal);
  await feed.load('refresh', 4, signal);
  await feed.load('scroll', 4, signal);
  expect(params(0)).toMatchObject({ fresh_type: 0, fresh_idx: 0, fresh_idx_1h: 0, fetch_row: 1, brush: 0, ps: 10, y_num: 6, last_y_num: 5, screen: '1920-1080', device: 'win' });
  expect(params(1)).toMatchObject({ fresh_type: 4, fresh_idx: 1, fetch_row: 4, brush: 1, ps: 12, y_num: 4 });
  expect(params(2)).toMatchObject({ fresh_type: 5, fresh_idx: 2, fetch_row: 1, brush: 0, ps: 10 });
  expect(params(3)).toMatchObject({ fresh_type: 4, fresh_idx: 3, fetch_row: 4, brush: 2 });
});

it('serializes concurrent requests and includes the preceding response in the next request', async () => {
  let finish!: (value: unknown) => void;
  mocks.getWbi.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const first = feed.load('scroll', 4, signal);
  const second = feed.load('scroll', 4, signal);
  await vi.waitFor(() => expect(mocks.getWbi).toHaveBeenCalledTimes(1));
  finish({ item: [item(10)] });
  await Promise.all([first, second]);
  expect(params(1).last_showlist).toBe('av_n_10');
  expect(params(1).fresh_idx).toBe(1);
});

it('only marks explicitly visible or clicked cards and keeps unrendered item types unexposed', async () => {
  mocks.getWbi.mockResolvedValueOnce({ item: [item(1), item(2), { goto: 'live', id: 7 }, { goto: 'ad', business_info: { src_id: 8, archive: { aid: 9 } } }] });
  const videos = await feed.load('scroll', 4, signal);
  expect(videos).toHaveLength(2);
  feed.expose(videos[0]);
  await feed.load('scroll', 4, signal);
  expect(params(1).last_showlist).toBe('av_1,av_n_2,live_n_7,ad_n_8_9');
  expect(params(1).last_clicklist).toBe('');
  feed.click(videos[1]);
  await feed.load('scroll', 4, signal);
  expect(params(2).last_clicklist).toBe('av_2');
  expect(params(2).last_showlist).toContain('av_1,av_2,live_n_7,ad_n_8_9;');
});

it('bounds request groups and the last 50 clicks in page memory', async () => {
  for (let index = 0; index < 60; index++) {
    mocks.getWbi.mockResolvedValueOnce({ item: [item(index + 1)] });
    const [video] = await feed.load('scroll', 4, signal);
    feed.click(video);
  }
  await feed.load('scroll', 4, signal);
  expect(params(60).last_showlist.split(';')).toHaveLength(50);
  expect(params(60).last_clicklist.split(',')).toHaveLength(50);
  expect(params(60).last_clicklist.split(',')[0]).toBe('av_11');
  const fresh = new RecommendationFeed();
  await fresh.load('scroll', 4, signal);
  expect(params(61)).toMatchObject({ last_showlist: '', last_clicklist: '', fresh_idx: 0 });
});

it('resets the hourly counter after an hour while the page counter keeps increasing', async () => {
  const now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
  await feed.load('scroll', 4, signal);
  await feed.load('scroll', 4, signal);
  clock.mockReturnValue(now + 3600001);
  await feed.load('scroll', 4, signal);
  expect(params(2)).toMatchObject({ fresh_idx: 2, fresh_idx_1h: 1 });
});

it('recovers after failure without recording a failed response or poisoning the queue', async () => {
  mocks.getWbi.mockRejectedValueOnce(new Error('offline'));
  await expect(feed.load('scroll', 4, signal)).rejects.toThrow('offline');
  await feed.load('scroll', 4, signal);
  expect(params(1)).toMatchObject({ fresh_type: 0, fresh_idx: 1, fetch_row: 1, last_showlist: '' });
});

it('ignores cancelled responses and skips queued cancelled requests', async () => {
  const controller = new AbortController();
  let finish!: (value: unknown) => void;
  mocks.getWbi.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const request = feed.load('scroll', 4, controller.signal);
  const rejected = expect(request).rejects.toHaveProperty('name', 'AbortError');
  const queued = feed.load('scroll', 4, controller.signal);
  const skipped = expect(queued).rejects.toHaveProperty('name', 'AbortError');
  await vi.waitFor(() => expect(mocks.getWbi).toHaveBeenCalledTimes(1));
  controller.abort();
  finish({ item: [item(100)] });
  await Promise.all([rejected, skipped]);
  await feed.load('scroll', 4, signal);
  expect(mocks.getWbi).toHaveBeenCalledTimes(2);
  expect(params(1)).toMatchObject({ fresh_type: 0, last_showlist: '', fresh_idx: 1 });
});
