/**
 * App 推荐流（v0.48 实验，用户：把手机的推流方式用在网页端首页）。
 * 首页「推荐」改走手机 App 的推荐接口 app.bilibili.com/x/v2/feed/index；用 B 站 App 扫一次码（TV 端授权）拿到 access_key 后，
 * 推荐和手机上是同一套个性化结果，不授权时是不带个性化的 App 推荐。
 * app.bilibili.com 没有跨域头，请求都在后台 service worker 里发（manifest host_permissions）。
 * 接口与签名参考 bilibili-API-collect（APP 签名、TV 扫码登录）和 BewlyBewly（MIT）的「授权 App」做法，原生重写。
 */
import { md5 } from '../content/api/md5';

export const APP_AUTH_KEY = 'margin:app-auth';

/** TV 端 appkey（bilibili-API-collect 公开的那组），扫码授权和推荐都用它 */
const APPKEY = '4409e2ce8ffd12b8';
const APPSEC = '59b43e04ad6965f34319062b478f83dd';

export interface AppAuth { key: string; mid: number; exp: number }

export type AppMessage =
  | { margin: 'app'; op: 'state' }
  | { margin: 'app'; op: 'feed'; idx: number }
  | { margin: 'app'; op: 'save'; key: string; mid: number; expiresIn: number }
  | { margin: 'app'; op: 'revoke' }
  | { margin: 'app'; op: 'remember'; enabled: boolean }
  | { margin: 'app'; op: 'dislike'; aid: number; mid: number; reason: 1 | 4; cancel?: boolean };

/** 后台回给页面的推荐卡片（已经去掉广告、直播、专栏、横幅，只留视频） */
export interface AppItem {
  aid: number; bvid: string; cid: number; title: string; cover: string;
  mid: number; author: string; views: string; danmaku: string; duration: number; idx: number; reason?: string;
}

export function appSign(params: Record<string, string | number>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, appkey: APPKEY, ts: Math.floor(Date.now() / 1000) })) p.set(k, String(v));
  p.sort();
  return `${p.toString()}&sign=${md5(p.toString() + APPSEC)}`;
}

/** 「55.8万」「1.2亿」「198」→ 数字，卡片的播放量格式化要用 */
export function parseCount(s: string): number {
  const m = /^([\d.]+)\s*(万|亿)?/.exec(String(s || '').trim());
  if (!m) return 0;
  return Math.round(parseFloat(m[1]) * (m[2] === '亿' ? 1e8 : m[2] === '万' ? 1e4 : 1));
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function toAppItem(it: any): AppItem | null {
  if (!it || it.goto !== 'av' || it.card_goto !== 'av' || !it.bvid) return null; // 广告是 ad_av / cm_v1，横幅、直播、番剧都不要
  const aid = Number(it.player_args?.aid ?? it.args?.aid ?? it.param) || 0;
  if (!aid) return null;
  return {
    aid,
    bvid: String(it.bvid),
    cid: Number(it.player_args?.cid) || 0,
    title: String(it.title || ''),
    cover: String(it.cover || '').replace(/^http:/, 'https:'),
    mid: Number(it.args?.up_id) || 0,
    author: String(it.args?.up_name || ''),
    views: String(it.cover_left_text_1 || ''),
    danmaku: String(it.cover_left_text_2 || ''),
    duration: Number(it.player_args?.duration) || 0,
    idx: Number(it.idx) || 0,
    reason: it.rcmd_reason ? String(typeof it.rcmd_reason === 'string' ? it.rcmd_reason : it.rcmd_reason.content || '') || undefined : undefined,
  };
}

export const APP = {
  feed: 'https://app.bilibili.com/x/v2/feed/index',
  dislike: 'https://app.bilibili.com/x/feed/dislike',
  undislike: 'https://app.bilibili.com/x/feed/dislike/cancel',
  qr: 'https://passport.bilibili.com/x/passport-tv-login/qrcode/auth_code',
  poll: 'https://passport.bilibili.com/x/passport-tv-login/qrcode/poll',
};
/** 和 BewlyBewly 一样伪装成 iPad 客户端，返回的卡片是双列视频流 */
export const FEED_BASE = { build: 74800100, device: 'pad', mobi_app: 'iphone', c_locate: 'CN', s_locale: 'zh-CN' };
