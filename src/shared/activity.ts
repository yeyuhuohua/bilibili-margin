/**
 * B 站足迹的数据格式与合并规则（内容脚本与后台 service worker 共用）。
 * 存储键 margin:activity，格式 { 'YYYY-MM-DD': DayRecord }，与 v0.30 及更早版本兼容。
 */
export interface DayRecord {
  /** 本地记录的停留秒数（页面可见且有操作或在播放） */
  s: number;
  /** 本地记录的首次打开 HH:MM */
  f?: string;
  /** 观看历史估算的秒数 */
  h?: number;
  /** 观看历史里最早的观看时间 HH:MM */
  hf?: string;
}
export type Activity = Record<string, DayRecord>;

export const ACTIVITY_KEY = 'margin:activity';
/** 已计入的 15 秒时间片（按本地日期分组），用来让多个标签页的心跳取并集，不重复累计 */
export const SLOTS_KEY = 'margin:activity-slots';
export const SLOT = 15_000;

const pad = (n: number) => String(n).padStart(2, '0');
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** 内容脚本 → service worker 的足迹消息 */
export type FpMessage =
  | { margin: 'fp'; op: 'read' }
  | { margin: 'fp'; op: 'open'; at: number }
  | { margin: 'fp'; op: 'beat'; from: number; to: number }
  | { margin: 'fp'; op: 'merge'; days: Record<string, { h: number; hf?: string }> }
  | { margin: 'fp'; op: 'import'; days: Activity };

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
/** 校验导入的足迹：只留格式正确的日期和字段；整体不是对象时返回 null */
export function sanitizeActivity(raw: unknown): Activity | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Activity = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!DAY.test(k) || !v || typeof v !== 'object') continue;
    const d = v as Record<string, unknown>;
    const sec = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.min(Math.round(x), 86400) : undefined);
    const rec: DayRecord = { s: sec(d.s) ?? 0 };
    const h = sec(d.h); if (h !== undefined) rec.h = h;
    if (typeof d.f === 'string' && HM.test(d.f)) rec.f = d.f;
    if (typeof d.hf === 'string' && HM.test(d.hf)) rec.hf = d.hf;
    if (rec.s || rec.h || rec.f || rec.hf) out[k] = rec;
  }
  return out;
}

/** 合并两份足迹：同一天时长取较大值、首次打开取较早值 */
export function mergeActivity(into: Activity, add: Activity): Activity {
  const early = (a?: string, b?: string) => (a && b ? (a < b ? a : b) : a || b);
  for (const [k, r] of Object.entries(add)) {
    const d = (into[k] ??= { s: 0 });
    d.s = Math.max(d.s || 0, r.s || 0);
    if (r.h != null) d.h = Math.max(d.h || 0, r.h);
    const f = early(d.f, r.f); if (f) d.f = f;
    const hf = early(d.hf, r.hf); if (hf) d.hf = hf;
  }
  return into;
}

/**
 * 把一段「活跃」时间 [from, to]（毫秒时间戳）记进 activity：
 * 以 15 秒为一片，片的中点落在区间内就算这片活跃；已经记过的片（别的标签页报过）不重复累计。
 * 返回新增秒数。
 */
export function applyBeat(data: Activity, slots: Record<string, number[]>, from: number, to: number): number {
  let added = 0;
  const sets = new Map<string, Set<number>>();
  for (let i = Math.ceil((from - SLOT / 2) / SLOT); i * SLOT + SLOT / 2 <= to; i++) {
    const k = dayKey(new Date(i * SLOT + SLOT / 2));
    let set = sets.get(k);
    if (!set) { set = new Set(slots[k] ?? []); sets.set(k, set); }
    if (set.has(i)) continue;
    set.add(i);
    (data[k] ??= { s: 0 }).s = (data[k].s || 0) + SLOT / 1000;
    added += SLOT / 1000;
  }
  for (const [k, set] of sets) slots[k] = [...set];
  // 只留最近两天的时间片
  const keep = Object.keys(slots).sort().slice(-2);
  for (const k of Object.keys(slots)) if (!keep.includes(k)) delete slots[k];
  return added;
}
