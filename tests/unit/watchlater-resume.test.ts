import { afterEach, expect, it, vi } from 'vitest';
import { resumeTarget, resumeWatchLater } from '../../src/content/api/watchlater-resume';

const first = 'BV14W4B6sET9', second = 'BV1kuxM6bE2A';
const entry = new URL('https://www.bilibili.com/list/watchlater?bvid=' + first);
const video = { bvid: first, pages: [{ page: 1, cid: 10 }, { page: 2, cid: 11 }],
  ugc_season: { sections: [{ episodes: [{ bvid: second, cid: 20 }] }] } };
const visit = (bvid: string, cid: number, page: number, view_at = 50) =>
  ({ view_at, history: { business: 'archive', bvid, cid, page } });

it('restores a part in the native queue or a verified sibling episode in its series', () => {
  expect(resumeTarget(entry, video, [visit(first, 11, 2)], 100)?.searchParams.get('p')).toBe('2');
  expect(resumeTarget(entry, video, [visit(second, 20, 1)], 100)?.pathname).toBe('/video/' + second + '/');
});

it('ignores playback created on entry and never guesses from a different video or a missing part', () => {
  expect(resumeTarget(entry, video, [visit(first, 10, 1, 100), visit(second, 20, 1)], 100)?.pathname).toContain(second);
  for (const latest of [visit('other', 11, 2), visit(first, 999, 2), visit(first, 10, 1)])
    expect(resumeTarget(entry, video, [latest], 100)).toBeUndefined();
});

afterEach(() => vi.unstubAllGlobals());
it.each(['&p=1', '&cid=11', '&t=24', '#reply'])('honors explicit native navigation %s before requesting history', async suffix => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('location', new URL(entry.href + '&margin_resume=1' + suffix));
  vi.stubGlobal('history', { replaceState: vi.fn() });
  await resumeWatchLater();
  expect(fetch).not.toHaveBeenCalled();
});

it('lets a manual selection cancel an outstanding history lookup', async () => {
  const win = Object.assign(new EventTarget(), { setTimeout });
  vi.stubGlobal('window', win);
  const replace = vi.fn();
  vi.stubGlobal('location', { href: entry.href + '&margin_resume=1', replace });
  vi.stubGlobal('history', { replaceState: vi.fn() });
  const respond = (data: unknown) => new Response(JSON.stringify({ code: 0, data }));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(respond(video)).mockImplementationOnce(async () => {
    win.dispatchEvent(new Event('pointerdown'));
    return respond({ list: [visit(second, 20, 1)] });
  }));
  await resumeWatchLater();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(replace).not.toHaveBeenCalled();
});
