import {
  ACTIVITY_KEY, SLOTS_KEY, applyBeat, dayKey, hhmm, mergeActivity,
  sanitizeActivity, type Activity, type FpMessage,
} from '../shared/activity';

const LEGACY_KEY = 'margin-activity-v1';
const MIGRATED_KEY = 'margin:activity-migrated-v2';

/** Must run inside sw.ts's serial queue, including reads and legacy migration. */
export async function handleFootprint(m: FpMessage): Promise<unknown> {
  const v = await chrome.storage.local.get([ACTIVITY_KEY, SLOTS_KEY, LEGACY_KEY, MIGRATED_KEY]);
  const current = sanitizeActivity(v[ACTIVITY_KEY]);
  if (v[ACTIVITY_KEY] !== undefined && !current) throw new Error('本机足迹数据格式异常，请先导出备份');
  const data: Activity = current ?? {};
  const legacy = sanitizeActivity(v[LEGACY_KEY]);
  if (legacy && v[MIGRATED_KEY] !== true) {
    // A heartbeat may already have created today's record. Merge, never replace it.
    mergeActivity(data, legacy);
    await chrome.storage.local.set({ [ACTIVITY_KEY]: data, [MIGRATED_KEY]: true });
    // Keep the old key as a recovery source. The marker prevents repeated merges.
  }
  if (m.op === 'read') return { ok: true, data };
  const now = Date.now();
  if (m.op === 'open') {
    const at = Number(m.at);
    if (!Number.isFinite(at) || at <= 0) return { ok: false };
    const d = new Date(Math.min(at, now));
    const day = (data[dayKey(d)] ??= { s: 0 });
    if (day.f) return { ok: true };
    day.f = hhmm(d);
    await chrome.storage.local.set({ [ACTIVITY_KEY]: data });
    return { ok: true };
  }
  if (m.op === 'beat') {
    if (!Number.isFinite(m.from) || !Number.isFinite(m.to)) return { ok: false };
    const to = Math.min(m.to, now + 5_000);
    const from = Math.max(m.from, to - 70_000);
    if (!(to > from) || from <= 0) return { ok: false };
    const raw = v[SLOTS_KEY];
    const slots: Record<string, number[]> = {};
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [k, list] of Object.entries(raw)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(k) && Array.isArray(list))
          slots[k] = list.filter((n): n is number => typeof n === 'number' && Number.isSafeInteger(n));
      }
    }
    const added = applyBeat(data, slots, from, to);
    if (added) await chrome.storage.local.set({ [ACTIVITY_KEY]: data, [SLOTS_KEY]: slots });
    return { ok: true, added };
  }
  if (m.op === 'merge') {
    if (!m.days || typeof m.days !== 'object' || Array.isArray(m.days)) return { ok: false };
    const add: Activity = {};
    for (const [k, x] of Object.entries(m.days)) {
      if (!x || typeof x !== 'object' || !Number.isFinite(x.h) || x.h < 0) continue;
      add[k] = { s: 0, h: x.h, ...(typeof x.hf === 'string' ? { hf: x.hf } : {}) };
    }
    // Keep previously collected estimates when a later API response is shorter.
    mergeActivity(data, sanitizeActivity(add) ?? {});
    await chrome.storage.local.set({ [ACTIVITY_KEY]: data });
    return { ok: true };
  }
  if (m.op === 'import') {
    const add = sanitizeActivity(m.days);
    if (!add) return { ok: false };
    mergeActivity(data, add);
    await chrome.storage.local.set({ [ACTIVITY_KEY]: data });
    return { ok: true, days: Object.keys(add).length };
  }
  return { ok: false };
}
