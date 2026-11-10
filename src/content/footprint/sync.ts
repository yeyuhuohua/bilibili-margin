import { activeOf, backfill, dayKey, failedBackfill, type Activity, type BackfillResult } from './store';

/** Versioned state deliberately ignores the old, potentially false-positive success stamp. */
export const SYNC_KEY = 'margin:activity-sync-v2';
const OLD_SUCCESS_KEY = 'margin:activity-bf';
const SIX_HOURS = 6 * 3600_000;
const BACKOFF = [30_000, 120_000, 600_000, 1800_000];
export interface SyncState {
  version: 2;
  at: number;
  nextRetry: number;
  failures: number;
  result: BackfillResult;
}
export type SyncOutcome = BackfillResult & { cached?: boolean; retryAt?: number };
interface SyncOptions { force?: boolean; signal?: AbortSignal; onStart?: () => void }

export function parseSyncState(raw: unknown): SyncState | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as SyncState;
  if (s.version !== 2 || !Number.isFinite(s.at) || !Number.isFinite(s.nextRetry) || !Number.isInteger(s.failures) || s.failures < 0 || !s.result) return null;
  if (!['ok', 'empty', 'partial', 'nologin', 'fail'].includes(s.result.status)) return null;
  if (![s.result.pages, s.result.days, s.result.entries].every(n => Number.isFinite(n) && n >= 0)) return null;
  // A clock correction must not suppress recovery for an arbitrary length of time.
  if (s.at > Date.now() + 60_000 || s.nextRetry > s.at + SIX_HOURS + 60_000) return null;
  return s;
}
export async function readSyncState(): Promise<SyncState | null> {
  return parseSyncState((await chrome.storage.local.get(SYNC_KEY))[SYNC_KEY]);
}

export function nextDelay(r: BackfillResult, failures: number): number {
  if (r.status === 'ok') return SIX_HOURS;
  if (r.status === 'empty' || r.status === 'nologin' || r.reason === 'nologin') return 300_000;
  // A deliberate page cap is not a transient failure. Do not flood the endpoint retrying it.
  if (r.reason === 'limit') return SIX_HOURS;
  return BACKOFF[Math.min(Math.max(0, failures - 1), BACKOFF.length - 1)];
}

async function run(since: Date, options: SyncOptions): Promise<SyncOutcome> {
  let prev: SyncState | null;
  try { prev = await readSyncState(); } catch { return failedBackfill('storage'); }
  const now = Date.now();
  if (prev && ((!options.force && now < prev.nextRetry) || now - prev.at < 15_000))
    return { ...prev.result, cached: true, retryAt: prev.nextRetry };
  if (options.signal?.aborted) return failedBackfill('cancelled');
  options.onStart?.();
  let result: BackfillResult;
  try { result = await backfill(since, options.signal); } catch { result = failedBackfill('storage'); }
  if (result.reason === 'cancelled') return result;
  const failures = result.status === 'ok' || result.status === 'empty' ? 0 : Math.min((prev?.failures ?? 0) + 1, 100);
  const at = Date.now(), nextRetry = at + nextDelay(result, failures);
  const state: SyncState = { version: 2, at, nextRetry, failures, result };
  try {
    // Data was acknowledged before this stamp. Only a complete, non-empty run is success.
    await chrome.storage.local.set({ [SYNC_KEY]: state, ...(result.status === 'ok' ? { [OLD_SUCCESS_KEY]: at } : {}) });
  } catch { return { ...result, status: 'fail', reason: 'storage' }; }
  return { ...result, retryAt: nextRetry };
}

let inFlight: Promise<SyncOutcome> | null = null;
export function syncHistory(since: Date, options: SyncOptions = {}): Promise<SyncOutcome> {
  if (inFlight) return inFlight;
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  // Homepage cards share www.bilibili.com's lock across tabs. No extra extension permission.
  const job: Promise<SyncOutcome> = Promise.resolve().then(async () => {
    if (!locks) return run(since, options);
    return await locks.request('margin-footprint-history-v2', { ifAvailable: true }, async lock =>
      lock ? await run(since, options) : { status: 'busy' as const, pages: 0, days: 0, entries: 0 });
  });
  inFlight = job.catch(() => failedBackfill('storage')).finally(() => { inFlight = null; });
  return inFlight;
}

export function syncNote(r: BackfillResult | null, data: Activity): string {
  const start = new Date(); start.setDate(start.getDate() - 370);
  const today = dayKey(new Date()), floor = dayKey(start);
  const active = Object.entries(data).some(([k, v]) => k >= floor && k <= today && activeOf(v));
  if (!r) return '足迹在本机记录；有效活动满 1 分钟才点亮，也可同步 B 站观看历史';
  if (r.status === 'busy') return '另一个标签页正在补全历史；完成后自动更新';
  if (r.reason === 'storage') return '足迹读取或保存失败；已有记录未清除，扩展更新后请刷新 B 站页面再重试';
  if (r.reason === 'nologin' || r.status === 'nologin') return '登录 B 站后可补全过去的记录；本机计时不受影响，登录后可点击重试';
  if (r.status === 'partial') return r.reason === 'limit'
    ? `已读取 ${r.pages} 页，达到单次读取上限；更早记录尚未补全，已有足迹保留`
    : `历史补全中断，已保存 ${r.days} 个完整日期；已有足迹保留，将退避重试`;
  if (r.status === 'fail') return r.reason === 'timeout'
    ? '读取观看历史超时；显示本机记录，将自动重试，也可手动同步'
    : '观看历史读取失败；显示本机记录，将自动重试，也可手动同步';
  if (r.status === 'empty') return active
    ? 'B 站暂无可读取的历史；已有本机足迹保留'
    : '暂无可读取的历史；保持页面活跃或播放视频，累计满 1 分钟后点亮';
  return active
    ? '已补全观看历史；本机记录优先，历史每条最多估算 20 分钟'
    : '已读取历史，但当前可用时长不足 1 分钟；不会将未知时长虚算成活跃';
}
