/* eslint-disable @typescript-eslint/no-explicit-any */
import { getJSON, postForm } from './http';

export type HistKind = 'all' | 'archive' | 'live' | 'article';
export interface HistItem {
  kid: string; kind: string; title: string; cover: string; author: string; mid: number; face: string;
  url: string; viewAt: number; progress: number; duration: number; badge: string; device: string; live: boolean;
}
export interface Cursor { max: number; view_at: number; business: string }

const https = (u: unknown) => String(u ?? '').replace(/^\/\//, 'https://').replace(/^http:/, 'https:');

function toItem(x: any): HistItem {
  const h = x.history ?? {};
  const biz: string = h.business ?? '';
  const id = biz === 'archive' ? h.oid : biz === 'pgc' ? h.epid || h.oid : h.oid;
  let url = x.uri || '';
  if (!url && biz === 'archive') url = `https://www.bilibili.com/video/${h.bvid}`;
  if (biz === 'archive' && h.bvid) {
    let target = new URL(`https://www.bilibili.com/video/${h.bvid}`);
    try {
      const supplied = new URL(https(url));
      if (supplied.hostname === 'www.bilibili.com' &&
          [ `/video/${h.bvid}`, `/video/av${h.oid}` ].includes(supplied.pathname.replace(/\/$/, ''))) target = supplied;
    } catch { /* 缺少有效 uri 时使用历史记录中的视频 ID。 */ }
    const page = Number(h.page);
    if (Number.isInteger(page) && page > 0) target.searchParams.set('p', String(page));
    url = target.href;
  }
  if (!url && biz === 'live') url = `https://live.bilibili.com/${h.oid}`;
  if (!url && biz === 'article') url = `https://www.bilibili.com/read/cv${h.oid}`;
  if (!url && biz === 'pgc') url = `https://www.bilibili.com/bangumi/play/ep${h.epid}`;
  const dev = h.dt === 1 || h.dt === 3 || h.dt === 5 || h.dt === 7 ? '手机' : h.dt === 4 || h.dt === 6 ? '平板' : h.dt === 33 ? '电视' : '电脑';
  return {
    kid: `${biz}_${id}`, kind: biz, title: x.title || x.show_title || '', cover: https(x.cover || x.covers?.[0]),
    author: x.author_name ?? '', mid: x.author_mid ?? 0, face: https(x.author_face),
    url: https(url), viewAt: x.view_at ?? 0, progress: x.progress ?? 0, duration: x.duration ?? 0,
    badge: x.badge ?? '', device: dev, live: biz === 'live' && x.live_status === 1,
  };
}

export async function historyList(kind: HistKind, c: Cursor | null): Promise<{ list: HistItem[]; cursor: Cursor | null }> {
  const d = await getJSON<any>('/x/web-interface/history/cursor', { type: kind, ps: 30, max: c?.max ?? 0, view_at: c?.view_at ?? 0, business: c?.business ?? '' });
  const list = (d.list ?? []).map(toItem);
  const cur = d.cursor;
  return { list, cursor: list.length && cur && (cur.max || cur.view_at) ? { max: cur.max, view_at: cur.view_at, business: cur.business ?? '' } : null };
}

export async function historySearch(keyword: string, page: number): Promise<{ list: HistItem[]; more: boolean }> {
  const d = await getJSON<any>('/x/web-interface/history/search', { pn: page, keyword, business: 'all' });
  const list = (d.list ?? []).map(toItem);
  return { list, more: !!d.has_more };
}

export const deleteHistory = (kid: string) => postForm<unknown>('/x/v2/history/delete', { kid });
export const clearHistory = () => postForm<unknown>('/x/v2/history/clear', {});
/** 是否在记录历史：shadow=true 表示「暂停记录」 */
export const historyPaused = () => getJSON<boolean>('/x/v2/history/shadow');
export const setHistoryPaused = (paused: boolean) => postForm<unknown>('/x/v2/history/shadow/set', { switch: String(paused) });
