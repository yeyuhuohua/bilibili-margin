import { describe, expect, it } from 'vitest';
import {
  ZOOM_MAX, ZOOM_MIN, clampPan, clampZoom, nextZoomStep, panLimits, wheelZoomFactor, zoomAtPoint,
} from '../../src/content/ui/lightbox-zoom';

describe('lightbox zoom helpers', () => {
  it('clamps zoom scales and falls back cleanly for non-finite values', () => {
    expect(clampZoom(0.1)).toBe(ZOOM_MIN);
    expect(clampZoom(10)).toBe(ZOOM_MAX);
    expect(clampZoom(1.75)).toBe(1.75);
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it('steps cleanly across discrete levels even from arbitrary wheel scales', () => {
    expect(nextZoomStep(1, 1)).toBe(1.25);
    expect(nextZoomStep(1, -1)).toBe(0.75);
    expect(nextZoomStep(1.24, 1)).toBe(1.5);
    expect(nextZoomStep(1.26, -1)).toBe(1);
    expect(nextZoomStep(ZOOM_MIN, -1)).toBe(ZOOM_MIN);
    expect(nextZoomStep(ZOOM_MAX, 1)).toBe(ZOOM_MAX);
  });

  it('centers unzoomed or non-overflowing axes and clamps panning to stage bounds', () => {
    const portrait = { baseW: 320, baseH: 640, stageW: 1200, stageH: 640 };
    expect(panLimits(1, portrait)).toEqual({ maxX: 0, maxY: 0 });
    expect(panLimits(1.5, portrait)).toEqual({ maxX: 0, maxY: 160 });
    expect(clampPan(80, 300, 1.5, portrait)).toEqual({ x: 0, y: 160 });
    expect(clampPan(-80, -300, 1.5, portrait)).toEqual({ x: 0, y: -160 });
  });

  it('keeps the cursor anchor stationary while zooming and resets pan at <= 100%', () => {
    const wide = { baseW: 800, baseH: 600, stageW: 1000, stageH: 700 };
    const zoomedIn = zoomAtPoint({ scale: 1, x: 0, y: 0 }, 2, 100, -50, wide);
    expect(zoomedIn).toEqual({ scale: 2, x: -100, y: 50 });

    const zoomedOut = zoomAtPoint(zoomedIn, 0.75, 100, -50, wide);
    expect(zoomedOut).toEqual({ scale: 0.75, x: 0, y: 0 });
  });

  it('computes consistent wheel zoom directions and clamps extreme deltas', () => {
    expect(wheelZoomFactor(-120, 0, false)).toBeGreaterThan(1);
    expect(wheelZoomFactor(120, 0, false)).toBeLessThan(1);
    expect(wheelZoomFactor(0, 0, false)).toBe(1);
    expect(wheelZoomFactor(-5000, 0, false)).toBeCloseTo(wheelZoomFactor(-240, 0, false), 12);
    expect(wheelZoomFactor(-10, 0, true)).toBeGreaterThan(wheelZoomFactor(-10, 0, false));
  });
});
