import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { lensData } from '../../src/content/ui/material-maps';

describe('static lens field', () => {
  it('keeps the flat interior neutral and clips outside rounded corners', () => {
    const data = lensData(120, 40, 20, 12), center = (20 * 120 + 60) * 4;
    expect([...data.slice(center, center + 4)]).toEqual([128, 128, 128, 255]);
    expect(data[3]).toBe(0);
  });
  it('bends opposite edges symmetrically instead of translating the entire control', () => {
    const data = lensData(120, 40, 20, 12);
    const a = data[(20 * 120 + 2) * 4], b = data[(20 * 120 + 117) * 4];
    expect(a).toBeGreaterThan(128); expect(b).toBeLessThan(128); expect(Math.abs(a + b - 256)).toBeLessThanOrEqual(1);
  });
  // Captured from the pre-optimization implementation, including odd and tiny sizes.
  it.each([
    [1, 1, 0, 1, '79dfad351f79ef0e65a11fff0a9ed44bf628f9390ff06b92ee4ee5e2477616ea'],
    [2, 3, 2, 2, '15783c21a71ad27670d51767b1bafa6d6bfacf1fea37b3a1c892b5dd96a1e49f'],
    [33, 19, 8.5, 6.5, '96bb482f22d4efef6fa8e51955a20a684ed9f1762fec206ee7e56a3728cf44d6'],
    [120, 40, 20, 12, '6be327ca03d1ea4a9f4aa8c77d62b19833b70bb681784070d76c5e6acc404121'],
    [520, 48, 24, 16, 'c7c7006bc01be9dcf0ebc42be60a5e9e1c471070e2ff6c0204212bd688e5c45f'],
    [900, 70, 24, 18, '4f8c0dce3a1306fcc1a0eb3745260f67248e5472a447a0ab107ecf2e8914ae62'],
    [720, 400, 24, 18, '8e3845880c5599b79d46627850178d9d79b668a1147a5e364b79f8cea980883b'],
    [5, 7, 0, 1, '8465307a97609d1402629be0f159b8be884f5ed2ae6b62cb66316f6520f5d62d'],
    [19, 17, 100, 100, '3cc1f71d85997e95a1b965f3bc49570ebcc23876705b36c7410d065b7998eb1e'],
  ] as const)('preserves every channel at %ix%i (radius %s, bevel %s)', (w, h, radius, bevel, hash) => {
    expect(createHash('sha256').update(lensData(w, h, radius, bevel)).digest('hex')).toBe(hash);
  });
});
