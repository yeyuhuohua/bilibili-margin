import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startTracking } from '../../src/content/footprint/beat';
import { every } from '../../src/content/sched';
import { applyBeat, type Activity, type FpMessage } from '../../src/shared/activity';

vi.mock('../../src/content/sched', () => ({ every: vi.fn(() => () => {}) }));

let messages: FpMessage[], data: Activity, slots: Record<string, number[]>;
function page(visible = true, audible = false) {
  const events = new EventTarget();
  const doc = Object.assign(new EventTarget(), {
    visibilityState: visible ? 'visible' : 'hidden',
    querySelectorAll: () => audible ? [{ paused: false, ended: false, readyState: 4, muted: false, volume: 1 }] : [],
  });
  vi.stubGlobal('document', doc);
  vi.stubGlobal('addEventListener', events.addEventListener.bind(events));
  startTracking();
  return { events, doc };
}
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-09T12:00:00Z'));
  messages = []; data = {}; slots = {};
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(async (m: FpMessage) => {
    messages.push(m);
    if (m.op === 'beat') applyBeat(data, slots, m.from, m.to);
    return { ok: true };
  }) } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const beats = () => messages.filter((m): m is Extract<FpMessage, { op: 'beat' }> => m.op === 'beat');

describe('footprint tracking across short visits and lifecycle changes', () => {
  it('saves the actual five-second visit before the first periodic heartbeat', () => {
    const { events } = page(), from = Date.now();
    vi.advanceTimersByTime(5000); events.dispatchEvent(new Event('pagehide'));
    expect(beats()).toEqual([{ margin: 'fp', op: 'beat', from, to: from + 5000 }]);
  });
  it('short visits collectively light a day without requiring one fifteen-second visit', () => {
    for (let i = 0; i < 16; i++) {
      const { events } = page(); vi.advanceTimersByTime(5000); events.dispatchEvent(new Event('pagehide'));
    }
    expect(Object.values(data).reduce((sum, day) => sum + day.s, 0)).toBeGreaterThanOrEqual(60);
  });
  it('visibility hiding and pagehide do not send the same remainder twice', () => {
    const { events, doc } = page(); vi.advanceTimersByTime(5000);
    doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange')); events.dispatchEvent(new Event('pagehide'));
    expect(beats()).toHaveLength(1);
    vi.mocked(every).mock.calls.at(-1)![1](); expect(beats()).toHaveLength(1);
  });
  it('does not record a hidden silent page, but does record audible background playback', () => {
    page(false); vi.advanceTimersByTime(15000); vi.mocked(every).mock.calls.at(-1)![1]();
    expect(beats()).toHaveLength(0);
    page(false, true); vi.advanceTimersByTime(15000); vi.mocked(every).mock.calls.at(-1)![1]();
    expect(beats()).toHaveLength(1); expect(beats()[0].to - beats()[0].from).toBe(15000);
  });
  it('does not count time spent away when a page is restored from bfcache', () => {
    const { events } = page(); vi.advanceTimersByTime(5000); events.dispatchEvent(new Event('pagehide'));
    vi.advanceTimersByTime(60000);
    const restored = new Event('pageshow'); Object.defineProperty(restored, 'persisted', { value: true }); events.dispatchEvent(restored);
    vi.advanceTimersByTime(5000); events.dispatchEvent(new Event('pagehide'));
    expect(beats()).toHaveLength(2); expect(beats().map(m => m.to - m.from)).toEqual([5000, 5000]);
  });
  it('does not flush a suspended or idle interval as active time', () => {
    const { events } = page(); vi.advanceTimersByTime(120000); events.dispatchEvent(new Event('pagehide'));
    expect(beats()).toHaveLength(0);
  });
});
