import { getWbi } from './http';
export { searchHistory, rememberSearch, forgetSearch } from './search-history';
/** 搜索联想、热搜、稍后再看——都是 B 站网页端自己在用的接口（只允许 www.bilibili.com 跨域） */
export interface Suggest { term: string; html: string }
export interface Hot { keyword: string; name: string }

export async function suggest(term: string, signal?: AbortSignal): Promise<Suggest[]> {
  const r = await fetch(`https://s.search.bilibili.com/main/suggest?term=${encodeURIComponent(term)}&main_ver=v1`, { credentials: 'include', signal });
  const b = await r.json();
  const tags = (b?.result?.tag ?? []) as { value: string; name: string }[];
  return tags.slice(0, 8).map((t) => ({ term: t.value, html: t.name }));
}

/* 热搜（v0.40.0）：改用 B 站顶栏同款的 wbi 签名接口 /x/web-interface/wbi/search/square（带 platform=web，登录后与原生顶栏一致），
 * 失败再退回旧的未签名接口；缓存 5 分钟，长时间开着的首页再次打开搜索时会刷新，不再一直显示打开页面时的那一批 */
let hotCache: Promise<Hot[]> | null = null;
let hotAt = 0;
const HOT_TTL = 5 * 60_000;
type TrendResp = { trending?: { list?: { keyword: string; show_name: string }[] } };
const toHot = (b: TrendResp | undefined) => (b?.trending?.list ?? []).map((x) => ({ keyword: x.keyword, name: x.show_name || x.keyword }));
export function hotSearch(): Promise<Hot[]> {
  if (hotCache && Date.now() - hotAt < HOT_TTL) return hotCache;
  hotAt = Date.now();
  hotCache = getWbi<TrendResp>('/x/web-interface/wbi/search/square', { limit: 10, platform: 'web' })
    .then(toHot)
    .then((l) => (l.length ? l : Promise.reject(new Error('empty'))))
    .catch(() => fetch('https://api.bilibili.com/x/web-interface/search/square?limit=10', { credentials: 'include' })
      .then((r) => r.json()).then((b) => toHot(b?.data)))
    .catch(() => { hotCache = null; return []; });
  return hotCache;
}

const csrf = () => document.cookie.match(/(?:^|;\s*)bili_jct=([^;]+)/)?.[1] ?? '';

/** 加入稍后再看；未登录返回 false */
export async function addWatchLater(bvid: string): Promise<{ ok: boolean; msg: string }> {
  const token = csrf();
  if (!token) return { ok: false, msg: '登录 B 站后才能用稍后再看' };
  const r = await fetch('https://api.bilibili.com/x/v2/history/toview/add', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ bvid, csrf: token }),
  });
  const b = await r.json().catch(() => ({ code: -1 }));
  return b.code === 0 ? { ok: true, msg: '已加入稍后再看' } : { ok: false, msg: b.message || '没加上，稍后再试' };
}

export const searchUrl = (q: string) => `https://search.bilibili.com/all?keyword=${encodeURIComponent(q)}`;

export interface LaterItem { aid: number; bvid: string; title: string; cover: string; duration: number; progress: number; author: string; mid: number; addAt: number }
/** 稍后再看列表；未登录返回 null */
export async function watchLater(): Promise<LaterItem[] | null> {
  const r = await fetch('https://api.bilibili.com/x/v2/history/toview', { credentials: 'include' });
  const b = await r.json();
  if (b.code === -101) return null;
  if (b.code !== 0) throw new Error(b.message || `code ${b.code}`);
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  return ((b.data?.list ?? []) as any[]).map((v) => ({
    aid: v.aid, bvid: v.bvid, title: v.title, cover: (v.pic ?? '').replace(/^http:/, 'https:'), duration: v.duration ?? 0,
    progress: v.progress ?? 0, author: v.owner?.name ?? '', mid: v.owner?.mid ?? 0, addAt: v.add_at ?? 0,
  }));
}
export async function removeWatchLater(aid: number): Promise<boolean> {
  const token = csrf();
  if (!token) return false;
  const r = await fetch('https://api.bilibili.com/x/v2/history/toview/del', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ aid: String(aid), csrf: token }),
  });
  const b = await r.json().catch(() => ({ code: -1 }));
  return b.code === 0;
}
