import { describe, expect, it } from 'vitest';
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
});
