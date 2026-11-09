import { getJSON, getWbi } from './http';
import { unread } from './msg';

/** 顶栏用到的账号信息：等级、硬币、B 币、大会员 */
export interface Account {
  mid: number; name: string; face: string; level: number; exp: number; next: number;
  coins: number; bcoin: number; vip: boolean; vipLabel: string; vipColor: string;
}
export interface AccountStat { following: number; follower: number; dynamic: number }

export async function account(): Promise<Account | null> {
  const r = await fetch('https://api.bilibili.com/x/web-interface/nav', { credentials: 'include' }).then((x) => x.json()).catch(() => null);
  const d = r?.data;
  if (!d?.isLogin) return null;
  const lv = d.level_info ?? {};
  return {
    mid: d.mid, name: d.uname ?? '', face: String(d.face ?? '').replace(/^http:/, 'https:'),
    level: lv.current_level ?? 0, exp: lv.current_exp ?? 0, next: typeof lv.next_exp === 'number' ? lv.next_exp : 0,
    coins: d.money ?? 0, bcoin: d.wallet?.bcoin_balance ?? 0,
    vip: d.vipStatus === 1, vipLabel: d.vip_label?.text || (d.vipStatus === 1 ? '大会员' : ''), vipColor: d.vip?.nickname_color || '',
  };
}

export const accountStat = () => getJSON<{ following: number; follower: number; dynamic_count: number }>('/x/web-interface/nav/stat')
  .then((d) => ({ following: d.following ?? 0, follower: d.follower ?? 0, dynamic: d.dynamic_count ?? 0 } as AccountStat));

/** 消息未读总数：回复 + @ + 赞 + 系统通知 + 私信（和 B 站顶栏的红点同口径） */
export async function unreadTotal(): Promise<number> {
  const u = await unread();
  return u.reply + u.at + u.like + u.system + u.chat;
}

/**
 * 动态更新数：B 站用「基线」记住你上次看到的动态，之后问服务器基线之后有几条新的。
 * 基线存在本地；打开动态页时清掉，下次重新取。
 */
const BASE_KEY = 'margin:dyn-baseline';
export async function dynamicUpdates(): Promise<number> {
  let base = localStorage.getItem(BASE_KEY);
  if (!base) {
    const d = await getWbi<{ update_baseline?: string }>('/x/polymer/web-dynamic/v1/feed/all', { type: 'all', page: 1, timezone_offset: -480 });
    if (!d.update_baseline) return 0;
    localStorage.setItem(BASE_KEY, d.update_baseline);
    return 0;
  }
  const d = await getJSON<{ update_num?: number }>('/x/polymer/web-dynamic/v1/feed/all/update', { type: 'all', update_baseline: base });
  return d.update_num ?? 0;
}
export const resetDynamicBaseline = () => localStorage.removeItem(BASE_KEY);

export const csrf = () => document.cookie.match(/(?:^|;\s*)bili_jct=([^;]+)/)?.[1] ?? '';

/** 退出登录：和 B 站顶栏同一个接口 */
export async function logout(): Promise<boolean> {
  const body = new URLSearchParams({ biliCSRF: csrf(), gourl: location.href });
  const r = await fetch('https://passport.bilibili.com/login/exit/v2', { method: 'POST', credentials: 'include', body }).then((x) => x.json()).catch(() => null);
  if (r?.code === 0) await chrome.runtime.sendMessage({ margin: 'app', op: 'revoke' }).catch(() => {});
  return r?.code === 0;
}
