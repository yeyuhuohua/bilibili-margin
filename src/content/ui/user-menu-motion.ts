// Keep the original 60 Hz physics, while rendering between steps at the display's refresh rate.
export const LANYARD_STEP_MS = 1000 / 60;

export class LanyardClock {
  private last = 0;
  private remainder = 0;

  reset(now: number): void { this.last = now; this.remainder = 0; }

  advance(now: number, step: () => void): { elapsed: number; alpha: number } {
    // A suspended tab or a long task must not cause an unbounded catch-up loop.
    const elapsed = Math.max(0, Math.min(LANYARD_STEP_MS * 4, now - this.last));
    this.last = now;
    this.remainder += elapsed;
    while (this.remainder + 1e-7 >= LANYARD_STEP_MS) {
      step();
      this.remainder = Math.max(0, this.remainder - LANYARD_STEP_MS);
    }
    return { elapsed, alpha: this.remainder / LANYARD_STEP_MS };
  }
}

/** The same exponential easing as the old per-frame factor, independent of refresh rate. */
export function lanyardEase(factor: number, elapsed: number): number {
  return 1 - Math.pow(1 - factor, elapsed / LANYARD_STEP_MS);
}

export type LanyardBounds = { left: number; right: number; top: number; bottom: number };

/** Bounding box of the card's translate/rotate/scale around its hanging hole. */
export function lanyardCardBounds(x: number, y: number, width: number, height: number, angle: number,
  scale: number, holeY: number): LanyardBounds {
  const c = Math.cos(angle), s = Math.sin(angle);
  const halfW = width * scale / 2;
  const centerY = (height / 2 - holeY) * scale;
  const centerX = x - s * centerY, center = y + c * centerY;
  const rx = Math.abs(c) * halfW + Math.abs(s) * height * scale / 2;
  const ry = Math.abs(s) * halfW + Math.abs(c) * height * scale / 2;
  return { left: centerX - rx, right: centerX + rx, top: center - ry, bottom: center + ry };
}
