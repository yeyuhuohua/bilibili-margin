import { getJSON, nav } from './http';
import type { Video } from './feed';

export interface Folder { id: number; title: string; count: number; cover: string; mid: number; kind?: 'collected' | 'season'; /** 默认收藏夹不能删除 */ isDefault: boolean; isPrivate: boolean }

/** 其他人的空间只列公开收藏夹；登录者自己的空间也保留私密夹。 */
export async function publicFolders(mid: number, page: number): Promise<{ list: Folder[]; more: boolean }> {
  const data = await getJSON<{ list?: { id: number; title: string; media_count: number; cover?: string; attr: number }[]; count?: number; has_more?: boolean } | null>(
    '/x/v3/fav/folder/created/list', { up_mid: mid, pn: page, ps: 20 });
  const own = data?.list?.some(f => f.attr & 1) ? await nav().then(n => n.isLogin && n.mid === mid, () => false) : false;
  return {
    list: (data?.list || []).filter(f => Number.isInteger(f.attr) && ((f.attr & 1) === 0 || own)).map(f => ({
      id: f.id, title: f.title, count: f.media_count, cover: https(f.cover), mid, isDefault: (f.attr & 2) === 0, isPrivate: (f.attr & 1) === 1,
    })),
    more: data?.has_more ?? page * 20 < (data?.count || 0),
  };
}

export async function publicFolder(mid: number, id: number): Promise<Folder> {
  const data = await getJSON<{ id: number; mid: number; title: string; media_count: number; cover?: string; attr: number } | null>('/x/v3/fav/folder/info', { media_id: id });
  if (!data || data.mid !== mid || !Number.isInteger(data.attr)) throw new Error('收藏夹不可用或不属于当前空间');
  if (data.attr & 1) {
    const own = await nav().then(n => n.isLogin && n.mid === mid, () => false);
    if (!own) throw new Error('收藏夹未公开');
  }
  return { id: data.id, mid, title: data.title, count: data.media_count, cover: https(data.cover), isDefault: (data.attr & 2) === 0, isPrivate: (data.attr & 1) === 1 };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function folders(refreshLogin = false): Promise<Folder[] | null> {
  const n = await nav(refreshLogin);
  if (!n?.isLogin || !n.mid) return null;
  const data = await getJSON<{ list: any[] | null }>('/x/v3/fav/folder/created/list', { up_mid: n.mid, pn: 1, ps: 50 });
  return (data.list ?? []).map((f) => ({ id: f.id, title: f.title, count: f.media_count, cover: String(f.cover || '').replace(/^http:/, 'https:'), mid: n.mid!, isDefault: (f.attr & 2) === 0, isPrivate: (f.attr & 1) === 1 }));
}

export async function collectedFolders(page = 1, refreshLogin = false): Promise<{ list: Folder[]; more: boolean } | null> {
  const n = await nav(refreshLogin);
  if (!n?.isLogin || !n.mid) return null;
  const data = await getJSON<{ list: any[] | null; has_more: boolean }>('/x/v3/fav/folder/collected/list', { up_mid: n.mid, pn: page, ps: 50, platform: 'web' });
  return { list: (data.list ?? []).filter((f) => f.type === 11 || f.type === 21).map((f) => ({
    id: f.id, title: f.title, count: f.media_count, cover: https(f.cover), mid: n.mid!,
    kind: f.type === 21 ? 'season' : 'collected', isDefault: false, isPrivate: false,
  })), more: !!data.has_more };
}

export const folderUrl = (f: Folder) => `https://space.bilibili.com/${f.mid}/favlist?fid=${f.id}${f.kind ? `&ftype=collect&ctype=${f.kind === 'season' ? 21 : 11}` : ''}`;
const https = (url: unknown) => String(url || '').replace(/^http:/, 'https:').replace(/^\/\//, 'https://');
const mediaVideo = (m: any, upper = m.upper): Video => ({
  bvid: m.bvid, aid: Number(m.id) || undefined, cid: m.ugc?.first_cid ?? 0, title: m.title,
  cover: https(m.cover), duration: m.duration ?? 0,
  author: upper?.name ?? '', mid: upper?.mid ?? 0, face: upper?.face ?? '',
  views: m.cnt_info?.play ?? 0, danmaku: m.cnt_info?.danmaku ?? 0, pubdate: m.fav_time ?? m.pubtime ?? 0,
});

/** 原站的订阅合集接口一次返回完整 medias，由收藏抽屉缓存并分批展示。 */
export async function seasonVideos(id: number): Promise<Video[]> {
  const data = await getJSON<{ medias: any[] | null; info?: { upper?: any } }>('/x/space/fav/season/list', { season_id: id });
  return (data.medias ?? []).filter((m) => m.bvid && (m.attr == null || m.attr === 0)).map((m) => mediaVideo(m, m.upper ?? data.info?.upper));
}

export async function folderVideos(id: number, page: number): Promise<{ list: Video[]; more: boolean }> {
  const data = await getJSON<{ medias: any[] | null; has_more: boolean }>('/x/v3/fav/resource/list', { media_id: id, pn: page, ps: 20, platform: 'web' });
  const list = (data.medias ?? [])
    .filter((m) => m.type === 2 && m.bvid && m.attr === 0)
    .map((m) => mediaVideo(m));
  return { list, more: !!data.has_more };
}

const csrf = () => document.cookie.match(/(?:^|;\s*)bili_jct=([^;]+)/)?.[1] ?? '';
async function post<T>(path: string, form: Record<string, string | number>): Promise<T> {
  const body = new URLSearchParams(Object.entries({ ...form, csrf: csrf() }).map(([k, v]) => [k, String(v)]));
  const r = await fetch(`https://api.bilibili.com${path}`, { method: 'POST', credentials: 'include', body });
  const j = await r.json();
  if (j.code !== 0) throw new Error(j.message || `code ${j.code}`);
  return j.data as T;
}

/** 新建收藏夹（B 站限制标题 20 字、简介 200 字） */
export async function createFolder(title: string, isPrivate: boolean, intro = ''): Promise<Folder> {
  const n = await nav();
  const d = await post<any>('/x/v3/fav/folder/add', { title, intro, privacy: isPrivate ? 1 : 0, cover: '' });
  return { id: d.id, title: d.title ?? title, count: 0, cover: '', mid: n.mid ?? 0, isDefault: false, isPrivate };
}

/** 删除收藏夹（连同里面的收藏记录，B 站不可恢复） */
export const deleteFolder = (id: number) => post<unknown>('/x/v3/fav/folder/del', { media_ids: id });

/** Remove one resource from this owned folder, without deleting the video or other favorites. */
export async function removeFolderVideo(folder: number, aid: number): Promise<void> {
  if (!Number.isSafeInteger(aid) || aid <= 0) throw new Error('视频标识缺失，请刷新收藏夹后重试');
  await post('/x/v3/fav/resource/batch-del', { media_id: folder, resources: `${aid}:2` });
}

/** 复用原站移动／复制接口；由服务器校验收藏夹归属。 */
export async function transferFolderVideo(action: 'move' | 'copy', source: Folder, target: Folder, aid: number): Promise<void> {
  if (!Number.isSafeInteger(aid) || aid <= 0) throw new Error('视频标识缺失，请刷新收藏夹后重试');
  const n = await nav();
  if (!n.isLogin || !n.mid || source.kind || target.kind || source.mid !== n.mid || target.mid !== n.mid || source.id === target.id) throw new Error('请选择自己的其他收藏夹');
  await post(`/x/v3/fav/resource/${action}`, { src_media_id: source.id, tar_media_id: target.id, mid: n.mid, resources: `${aid}:2`, platform: 'web' });
}

export const folderPlayUrl = (f: Folder) => `https://www.bilibili.com/list/ml${f.id}?sid=${f.id}`;
