/** App 推荐流（v0.48 实验）：页面这一侧只发消息给后台，后台去请求 app.bilibili.com */
import { APP, appSign, parseCount, type AppItem, type AppMessage } from '../../shared/app-feed';
import type { Video } from './feed';

const ask = <T>(m: AppMessage): Promise<T> => chrome.runtime.sendMessage(m) as Promise<T>;

export interface AppState { authed: boolean; mid: number; exp: number; remember: boolean }
export const appState = () => ask<AppState & { ok: boolean }>({ margin: 'app', op: 'state' });
export const appRevoke = () => ask<{ ok: boolean }>({ margin: 'app', op: 'revoke' });
export const appRemember = (enabled: boolean) => ask<{ ok: boolean; error?: string }>({ margin: 'app', op: 'remember', enabled });
/* 扫码授权的两个 passport 接口在页面里发（B 站给 www.bilibili.com 开了跨域；从后台发会被风控 412），拿到的凭证交给后台保存 */
async function passport(url: string, params: Record<string, string | number>): Promise<{ code: number; message?: string; data?: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  // Firefox 内容脚本的 fetch 按扩展身份发，content.fetch 才是页面身份（带 www.bilibili.com 的 Origin）
  const pageFetch: typeof fetch = (globalThis as unknown as { content?: { fetch: typeof fetch } }).content?.fetch ?? fetch;
  const r = await pageFetch(url, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: appSign({ local_id: 0, ...params }) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
export async function appQr(): Promise<{ ok: boolean; url?: string; code?: string; error?: string }> {
  const d = await passport(APP.qr, {});
  return d.code === 0 ? { ok: true, url: String(d.data.url), code: String(d.data.auth_code) } : { ok: false, error: d.message || `code ${d.code}` };
}
export async function appPoll(code: string): Promise<{ ok: boolean; state?: 'wait' | 'scanned' | 'expired' | 'done' | 'error'; error?: string; mid?: number }> {
  const d = await passport(APP.poll, { auth_code: code.replace(/[^0-9a-f]/gi, '') });
  // 86039 还没扫，86090 已扫码等确认，86038 二维码过期
  if (d.code !== 0) return { ok: true, state: d.code === 86038 ? 'expired' : d.code === 86090 ? 'scanned' : d.code === 86039 ? 'wait' : 'error', error: d.message };
  const saved = await ask<{ ok: boolean; error?: string }>({ margin: 'app', op: 'save', key: String(d.data.access_token), mid: Number(d.data.mid) || 0, expiresIn: Number(d.data.expires_in) || 0 });
  if (!saved?.ok) return { ok: false, state: 'error', error: saved?.error || '授权保存失败，请重新扫码' };
  return { ok: true, state: 'done', mid: Number(d.data.mid) || 0 };
}

const toVideo = (a: AppItem): Video => ({
  bvid: a.bvid, cid: a.cid, title: a.title, cover: a.cover, duration: a.duration,
  author: a.author, mid: a.mid, face: '', views: parseCount(a.views), danmaku: parseCount(a.danmaku), pubdate: 0,
  reason: a.reason, aid: a.aid, goto: 'app', trackId: 'app',
});

/** 取一批 App 推荐；idx 是上一批最后一张卡的 idx（第一批传 0） */
export async function appRecommended(idx: number): Promise<{ list: Video[]; next: number; personal: boolean }> {
  const r = await ask<{ ok: boolean; items?: AppItem[]; next?: number; personal?: boolean; error?: string }>({ margin: 'app', op: 'feed', idx });
  if (!r?.ok) throw new Error(r?.error || '推荐加载失败');
  return { list: (r.items ?? []).map(toVideo), next: r.next || idx, personal: !!r.personal };
}

/** App 卡片的「不感兴趣」走 App 自己的反馈接口；没授权就只在本地隐藏 */
export async function appDislike(v: Video, reason: 1 | 4, cancel = false): Promise<void> {
  if (!v.aid) return;
  const r = await ask<{ ok: boolean; error?: string }>({ margin: 'app', op: 'dislike', aid: v.aid, mid: v.mid, reason, cancel });
  if (!r?.ok) throw new Error(r?.error === '未授权' ? '还没扫码授权 App 推荐' : r?.error || '反馈失败');
}
