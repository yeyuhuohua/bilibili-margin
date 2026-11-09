/** 推荐批次导航：队列是连续的视频列表，批次是固定大小的窗口。 */
export const BATCH_MIN = 1;
export const BATCH_DEFAULT = 12;
export const BATCH_MAX = 100;
/** 队列上限；超出时从头部裁剪，窗口起点同步左移 */
export const BATCH_QUEUE_MAX = 1000;

export function clampBatchSize(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : BATCH_DEFAULT;
  return Math.min(BATCH_MAX, Math.max(BATCH_MIN, n));
}

export function batchCount(total: number, size: number): number {
  return total > 0 ? Math.ceil(total / size) : 0;
}

export function batchIndexOf(start: number, size: number): number {
  return Math.floor(Math.max(0, start) / size);
}

export function batchStartOf(index: number, size: number): number {
  return Math.floor(Math.max(0, index) / size) * size;
}

/** 追加 before 条之后新内容落到的批次起点；队列头部裁掉 over 条时同步左移 */
export function newContentStart(before: number, over: number, size: number): number {
  return batchStartOf(before - over, size);
}

/** 头部裁掉 over 条后，旧窗口起点应左移到哪 */
export function trimmedStart(start: number, over: number): number {
  return Math.max(0, start - over);
}
