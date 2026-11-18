import { afterEach, expect, it, vi } from 'vitest';
import { toAppItem } from '../../src/shared/app-feed';
import { appRecommended } from '../../src/content/api/appfeed';

const raw = (desc: string) => ({
  goto: 'av', card_goto: 'av', bvid: 'BV1demo00001', param: '123', title: '视频',
  args: { up_id: 1, up_name: '测试 · 作者' }, player_args: { duration: 125 }, desc,
});
afterEach(() => vi.unstubAllGlobals());

it.each(['昨天 10:25', '11月10日', '2025年11月10日', '3小时前', '刚刚'])('keeps the native publication label %s', text => {
  expect(toAppItem(raw(`测试 · 作者 · ${text}`))).toHaveProperty('publishText', text);
});

it.each(['测试 · 作者', '测试 · 作者 · 100万播放', '其他作者 · 昨天 10:25', '测试 · 作者 · <b>昨天</b>'])('does not invent publication dates from %s', desc => {
  expect(toAppItem(raw(desc))?.publishText).toBeUndefined();
});

it('carries the native label through the normal background-message entry point', async () => {
  const item = toAppItem(raw('测试 · 作者 · 昨天 10:25'))!;
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(async () => ({ ok: true, items: [item], next: 1 })) } });
  expect((await appRecommended(0)).list[0]).toMatchObject({ duration: 125, pubdate: 0, publishText: '昨天 10:25' });
});

it('accepts cached messages created before publication labels were added', async () => {
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(async () => ({ ok: true, items: [{ bvid: 'BV1old000001', views: '', danmaku: '', duration: 60 }] })) } });
  expect((await appRecommended(0)).list[0]).toMatchObject({ pubdate: 0, duration: 60 });
});
