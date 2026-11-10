import { beforeEach, afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ nav: vi.fn(), getJSON: vi.fn() }));
vi.mock('../../src/content/api/http', () => mocks);
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('window', globalThis);
  mocks.nav.mockReset().mockResolvedValue({ isLogin: true, mid: 1 });
  mocks.getJSON.mockReset().mockResolvedValue({ 2: { attribute: 2 }, 3: { attribute: 6 }, 4: { attribute: 0 }, 5: { attribute: 128 } });
});
afterEach(() => vi.unstubAllGlobals());

it('同帧按 UP 去重合批，识别关注、互关和未关注，命中缓存不重复查询', async () => {
  const { followStatus } = await import('../../src/content/api/follow-status');
  const first = followStatus(2);
  expect(followStatus(2)).toBe(first);
  expect(await Promise.all([first, followStatus(3), followStatus(4), followStatus(5), followStatus(6)])).toEqual([true, true, false, false, undefined]);
  expect(mocks.getJSON).toHaveBeenCalledExactlyOnceWith('/x/relation/relations', { fids: '2,3,4,5,6' });
  expect(await followStatus(2)).toBe(true);
  expect(mocks.getJSON).toHaveBeenCalledTimes(1);
});

it('未登录不查询关系，失败不伪报未关注', async () => {
  const { followStatus } = await import('../../src/content/api/follow-status');
  mocks.nav.mockResolvedValueOnce({ isLogin: false });
  expect(await followStatus(2)).toBeUndefined();
  expect(mocks.getJSON).not.toHaveBeenCalled();
  mocks.getJSON.mockRejectedValueOnce(new Error('temporary'));
  expect(await followStatus(3)).toBeUndefined();
  expect(await followStatus(-1)).toBeUndefined();
});

it('关注操作后缓存失效，不保存操作前迟到的结果', async () => {
  const { followStatus, invalidateFollowStatus } = await import('../../src/content/api/follow-status');
  let finish!: (value: unknown) => void;
  mocks.getJSON.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = followStatus(2);
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  invalidateFollowStatus(2);
  finish({ 2: { attribute: 0 } });
  expect(await pending).toBeUndefined();
  expect(await followStatus(2)).toBe(true);
  invalidateFollowStatus(2);
  expect(await followStatus(2)).toBe(true);
  expect(mocks.getJSON).toHaveBeenCalledTimes(3);
});

it('大批卡片每批最多 40 人且最多两批并发', async () => {
  const { followStatus } = await import('../../src/content/api/follow-status');
  let active = 0, peak = 0;
  mocks.getJSON.mockImplementation(async (_path, params) => {
    active++; peak = Math.max(peak, active);
    expect(params.fids.split(',').length).toBeLessThanOrEqual(40);
    await new Promise(resolve => setTimeout(resolve, 5)); active--;
    return {};
  });
  await Promise.all(Array.from({ length: 121 }, (_, i) => followStatus(i + 2)));
  expect(mocks.getJSON).toHaveBeenCalledTimes(4);
  expect(peak).toBe(2);
});
