import { loadSettings, type Settings } from './settings';

export const SEARCH_HISTORY_KEY = 'margin:private-search-history';
export const SEARCH_HISTORY_TTL = 30 * 86400_000;
export interface SearchEntry { text: string; at: number }

export function cleanHistory(raw: unknown, now = Date.now()): SearchEntry[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.filter((entry): entry is SearchEntry => {
    if (!entry || typeof entry.text !== 'string' || !entry.text.trim() || entry.text.length > 200 || !Number.isFinite(entry.at)) return false;
    if (entry.at > now || now - entry.at >= SEARCH_HISTORY_TTL || seen.has(entry.text)) return false;
    seen.add(entry.text);
    return true;
  }).slice(0, 8);
}

export type HistoryMessage = { margin: 'privacy'; op: 'history-read' | 'history-remember' | 'history-forget'; query?: string };
export class PrivacyBlocked extends Error {
  constructor() { super('可选外部服务已关闭'); this.name = 'PrivacyBlocked'; }
}

const SERVICES = {
  ip: ['ipwho.is', '/'],
  city: ['geocoding-api.open-meteo.com', '/v1/search'],
  weather: ['api.open-meteo.com', '/v1/forecast'],
  sponsor: ['bsbsb.top', '/api/skipSegments/'],
  update: ['api.github.com', '/repos/jiuyang5354/bilibili-margin/releases/latest'],
} as const;
type Service = keyof typeof SERVICES;
const pending = new Set<AbortController>();
let watching = false;

/** 只控制映间自己的可选辅助请求；B 站播放器与网页请求不经过这里。 */
export async function optionalFetch(service: Service, address: string, init: RequestInit = {}): Promise<Response> {
  const url = new URL(address);
  const [host, path] = SERVICES[service];
  const validPath = service === 'sponsor' ? /^\/api\/skipSegments\/[a-f0-9]{4}$/.test(url.pathname) : url.pathname === path;
  if (url.protocol !== 'https:' || url.hostname !== host || url.port || url.username || url.password || !validPath || url.hash) throw new Error('外部请求地址不受支持');
  // Firefox content-script Xrays may expose keys() without a usable Symbol.iterator.
  let badQuery = false;
  url.searchParams.forEach((_value, key) => { if (/token|cookie|auth|csrf|access_key|uid/i.test(key)) badQuery = true; });
  if ((init.method && init.method !== 'GET') || init.body || badQuery) throw new Error('外部请求包含不允许的参数');
  const headers = new Headers(init.headers);
  let badHeader = false;
  headers.forEach((_value, key) => { if (!['accept', 'x-ext-version'].includes(key)) badHeader = true; });
  if (badHeader) throw new Error('外部请求头不受支持');
  const settings = await loadSettings();
  if (!settings.enabled || !settings.privacyExternal) throw new PrivacyBlocked();
  if (!watching) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes['margin:settings']) return;
      const next = changes['margin:settings'].newValue as Partial<Settings> | undefined;
      if (next?.enabled === false || next?.privacyExternal !== true) for (const controller of pending) controller.abort();
    });
    watching = true;
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  init.signal?.addEventListener('abort', abort, { once: true });
  if (init.signal?.aborted) controller.abort();
  const timer = setTimeout(abort, 8000);
  pending.add(controller);
  try {
    return await fetch(url.href, { ...init, headers, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', signal: controller.signal });
  } finally {
    clearTimeout(timer);
    pending.delete(controller);
    init.signal?.removeEventListener('abort', abort);
  }
}
