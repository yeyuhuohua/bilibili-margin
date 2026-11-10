/** Local activity and conservative Bilibili history estimates. */
import { dayKey, hhmm, sanitizeActivity, type Activity, type DayRecord, type FpMessage } from '../../shared/activity';
export { dayKey, type Activity, type DayRecord };

const ITEM_CAP = 20 * 60;
const MAX_PAGES = 60;
const REQUEST_TIMEOUT = 12_000;
export const ACTIVE_MIN = 60;

export type BackfillReason = 'network' | 'timeout' | 'http' | 'api' | 'malformed' | 'cursor' | 'limit' | 'storage' | 'cancelled' | 'nologin';
export interface BackfillResult {
  status: 'ok' | 'empty' | 'partial' | 'nologin' | 'fail' | 'busy';
  pages: number;
  days: number;
  entries: number;
  reason?: BackfillReason;
}
export const failedBackfill = (reason: BackfillReason): BackfillResult => ({ status: 'fail', reason, pages: 0, days: 0, entries: 0 });

/** Reject both transport errors and an explicit { ok: false } from the worker. */
async function send(m: FpMessage): Promise<{ ok: true; data?: unknown }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const reply = await Promise.race([
      chrome.runtime.sendMessage(m),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('足迹后台响应超时')), 8_000); }),
    ]);
    if (!reply || reply.ok !== true) throw new Error('足迹后台未确认保存，请刷新页面后重试');
    return reply;
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

export async function loadActivity(): Promise<Activity> {
  // Read through the same worker queue as heartbeats. This also migrates legacy data.
  const reply = await send({ margin: 'fp', op: 'read' });
  const data = sanitizeActivity(reply.data);
  if (!data) throw new Error('足迹数据格式无效');
  return data;
}

interface HistoryItem {
  view_at: number; duration?: number; progress?: number;
  history?: { business?: string; oid?: number | string; bvid?: string; epid?: number | string; cid?: number | string; page?: number };
}
interface Cursor { max?: number; view_at?: number; business?: string }
interface HistoryPage { code: number; data?: { list?: HistoryItem[]; cursor?: Cursor } }
class HistoryError extends Error { constructor(readonly reason: BackfillReason) { super(reason); } }

export function itemSeconds(it: HistoryItem): number {
  const finite = (x: unknown) => Number.isFinite(Number(x)) ? Number(x) : 0;
  const dur = Math.max(0, finite(it.duration));
  const prog = finite(it.progress);
  let s = prog === -1 ? dur : Math.max(0, prog);
  if (dur > 0) s = Math.min(s, dur);
  return Math.min(s, ITEM_CAP);
}

async function requestPage(query: URLSearchParams, signal?: AbortSignal): Promise<HistoryPage> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (signal?.aborted) throw new HistoryError('cancelled');
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, REQUEST_TIMEOUT);
  try {
    const r = await fetch(`https://api.bilibili.com/x/web-interface/history/cursor?${query}`, {
      credentials: 'include', signal: controller.signal,
    });
    if (!r.ok) throw new HistoryError('http');
    let j: HistoryPage;
    try { j = await r.json(); } catch { throw new HistoryError('malformed'); }
    if (!j || typeof j.code !== 'number') throw new HistoryError('malformed');
    if (j.code === -101) throw new HistoryError('nologin');
    if (j.code !== 0) throw new HistoryError('api');
    if (!Array.isArray(j.data?.list)) throw new HistoryError('malformed');
    return j;
  } catch (e) {
    if (signal?.aborted) throw new HistoryError('cancelled');
    if (timedOut) throw new HistoryError('timeout');
    throw e instanceof HistoryError ? e : new HistoryError('network');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

/** Bounded pagination. Incomplete days are not written; failed writes are never success. */
async function collectHistory(since: Date, signal?: AbortSignal): Promise<BackfillResult> {
  const floor = Math.floor(+since / 1000);
  if (!Number.isFinite(floor)) return failedBackfill('malformed');
  const sums: Record<string, number> = {}, firsts: Record<string, string> = {};
  const seenCursors = new Set<string>(['0|0|']);
  const seenItems = new Set<string>();
  let max = 0, viewAt = 0, business = '', oldest = Infinity;
  let reached = false, pages = 0, entries = 0, malformed = false;
  let reason: BackfillReason | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    if (signal?.aborted) return { ...failedBackfill('cancelled'), pages, entries };
    try {
      if (page) await new Promise<void>((r) => setTimeout(r, 250));
      const j = await requestPage(new URLSearchParams({ ps: '30', max: String(max), view_at: String(viewAt), business }), signal);
      pages++;
      const list = j.data!.list!;
      for (const it of list) {
        if (!it || !Number.isFinite(it.view_at) || it.view_at <= 0 || it.view_at > Date.now() / 1000 + 300) {
          malformed = true; continue;
        }
        oldest = Math.min(oldest, it.view_at);
        if (it.view_at < floor) { reached = true; continue; }
        const hist = it.history;
        const id = hist?.bvid || hist?.oid || hist?.epid;
        if (id) {
          const key = `${hist?.business ?? ''}|${id}|${hist?.cid ?? hist?.page ?? ''}|${it.view_at}`;
          if (seenItems.has(key)) continue;
          seenItems.add(key);
        }
        entries++;
        const d = new Date(it.view_at * 1000), k = dayKey(d), t = hhmm(d);
        sums[k] = Math.min(86400, (sums[k] || 0) + itemSeconds(it));
        if (!firsts[k] || t < firsts[k]) firsts[k] = t;
      }
      if (reached || !list.length) { reached = true; break; }
      const c = j.data!.cursor;
      const nextMax = c?.max ?? 0, nextView = c?.view_at ?? 0;
      if (!c || !Number.isFinite(nextMax) || !Number.isFinite(nextView) || nextMax < 0 || nextView < 0 || (c.business !== undefined && typeof c.business !== 'string')) {
        reason = 'cursor'; break;
      }
      if (!nextMax && !nextView) { reached = true; break; }
      const nextBusiness = c.business ?? '';
      const key = `${nextMax}|${nextView}|${nextBusiness}`;
      if (seenCursors.has(key)) { reason = 'cursor'; break; }
      seenCursors.add(key);
      max = nextMax; viewAt = nextView; business = nextBusiness;
    } catch (e) { reason = e instanceof HistoryError ? e.reason : 'network'; break; }
  }
  if (signal?.aborted || reason === 'cancelled') return { ...failedBackfill('cancelled'), pages, entries };
  if (!reached && !reason) reason = 'limit';
  if (malformed && !reason) reason = 'malformed';
  // If interrupted, the oldest day may straddle the next page. Never save half a day.
  if (!reached && oldest !== Infinity) delete sums[dayKey(new Date(oldest * 1000))];
  const days: Record<string, { h: number; hf?: string }> = {};
  for (const k of Object.keys(sums)) days[k] = { h: Math.round(sums[k]), hf: firsts[k] };
  const count = Object.keys(days).length;
  try {
    if (count) await send({ margin: 'fp', op: 'merge', days });
    else if (!reason) await loadActivity(); // Verify the worker is alive even for an empty history.
  } catch { return { status: 'fail', reason: 'storage', pages, entries, days: 0 }; }
  if (reason) return { status: pages ? 'partial' : reason === 'nologin' ? 'nologin' : 'fail', reason, pages, entries, days: count };
  return { status: entries ? 'ok' : 'empty', pages, entries, days: count };
}

let inFlight: Promise<BackfillResult> | null = null;
export function backfill(since: Date, signal?: AbortSignal): Promise<BackfillResult> {
  if (!inFlight) inFlight = collectHistory(since, signal).finally(() => { inFlight = null; });
  return inFlight;
}

/** 这一天有没有本机记录（够 60 秒才算） */
export const isLocal = (d?: DayRecord) => (d?.s || 0) >= ACTIVE_MIN;
/** 显示用的时长：有本机记录用本机，没有才用观看历史估算 */
export const secondsOf = (d?: DayRecord) => (isLocal(d) ? d!.s : Math.max(d?.s || 0, d?.h || 0));
/** 时长来源 */
export const sourceOf = (d?: DayRecord): 'local' | 'history' | null => (isLocal(d) ? 'local' : (d?.h || 0) > 0 ? 'history' : (d?.s || 0) > 0 ? 'local' : d?.hf ? 'history' : d?.f ? 'local' : null);
/** 算进「打开过」和连续天数：累计满 60 秒 */
export const activeOf = (d?: DayRecord) => secondsOf(d) >= ACTIVE_MIN;
export const firstOf = (d?: DayRecord) => {
  if (isLocal(d)) return d!.f || d!.hf;
  const a = d?.f, b = d?.hf;
  return a && b ? (a < b ? a : b) : a || b;
};

/**
 * 热力图分档阈值（秒）：用近一年活跃日时长的四分位数，跟着自己的习惯走；
 * 活跃日不到 14 天时用固定的 15 / 45 / 90 分钟。
 */
export function levelThresholds(values: number[]): [number, number, number] {
  const v = values.filter((x) => x >= ACTIVE_MIN).sort((a, b) => a - b);
  if (v.length < 14) return [900, 2700, 5400];
  const q = (p: number) => { const i = (v.length - 1) * p, lo = Math.floor(i); return v[lo] + (v[Math.ceil(i)] - v[lo]) * (i - lo); };
  const t: [number, number, number] = [q(0.25), q(0.5), q(0.75)];
  // 分布太集中时拉开一点，避免几档阈值重合
  if (t[1] <= t[0]) t[1] = t[0] + 1;
  if (t[2] <= t[1]) t[2] = t[1] + 1;
  return t;
}
export const levelOf = (s: number, t: [number, number, number]) => (s < ACTIVE_MIN ? 0 : s <= t[0] ? 1 : s <= t[1] ? 2 : s <= t[2] ? 3 : 4);
