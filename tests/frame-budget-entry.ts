import { BackgroundLayer } from '../src/content/bg/background';

type Phase = { draws: number; maxGap: number };
type Run = (seconds?: number, cost?: number, interval?: number) => Phase;

/** 运行真实调度器，只替换帧时钟和绘制耗时；不能用此结果声称真实 GPU 帧率。 */
function withScheduler<T>(hz: number, test: (layer: any, run: Run, pause: () => void) => T): T {
  const nativeRaf = requestAnimationFrame, nativeCancel = cancelAnimationFrame;
  const nativeNow = Object.getOwnPropertyDescriptor(performance, 'now');
  let pending: FrameRequestCallback | null = null, handle = 0, time = 0, clock = 0, cost = 0;
  let drawTimes: number[] = [];
  const layer = new BackgroundLayer() as any;
  try {
    window.requestAnimationFrame = (fn) => { pending = fn; return ++handle; };
    window.cancelAnimationFrame = () => { pending = null; };
    Object.defineProperty(performance, 'now', { configurable: true, value: () => clock });
    layer.cfg = { mode: 'fixed', shader: 'silk', intensity: .6 };
    layer.soft = false;
    layer.draw = () => { drawTimes.push(time); clock += cost; };
    const run: Run = (seconds = 3, drawCost = 0, interval = 1000 / hz) => {
      drawTimes = [];
      cost = drawCost;
      const ticks = Math.round(seconds * 1000 / interval);
      for (let i = 0; i < ticks; i++) {
        time += interval;
        clock = time;
        const fn = pending; pending = null;
        if (!fn) throw new Error('scheduler unexpectedly stopped');
        fn(time);
      }
      let maxGap = 0;
      for (let i = 1; i < drawTimes.length; i++) maxGap = Math.max(maxGap, drawTimes[i] - drawTimes[i - 1]);
      return { draws: drawTimes.length, maxGap };
    };
    const pause = () => {
      layer.hold('test', true);
      if (pending) throw new Error('hold must cancel the pending frame');
      time += 5000;
      layer.hold('test', false);
    };
    layer.loop();
    return test(layer, run, pause);
  } finally {
    layer.stop();
    window.requestAnimationFrame = nativeRaf;
    window.cancelAnimationFrame = nativeCancel;
    if (nativeNow) Object.defineProperty(performance, 'now', nativeNow);
    else delete (performance as Partial<Performance>).now;
  }
}

export function frameBudget(hz: number) {
  return withScheduler(hz, (layer, run, pause) => {
    const full = run();
    layer.cap(30);
    const capped = run();
    const adaptiveAfterCap = layer.frameMs;
    layer.cap(0);
    const restored = run();
    pause();
    const resumed = run();
    return { full, capped, adaptiveAfterCap, restored, resumed };
  });
}

export function frameProtection(hz: number) {
  return withScheduler(hz, (layer, run) => {
    run(1);
    // 持续昂贵的提交会降档；昂贵状态下不能因为 cap 后的间隔变好就恢复。
    run(2, 7);
    const costlyMs = layer.frameMs;
    const costly = run(3, 7);
    const stillCostlyMs = layer.frameMs;
    run(32);
    const recoveredMs = layer.frameMs;
    const recovered = run();
    // CPU 提交便宜，但 rAF 持续丢两个节拍时也必须降档。
    run(2, 0, 3 * 1000 / hz);
    const droppedMs = layer.frameMs;
    return { costlyMs, costly, stillCostlyMs, recoveredMs, recovered, droppedMs };
  });
}
