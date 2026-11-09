import { getJSON, getWbi } from './http';

const cache = new Map<string, Promise<string | null>>();

/** 低清 MP4 直链，用于封面悬停预览 */
export function previewUrl(bvid: string, cid: number): Promise<string | null> {
  const key = `${bvid}:${cid}`;
  if (!cache.has(key)) {
    cache.set(key, getWbi<{ durl?: { url: string }[] }>('/x/player/wbi/playurl', {
      bvid, cid, qn: 16, fnval: 1, fnver: 0, fourk: 0, platform: 'html5', high_quality: 1,
    }).then((d) => d.durl?.[0]?.url?.replace(/^http:/, 'https:') ?? null).catch(() => null).then(url => {
      if (!url) cache.delete(key);
      return url;
    }));
  }
  return cache.get(key)!;
}

const cids = new Map<string, Promise<number>>();
/** 空间页、动态页的视频没有 cid（#2），悬停预览前按 BV 号补一个（取第 1P） */
export function cidOf(bvid: string): Promise<number> {
  if (!cids.has(bvid)) cids.set(bvid, getJSON<{ cid: number }[]>('/x/player/pagelist', { bvid }).then((l) => l?.[0]?.cid ?? 0).catch(() => 0).then(cid => {
    if (!cid) cids.delete(bvid);
    return cid;
  }));
  return cids.get(bvid)!;
}

export function invalidatePreview(bvid: string, cid: number): void { cache.delete(`${bvid}:${cid}`); }
