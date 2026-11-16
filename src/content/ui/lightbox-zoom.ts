export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 5;
export const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5] as const;

export interface ZoomState {
  scale: number;
  x: number;
  y: number;
}

export interface ZoomBounds {
  baseW: number;
  baseH: number;
  stageW: number;
  stageH: number;
}

/** 将缩放倍率限制在允许区间内；非法值回退为 1。 */
export function clampZoom(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale));
}

/** 按按钮或快捷键步进到下一档可读百分比。 */
export function nextZoomStep(scale: number, direction: 1 | -1): number {
  const pct = Math.round(clampZoom(scale) * 100);
  if (direction > 0) {
    return ZOOM_STEPS.find((step) => Math.round(step * 100) > pct + 1) ?? ZOOM_MAX;
  }
  for (let idx = ZOOM_STEPS.length - 1; idx >= 0; idx--) {
    if (Math.round(ZOOM_STEPS[idx] * 100) < pct - 1) return ZOOM_STEPS[idx];
  }
  return ZOOM_MIN;
}

/** 计算当前缩放尺寸相对舞台的可平移半幅范围。 */
export function panLimits(scale: number, bounds: ZoomBounds): { maxX: number; maxY: number } {
  if (scale <= 1 || bounds.baseW <= 0 || bounds.baseH <= 0 || bounds.stageW <= 0 || bounds.stageH <= 0) {
    return { maxX: 0, maxY: 0 };
  }
  return {
    maxX: Math.max(0, (bounds.baseW * scale - bounds.stageW) / 2),
    maxY: Math.max(0, (bounds.baseH * scale - bounds.stageH) / 2),
  };
}

/** 将平移量限制在舞台边界内，避免图片被拖出视野。 */
export function clampPan(x: number, y: number, scale: number, bounds: ZoomBounds): { x: number; y: number } {
  const { maxX, maxY } = panLimits(scale, bounds);
  return {
    x: maxX === 0 ? 0 : Math.min(maxX, Math.max(-maxX, x)) || 0,
    y: maxY === 0 ? 0 : Math.min(maxY, Math.max(-maxY, y)) || 0,
  };
}

/** 以相对图片原始中心的指针坐标为锚点进行缩放。 */
export function zoomAtPoint(
  state: ZoomState,
  nextScale: number,
  pointerX: number,
  pointerY: number,
  bounds: ZoomBounds,
): ZoomState {
  const scale = clampZoom(nextScale);
  if (scale <= 1) return { scale, x: 0, y: 0 };
  const ratio = scale / state.scale;
  const rawX = pointerX - ratio * (pointerX - state.x);
  const rawY = pointerY - ratio * (pointerY - state.y);
  const pos = clampPan(rawX, rawY, scale, bounds);
  return { scale, x: pos.x, y: pos.y };
}

/** 将滚轮或触控板捏合增量转换为平滑缩放乘数。 */
export function wheelZoomFactor(deltaY: number, deltaMode: number, pinch: boolean): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  const clamped = Math.max(-240, Math.min(240, px));
  const speed = pinch ? 0.01 : 0.0025;
  return Math.exp(-clamped * speed);
}
