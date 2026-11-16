import { describe, expect, it } from 'vitest';
import { parseLrc, lyricIndex } from '../../src/content/music-lyrics';

describe('local music lyrics', () => {
  it('keeps multiple timestamps, normalizes fractions and sorts after millisecond offsets', () => {
    expect(parseLrc('[offset:-500]\n[01:02.50][00:02.5]同一句\n[00:00.100]开头')).toEqual([
      { at: 0, text: '开头' }, { at: 2, text: '同一句' }, { at: 62, text: '同一句' },
    ]);
  });
  it('ignores metadata and malformed timestamps without fabricating lyrics', () => {
    expect(parseLrc('[ti:歌名]\n[00:99]错误\n没有时间\n[00:12.05]有效')).toEqual([{ at: 12.05, text: '有效' }]);
  });
  it('handles seeking backwards, gaps and positions before the first line', () => {
    const lines = parseLrc('[00:10]一\n[00:20]二\n[00:30]三');
    expect([0, 10, 19.9, 20, 35, 11].map(time => lyricIndex(lines, time))).toEqual([-1, 0, 0, 1, 2, 0]);
    expect(lyricIndex([], 10)).toBe(-1);
  });
});
