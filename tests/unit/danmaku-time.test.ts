import { describe, expect, it } from 'vitest';
import { parseAirborneTime } from '../../src/content/danmaku-time';

/** 认不出来的一律是 NaN，单独包一层好读 */
const isNaN = (text: string | null): boolean => Number.isNaN(parseAirborneTime(text));

describe('弹幕空降时间解析', () => {
  it('带分隔符的写法按 分秒 / 时分秒 读成秒数', () => {
    expect(parseAirborneTime('03:20')).toBe(200);
    expect(parseAirborneTime('00:45')).toBe(45);
    expect(parseAirborneTime('1:02:33')).toBe(3753);
    expect(parseAirborneTime('空降2:15')).toBe(135);
    expect(parseAirborneTime('空降 2分15秒')).toBe(135);
    expect(parseAirborneTime('三分二十秒')).toBe(200);
    expect(parseAirborneTime('十一:30')).toBe(690);
    expect(parseAirborneTime('一小时02分33秒')).toBe(3753);
  });

  it('没分隔符的 3~4 位紧凑数字按分秒读', () => {
    expect(parseAirborneTime('315')).toBe(195);
    expect(parseAirborneTime('1030')).toBe(630);
    expect(parseAirborneTime('空降315')).toBe(195);
    expect(parseAirborneTime(' 1030 ')).toBe(630);
  });

  it('空串、null 和读不出时间的中文都返回 NaN', () => {
    expect(isNaN(null)).toBe(true);
    expect(isNaN('')).toBe(true);
    expect(isNaN('哈哈哈笑死')).toBe(true);
  });

  it('233 / 2333 这类大笑弹幕不当成空降时间', () => {
    expect(isNaN('233')).toBe(true);
    expect(isNaN('2333')).toBe(true);
  });

  it('播放量、年份序号、型号、计量后缀都不当成时间', () => {
    expect(isNaN('3.9万人+')).toBe(true);
    expect(isNaN('315万播放')).toBe(true);
    expect(isNaN('2025的第一波')).toBe(true);
    expect(isNaN('054A')).toBe(true);
  });

  it('一条弹幕里两个都说得通的紧凑时间按歧义放弃', () => {
    expect(isNaN('315 和 1030')).toBe(true);
  });

  it('分秒超出 0~59 的畸形时间直接丢掉', () => {
    expect(isNaN('3:99')).toBe(true);
    expect(isNaN('99:99')).toBe(true);
    expect(isNaN('空降 2:75')).toBe(true);
    expect(isNaN('1:99:00')).toBe(true);
    expect(isNaN('1:75:30')).toBe(true);
    // 分钟不设上限：长视频里「100:00」是正常时间轴
    expect(parseAirborneTime('100:00')).toBe(6000);
  });

  it('无效显式时间不能被紧凑数字规则重新识别，多个时间不猜测', () => {
    for (const text of ['3:130', '1:999', '1:02:130', '-3:20', '03:20 或 04:10']) expect(isNaN(text)).toBe(true);
    expect(parseAirborneTime('1小时30分')).toBe(5400);
  });
});
