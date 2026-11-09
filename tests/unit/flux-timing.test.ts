import { describe, expect, it } from 'vitest';
import { fluxTiming } from '../../src/content/bg/flux/timing';

describe('流光的时间步与高刷视觉参数', () => {
  it('60fps 保留原有的拖尾衰减、阻尼与亮度', () => {
    const step = fluxTiming(1 / 60, 0);
    expect(step.dt).toBeCloseTo(1 / 60, 12);
    expect(step.decay).toBeCloseTo(.92, 12);
    expect(step.damping).toBeCloseTo(.2, 12);
    expect(step.exposure).toBeCloseTo(1, 12);
  });

  for (const hz of [30, 60, 100, 120, 144, 165, 240]) {
    it(`${hz}Hz 的一秒累计衰减、固定目标阻尼和持续注入亮度一致`, () => {
      let trail = 1, velocity = 0, brightness = 0;
      for (let i = 1; i <= hz; i++) {
        const { decay, damping, exposure } = fluxTiming(i / hz, (i - 1) / hz);
        trail *= decay;
        velocity += (1 - velocity) * damping;
        brightness = brightness * decay + exposure;
      }
      expect(trail).toBeCloseTo(Math.pow(.92, 60), 12);
      expect(velocity).toBeCloseTo(1 - Math.pow(.8, 60), 12);
      expect(brightness).toBeCloseTo((1 - Math.pow(.92, 60)) / (1 - .92), 10);
    });
  }

  it('首帧和重建拖尾缓冲区后只推进一个基准步', () => {
    expect(fluxTiming(10, -1)).toEqual(fluxTiming(1 / 60, 0));
  });

  it('重复时间戳与倒退时钟不会重复注入、衰减或推进粒子', () => {
    const still = { dt: 0, decay: 1, damping: 0, exposure: 0 };
    expect(fluxTiming(5, 5)).toEqual(still);
    expect(fluxTiming(4, 5)).toEqual(still);
  });

  it('长暂停保持100ms上限，下一帧直接使用新的间隔，不追赶积压时间', () => {
    expect(fluxTiming(500, 1)).toEqual(fluxTiming(.1, 0));
    expect(fluxTiming(500.01, 500).dt).toBeCloseTo(.01, 10);
  });
});
