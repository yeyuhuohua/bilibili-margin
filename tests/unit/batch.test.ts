import { describe, expect, it } from 'vitest';
import { BATCH_DEFAULT, batchCount, batchIndexOf, batchStartOf, clampBatchSize, newContentStart, trimmedStart } from '../../src/shared/batch';

describe('推荐批次窗口', () => {
  it('每批条数夹在 1–100，非法值回到默认 12', () => {
    expect(clampBatchSize(undefined)).toBe(BATCH_DEFAULT);
    expect(clampBatchSize('18')).toBe(BATCH_DEFAULT);
    expect(clampBatchSize(Number.NaN)).toBe(BATCH_DEFAULT);
    expect(clampBatchSize(0)).toBe(1);
    expect(clampBatchSize(200)).toBe(100);
    expect(clampBatchSize(18.4)).toBe(18);
  });

  it('按每批条数切窗，空队列没有批次', () => {
    expect(batchCount(0, 12)).toBe(0);
    expect(batchCount(12, 12)).toBe(1);
    expect(batchCount(25, 12)).toBe(3);
    expect(batchIndexOf(0, 12)).toBe(0);
    expect(batchIndexOf(23, 12)).toBe(1);
    expect(batchIndexOf(24, 12)).toBe(2);
  });

  it('窗口起点按批次对齐', () => {
    expect(batchStartOf(0, 12)).toBe(0);
    expect(batchStartOf(11, 12)).toBe(0);
    expect(batchStartOf(12, 12)).toBe(12);
  });

  it('刷新把新内容所在批次作为落点，不满一批的尾巴并入其中', () => {
    // 已有 24 条、每批 12：没有裁剪，新内容从第 24 条开始 → 第 3 批
    expect(newContentStart(24, 0, 12)).toBe(24);
    // 已有 20 条（上一批只有 8 条），新内容仍落在第 2 批，和尾巴一起补齐
    expect(newContentStart(20, 0, 12)).toBe(12);
    // 队列裁掉头部 20 条时，新内容下标同步左移
    expect(newContentStart(1000, 20, 12)).toBe(972);
    expect(newContentStart(10, 20, 12)).toBe(0);
  });

  it('裁剪头部后旧窗口左移，不越过队列起点', () => {
    expect(trimmedStart(120, 20)).toBe(100);
    expect(trimmedStart(10, 20)).toBe(0);
  });
});
