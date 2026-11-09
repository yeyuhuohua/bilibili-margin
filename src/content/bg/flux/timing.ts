/** 以原来 60fps 的视觉参数为基准，按经过的秒数归一化。
 * 首帧走一个基准步；长暂停最多推进 100ms，与原粒子步长上限一致，不追赶后台时间。
 */
export function fluxTiming(now: number, previous: number): { dt: number; decay: number; damping: number; exposure: number } {
  const elapsed = previous < 0 ? 1 / 60 : now - previous;
  const dt = Number.isFinite(elapsed) ? Math.max(0, Math.min(0.1, elapsed)) : 1 / 60;
  const steps = dt * 60;
  const decay = Math.pow(0.92, steps);
  return {
    dt,
    decay,
    damping: 1 - Math.pow(0.8, steps),
    // 衰减改变时同步补偿每步的加法混合量，避免高刷下拖尾变亮。
    exposure: (1 - decay) / (1 - 0.92),
  };
}
