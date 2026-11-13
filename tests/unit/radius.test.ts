import { describe, it, expect } from 'vitest';
import { transformRadii } from '../../scripts/radius.mjs';

describe('native continuous corners', () => {
  it('adds squircle and preserves the existing radius multiplier', () => {
    expect(transformRadii('.card{border-radius:12px}')).toBe('.card{border-radius:calc(12px*var(--margin-rk,1));corner-shape:squircle}');
  });
  it('keeps important on both radius and shape', () => {
    expect(transformRadii('.card{border-radius:var(--m-radius) !important;}')).toContain('border-radius:var(--m-radius) !important;corner-shape:squircle!important;');
  });
  it('keeps round avatars, particles and capsule sentinels', () => {
    for (const radius of ['50%', '100%', '99px', '999px', '9999px', '99em'])
      expect(transformRadii(`.pill{border-radius:${radius}}`)).toContain('corner-shape:round');
  });
  it('keeps square zero corners and individual-corner declarations', () => {
    expect(transformRadii('.top{border-radius:12px 12px 0 0}')).toContain('12px*var(--margin-rk,1)) 0 0;corner-shape:squircle');
    expect(transformRadii('.one{border-top-left-radius:8px!important}')).toContain('corner-top-left-shape:squircle!important');
    expect(transformRadii('.square{border-radius:0}')).toContain('border-radius:0;');
  });
  it('inherits shape for nested rims, image masks and fills', () => {
    expect(transformRadii('.fill{border-radius:inherit}')).toBe('.fill{border-radius:inherit;corner-shape:inherit}');
  });
  it('preserves explicit shape overrides and never changes unrelated dimensions', () => {
    const css = transformRadii('.hero{width:56px;border-radius:28px;corner-shape:round}');
    expect(css).toContain('width:56px;');
    expect(css).toContain('corner-shape:round');
    expect(css).not.toContain('corner-shape:squircle');
    expect(transformRadii('.hero{corner-shape:round;border-radius:28px}')).not.toContain('corner-shape:squircle');
  });
});
