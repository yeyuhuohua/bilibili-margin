/**
 * 映间后台 service worker：只做一件事——足迹计时。
 * 各标签页在活跃时发心跳（一段时间区间），这里串行地读-改-写 chrome.storage.local，
 * 多标签页同时打开也不会互相覆盖或重复累计（v0.30 及更早是各页面自己读改写，会丢数据）。
 */
import { APP, APP_AUTH_KEY, FEED_BASE, appSign, toAppItem, type AppAuth, type AppItem, type AppMessage } from '../shared/app-feed';
import type { FpMessage } from '../shared/activity';
import { getSponsorSegments } from './sponsor';
import { handleFootprint } from './footprint';
import type { SponsorMessage } from '../shared/sponsor';
import { handleHistory, protectAuthStorage, trustedSender } from './privacy';
import { SEARCH_HISTORY_KEY, type HistoryMessage } from '../shared/privacy';

let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>): Promise<T> => { const p = queue.then(fn, fn); queue = p.catch(() => {}); return p; };
const authReady = protectAuthStorage();
void authReady.catch(() => {});
chrome.storage.onChanged.addListener((changes, area) => {
  const next = changes['margin:settings']?.newValue as { searchHistory?: boolean } | undefined;
  if (area === 'local' && changes['margin:settings'] && next?.searchHistory !== true) {
    void serial(() => chrome.storage.local.remove(SEARCH_HISTORY_KEY));
  }
});

async function handle(m: FpMessage): Promise<unknown> {
  return handleFootprint(m);
}

/* ---------- App 推荐流（v0.48 实验） ---------- */
async function auth(): Promise<AppAuth | null> {
  await authReady;
  const a = (await chrome.storage.session.get(APP_AUTH_KEY))[APP_AUTH_KEY] as AppAuth | undefined;
  if (!a?.key) return null;
  if (!Number.isFinite(a.exp) || a.exp * 1000 <= Date.now()) { await chrome.storage.session.remove(APP_AUTH_KEY); return null; }
  return a;
}
async function getJ(url: string): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function handleApp(m: AppMessage): Promise<unknown> {
  await authReady;
  if (m.op === 'state') { const a = await auth(); return { ok: true, authed: !!a, mid: a?.mid ?? 0, exp: a?.exp ?? 0 }; }
  if (m.op === 'revoke') { await chrome.storage.session.remove(APP_AUTH_KEY); return { ok: true }; }
  if (m.op === 'save') {
    const key = m.key;
    if (typeof key !== 'string' || !/^[0-9a-zA-Z_-]{16,128}$/.test(key) || !Number.isSafeInteger(m.mid) || m.mid <= 0 || !Number.isFinite(m.expiresIn) || m.expiresIn <= 0 || m.expiresIn > 366 * 86400) return { ok: false, error: '授权数据无效' };
    const a: AppAuth = { key, mid: m.mid, exp: Math.floor(Date.now() / 1000) + Math.floor(m.expiresIn) };
    await chrome.storage.session.set({ [APP_AUTH_KEY]: a });
    return { ok: true };
  }
  if (m.op === 'feed') {
    if (!Number.isSafeInteger(m.idx) || m.idx < 0) return { ok: false, error: '推荐参数无效' };
    const a = await auth();
    const q: Record<string, string | number> = { ...FEED_BASE, idx: Math.max(0, Math.floor(Number(m.idx) || 0)), pull: m.idx ? 0 : 1, flush: 0, column: 4, fnval: 272 };
    if (a) q.access_key = a.key;
    const d = await getJ(`${APP.feed}?${appSign(q)}`);
    if (d.code === -101 || d.code === 62011) { await chrome.storage.session.remove(APP_AUTH_KEY); return { ok: false, error: '授权已失效，请在设置里重新扫码', expired: true }; }
    if (d.code !== 0) return { ok: false, error: d.message || `code ${d.code}` };
    const raw = (d.data?.items ?? []) as unknown[];
    const items = raw.map(toAppItem).filter((x): x is AppItem => !!x);
    const last = raw.length ? Number((raw[raw.length - 1] as { idx?: number }).idx) || 0 : 0;
    return { ok: true, items, next: last, personal: !!a };
  }
  if (m.op === 'dislike') {
    if (!Number.isSafeInteger(m.aid) || m.aid <= 0 || !Number.isSafeInteger(m.mid) || m.mid < 0 || ![1, 4].includes(m.reason) || (m.cancel !== undefined && typeof m.cancel !== 'boolean')) return { ok: false, error: '反馈参数无效' };
    const a = await auth();
    if (!a) return { ok: false, error: '未授权' };
    const d = await getJ(`${m.cancel ? APP.undislike : APP.dislike}?${appSign({ ...FEED_BASE, access_key: a.key, goto: 'av', id: m.aid, mid: m.mid, reason_id: m.reason })}`);
    return { ok: d.code === 0, error: d.message };
  }
  return { ok: false };
}

chrome.runtime.onMessage.addListener((m: FpMessage | AppMessage | SponsorMessage | HistoryMessage, sender, reply) => {
  if (!m || !['app', 'fp', 'sponsor', 'privacy'].includes(m.margin)) return;
  if (!trustedSender(sender, chrome.runtime.id)) { reply({ ok: false, error: '消息来源无效' }); return; }
  if (m.margin === 'privacy') { serial(() => handleHistory(m)).then(reply, () => reply({ ok: false, entries: [] })); return true; }
  if (m && m.margin === 'sponsor') { getSponsorSegments(m.bvid).then((segments) => reply({ ok: true, segments }), () => reply({ ok: false })); return true; }
  if (m && m.margin === 'app') { handleApp(m).then(reply, () => reply({ ok: false, error: '推荐请求失败，请稍后重试' })); return true; }
  if (!m || m.margin !== 'fp') return;
  serial(() => handle(m)).then(reply, (e) => reply({ ok: false, error: String(e) }));
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  // v0.30 及更早的页面级节流戳，已不再使用
  chrome.storage.local.remove('margin:activity-tick').catch(() => {});
});
