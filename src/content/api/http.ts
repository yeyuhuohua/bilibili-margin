import { md5 } from './md5';
import { setGuard } from '../native-guard';

const API = 'https://api.bilibili.com';

interface Resp<T> { code: number; message?: string; data: T }

async function readResponse<T>(response: Response): Promise<Resp<T>> {
  if (response.status === 412) setGuard(false);
  if (!response.ok) throw new Error(`B 站接口请求失败（HTTP ${response.status}），请稍后重试`);
  let body: Resp<T>;
  try { body = await response.json(); }
  catch (error) {
    if (error instanceof SyntaxError) throw new Error('B 站接口返回了非 JSON 页面，请稍后重试');
    throw error;
  }
  if (!body || typeof body.code !== 'number') throw new Error('B 站接口返回的数据格式异常，请稍后重试');
  if (body.code === -352) setGuard(false);
  return body;
}

export async function getJSON<T>(path: string, params: Record<string, string | number> = {}, signal?: AbortSignal): Promise<T> {
  const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const url = `${API}${path}${q.size ? `?${q}` : ''}`;
  const res = await fetch(url, { credentials: 'include', signal });
  const body = await readResponse<T>(res);
  if (body.code !== 0) throw new Error(body.message || `code ${body.code}`);
  return body.data;
}

// ---- WBI signing ----
const MIXIN = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52];
let mixinKey: Promise<string> | null = null;

export interface NavInfo {
  isLogin: boolean;
  uname?: string;
  face?: string;
  mid?: number;
  wbi_img: { img_url: string; sub_url: string };
}

let navCache: Promise<NavInfo> | null = null;
export function nav(): Promise<NavInfo> {
  // /nav answers code -101 when logged out but still carries wbi_img, so read it raw.
  navCache ??= fetch(`${API}/x/web-interface/nav`, { credentials: 'include' })
    .then((r) => readResponse<NavInfo>(r))
    .then((b) => {
      if (!b.data) throw new Error(b.message || 'B 站登录信息暂时不可用，请重试');
      return b.data;
    })
    .catch((error) => { navCache = null; throw error; });
  return navCache;
}

function getMixinKey(): Promise<string> {
  mixinKey ??= nav().then(({ wbi_img }) => {
    if (!wbi_img?.img_url || !wbi_img?.sub_url) throw new Error('B 站签名信息暂时不可用，请重试');
    const name = (u: string) => u.slice(u.lastIndexOf('/') + 1).split('.')[0];
    const raw = name(wbi_img.img_url) + name(wbi_img.sub_url);
    return MIXIN.map((i) => raw[i]).join('').slice(0, 32);
  }).catch((error) => { mixinKey = null; navCache = null; throw error; });
  return mixinKey;
}

export async function getWbi<T>(path: string, params: Record<string, string | number>, signal?: AbortSignal): Promise<T> {
  const key = await getMixinKey();
  signal?.throwIfAborted();
  const all: Record<string, string> = { ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), wts: String(Math.round(Date.now() / 1000)) };
  const query = Object.keys(all).sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(all[k].replace(/[!'()*]/g, ''))}`)
    .join('&');
  const res = await fetch(`${API}${path}?${query}&w_rid=${md5(query + key)}`, { credentials: 'include', signal });
  const body = await readResponse<T>(res);
  if (body.code !== 0) throw new Error(body.message || `code ${body.code}`);
  return body.data;
}

const csrfToken = () => document.cookie.match(/(?:^|;\s*)bili_jct=([^;]+)/)?.[1] ?? '';
/** 带 bili_jct CSRF 的表单 POST */
export async function postForm<T>(path: string, form: Record<string, string | number>): Promise<T> {
  const body = new URLSearchParams(Object.entries({ ...form, csrf: csrfToken() }).map(([k, v]) => [k, String(v)]));
  const r = await fetch(`${API}${path}`, { method: 'POST', credentials: 'include', body });
  const j = await r.json();
  if (j.code !== 0) throw new Error(j.message || `code ${j.code}`);
  return j.data as T;
}

/** JSON 体 POST，csrf 走查询串（动态点赞 / 转发这类新接口） */
export async function postJSON<T>(path: string, body: unknown, query: Record<string, string> = {}): Promise<T> {
  const q = new URLSearchParams({ ...query, csrf: csrfToken() });
  const r = await fetch(`${API}${path}?${q}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (j.code !== 0) throw new Error(j.message || `code ${j.code}`);
  return j.data as T;
}
