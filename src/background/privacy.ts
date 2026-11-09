import { loadSettings } from '../shared/settings';
import { cleanHistory, SEARCH_HISTORY_KEY, type HistoryMessage } from '../shared/privacy';
import { APP_AUTH_KEY } from '../shared/app-feed';

const PAGE_HOSTS = new Set(['www.bilibili.com', 'search.bilibili.com', 'space.bilibili.com', 't.bilibili.com', 'message.bilibili.com', 'live.bilibili.com']);

export function trustedSender(sender: chrome.runtime.MessageSender, extensionId: string): boolean {
  if (sender.id !== extensionId || !sender.url) return false;
  try {
    const url = new URL(sender.url);
    if (url.username || url.password) return false;
    if (url.protocol === 'chrome-extension:') return url.host === extensionId && url.pathname === '/popup.html';
    if (url.protocol === 'moz-extension:') return sender.url === chrome.runtime.getURL('popup.html');
    return url.protocol === 'https:' && !url.port && PAGE_HOSTS.has(url.hostname);
  } catch { return false; }
}

export async function protectAuthStorage(): Promise<void> {
  await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  // 升级后清理旧的持久 App 授权，后续授权仅存放在后台会话中。
  await chrome.storage.local.remove(APP_AUTH_KEY);
}

export async function handleHistory(message: HistoryMessage): Promise<{ ok: boolean; entries: ReturnType<typeof cleanHistory> }> {
  const settings = await loadSettings();
  if (!settings.searchHistory) {
    await chrome.storage.local.remove(SEARCH_HISTORY_KEY);
    return { ok: true, entries: [] };
  }
  let entries = cleanHistory((await chrome.storage.local.get(SEARCH_HISTORY_KEY))[SEARCH_HISTORY_KEY]);
  if (message.op === 'history-remember') {
    if (typeof message.query !== 'string' || !message.query.trim() || message.query.length > 200) return { ok: false, entries };
    const text = message.query.trim();
    entries = [{ text, at: Date.now() }, ...entries.filter(entry => entry.text !== text)].slice(0, 8);
  } else if (message.op === 'history-forget') {
    if (message.query !== undefined && typeof message.query !== 'string') return { ok: false, entries };
    entries = message.query === undefined ? [] : entries.filter(entry => entry.text !== message.query);
  } else if (message.op !== 'history-read') return { ok: false, entries: [] };
  // 关闭记录与写入并发时，避免在用户关闭后重新保存。
  if (!(await loadSettings()).searchHistory) entries = [];
  if (entries.length) await chrome.storage.local.set({ [SEARCH_HISTORY_KEY]: entries });
  else await chrome.storage.local.remove(SEARCH_HISTORY_KEY);
  return { ok: true, entries };
}
