import { describe, expect, it } from 'vitest';
import { LANYARD_STEP_MS, LanyardClock, lanyardCardBounds, lanyardEase } from '../../src/content/ui/user-menu-motion';

function runMotion(hz: number, duration: number) {
  const clock = new LanyardClock();
  clock.reset(0);
  let x = 0, previous = 0, steps = 0, flip = 0, tilt = 0, alpha = 0;
  const frames: number[] = [];
  for (let frame = 1; ; frame++) {
    const now = Math.min(duration, frame * 1000 / hz);
    const state = clock.advance(now, () => { previous = x; x += 10; steps++; });
    alpha = state.alpha;
    flip += (180 - flip) * lanyardEase(0.16, state.elapsed);
    tilt += (9 - tilt) * lanyardEase(0.12, state.elapsed);
    frames.push(previous + (x - previous) * alpha);
    if (now === duration) break;
  }
  return { x, steps, rendered: previous + (x - previous) * alpha, flip, tilt, frames };
}

describe('account card high-refresh motion', () => {
  it.each([100, 120, 144, 240])('keeps physical time and easing unchanged at %i Hz', hz => {
    const baseline = runMotion(60, 250);
    const motion = runMotion(hz, 250);
    expect(motion.steps).toBe(15);
    expect(motion.x).toBe(baseline.x);
    expect(motion.rendered).toBeCloseTo(baseline.rendered, 9);
    expect(motion.flip).toBeCloseTo(baseline.flip, 9);
    expect(motion.tilt).toBeCloseTo(baseline.tilt, 9);
  });

  it('renders new intermediate positions on every 100 Hz frame, not only physics steps', () => {
    const { frames } = runMotion(100, 100);
    // With 10 px per 60 Hz step, each 10 ms rendered interval advances by 6 px.
    for (let i = 2; i < frames.length; i++) expect(frames[i] - frames[i - 1]).toBeCloseTo(6, 9);
  });

  it('bounds long-task catch-up and resets hidden-tab time instead of fast-forwarding', () => {
    const clock = new LanyardClock();
    clock.reset(0);
    let steps = 0;
    const delayed = clock.advance(60_000, () => steps++);
    expect(steps).toBe(4);
    expect(delayed.elapsed).toBeCloseTo(LANYARD_STEP_MS * 4);
    clock.reset(120_000);
    const resumed = clock.advance(120_010, () => steps++);
    expect(steps).toBe(4);
    expect(resumed.elapsed).toBe(10);
    expect(resumed.alpha).toBeCloseTo(0.6);
  });

  it('matches the original 60 Hz flip and tilt coefficients', () => {
    expect(lanyardEase(0.16, LANYARD_STEP_MS)).toBeCloseTo(0.16, 12);
    expect(lanyardEase(0.12, LANYARD_STEP_MS)).toBeCloseTo(0.12, 12);
    expect(lanyardEase(0.16, 0)).toBe(0);
  });
});

describe('account card hit geometry', () => {
  it('accounts for the top hanging hole and scale in the resting card', () => {
    const bounds = lanyardCardBounds(400, 100, 236, 460, 0, 1.1, 20.5);
    expect(bounds.left).toBeCloseTo(270.2);
    expect(bounds.right).toBeCloseTo(529.8);
    expect(bounds.top).toBeCloseTo(77.45);
    expect(bounds.bottom).toBeCloseTo(583.45);
  });

  it.each([-1.1, -0.2, 0.7, Math.PI / 2])('encloses the actual rotated corners at %f radians', angle => {
    const bounds = lanyardCardBounds(400, 100, 236, 460, angle, 1.1, 20.5);
    // Apply the CSS matrix to the four corners independently of the bounds formula.
    const corners = [[0, 0], [236, 0], [0, 460], [236, 460]].map(([x, y]) => {
      const dx = (x - 118) * 1.1, dy = (y - 20.5) * 1.1;
      return { x: 400 + dx * Math.cos(angle) - dy * Math.sin(angle), y: 100 + dx * Math.sin(angle) + dy * Math.cos(angle) };
    });
    expect(bounds.left).toBeCloseTo(Math.min(...corners.map(p => p.x)), 9);
    expect(bounds.right).toBeCloseTo(Math.max(...corners.map(p => p.x)), 9);
    expect(bounds.top).toBeCloseTo(Math.min(...corners.map(p => p.y)), 9);
    expect(bounds.bottom).toBeCloseTo(Math.max(...corners.map(p => p.y)), 9);
  });
});
