import { describe, expect, it } from 'vitest';
import { danmakuJumpCandidates, jumpTime } from '../../src/shared/danmaku-jump';

const rows = (text = '空降 01:30', target = 10) => ['a123', 'b234', 'c345'].map(author => ({ text, at: target, author }));
describe('弹幕跳转候选', () => {
  it('仅接受含跳转关键词和唯一明确时间的文本', () => {
    expect(jumpTime('空降 01：30')).toBe(90);
    expect(jumpTime('跳伞到1分30秒')).toBe(90);
    expect(jumpTime('传送门 1:02:03')).toBe(3723);
    expect(jumpTime('01:30 好听')).toBeNull();
    expect(jumpTime('空降 1:90')).toBeNull();
    expect(jumpTime('空降 1:02:90')).toBeNull();
    expect(jumpTime('空降 01:30 或 02:30')).toBeNull();
    expect(jumpTime('空降 -01:30')).toBeNull();
  });
  it('至少三个不同发送者支持同一时间，重复发送只算一次', () => {
    expect(danmakuJumpCandidates(rows(), 120)).toEqual([{ time: 90, from: 10, until: 25, votes: 3 }]);
    expect(danmakuJumpCandidates([...rows().slice(0, 2), ...rows().slice(0, 2)], 120)).toEqual([]);
    expect(danmakuJumpCandidates(rows().map(row => ({ ...row, author: '' })), 120)).toEqual([]);
  });
  it('排除回跳、片尾、无效时长和不一致时间', () => {
    expect(danmakuJumpCandidates(rows('空降 00:15', 20), 120)).toEqual([]);
    expect(danmakuJumpCandidates(rows('空降 02:00'), 120)).toEqual([]);
    expect(danmakuJumpCandidates(rows(), NaN)).toEqual([]);
    expect(danmakuJumpCandidates(rows().map((row, i) => ({ ...row, text: `空降 01:${30 + i}` })), 120)).toEqual([]);
  });
  it('候选按出现位置排序，在对应弹幕出现附近提示', () => {
    expect(danmakuJumpCandidates([...rows('空降 01:30', 60), ...rows('空降 00:40', 5)], 120)).toEqual([
      { time: 40, from: 5, until: 20, votes: 3 }, { time: 90, from: 60, until: 75, votes: 3 },
    ]);
  });
});
