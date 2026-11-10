import { getJSON, nav } from './http';

type Status = boolean | undefined;
const cache = new Map<number, { value: Status; at: number }>();
const waiting = new Map<number, { promise: Promise<Status>; resolve: (value: Status) => void }>();
const queue: number[] = [];
let timer = 0, active = 0, account = 0, revision = 0;

/** 关注变动后使当前页面的关系缓存失效；不持久化关注列表。 */
export function invalidateFollowStatus(mid?: number): void {
  revision++;
  if (mid) cache.delete(mid); else cache.clear();
}

function schedule(): void {
  if (timer || !queue.length || active >= 2) return;
  timer = window.setTimeout(() => { timer = 0; flush(); }, 0);
}

function flush(): void {
  while (queue.length && active < 2) {
    const mids = queue.splice(0, 40);
    active++;
    void (async () => {
      let values: Record<string, { attribute?: number }> = {};
      let valid = false, generation = revision;
      try {
        const info = await nav();
        if (info.isLogin && info.mid) {
          if (account !== info.mid) { account = info.mid; cache.clear(); revision++; }
          generation = revision;
          values = await getJSON('/x/relation/relations', { fids: mids.join(',') });
          valid = generation === revision;
        }
      } catch { /* 查询失败保留未知，不把异常当成未关注。 */ }
      for (const mid of mids) {
        const attribute = values?.[mid]?.attribute;
        const value = valid && typeof attribute === 'number' ? (attribute & 2) !== 0 : undefined;
        if (generation === revision) cache.set(mid, { value, at: Date.now() });
        if (cache.size > 1000) cache.delete(cache.keys().next().value!);
        waiting.get(mid)?.resolve(value);
        waiting.delete(mid);
      }
      active--;
      schedule();
    })();
  }
}

/** 同帧卡片按 UP 合并，最多两批并发，每批 40 人；成功缓存五分钟。 */
export function followStatus(mid: number): Promise<Status> {
  if (!Number.isSafeInteger(mid) || mid <= 0) return Promise.resolve(undefined);
  const known = cache.get(mid);
  if (known && Date.now() - known.at < (known.value === undefined ? 15_000 : 300_000)) return Promise.resolve(known.value);
  const pending = waiting.get(mid);
  if (pending) return pending.promise;
  let resolve!: (value: Status) => void;
  const promise = new Promise<Status>(done => { resolve = done; });
  waiting.set(mid, { promise, resolve });
  queue.push(mid);
  schedule();
  return promise;
}
