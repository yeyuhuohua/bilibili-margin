import { cleanHistory, SEARCH_HISTORY_KEY, type HistoryMessage, type SearchEntry } from '../../shared/privacy';

const LEGACY_HISTORY_KEY = 'margin:search-history';
let entries: SearchEntry[] = [];
let started = false;
let revision = 0;
let enabled = false;
const notify = () => dispatchEvent(new Event('margin:search-history'));

function ask(message: HistoryMessage, legacyRaw?: string): void {
  const current = ++revision;
  chrome.runtime.sendMessage(message).then(response => {
    if (response?.ok && response.legacyHandled && legacyRaw !== undefined) {
      try {
        if (localStorage.getItem(LEGACY_HISTORY_KEY) === legacyRaw) localStorage.removeItem(LEGACY_HISTORY_KEY);
      } catch { /* 网页存储可能不可用，已迁移的扩展记录仍可使用 */ }
    }
    if (current !== revision || !response?.ok) return;
    entries = cleanHistory(response.entries);
    notify();
  }).catch(() => { if (current === revision) { entries = []; notify(); } });
}

function readHistory(): void {
  if (enabled) {
    try {
      const raw = localStorage.getItem(LEGACY_HISTORY_KEY);
      if (raw && raw.length <= 16_384) {
        const legacy: unknown = JSON.parse(raw);
        if (Array.isArray(legacy)) {
          ask({ margin: 'privacy', op: 'history-read', legacy: legacy.slice(0, 8) }, raw);
          return;
        }
      }
    } catch { /* 旧记录不可读时继续读取扩展内记录 */ }
  }
  ask({ margin: 'privacy', op: 'history-read' });
}

function start(): void {
  if (started) return;
  started = true;
  chrome.storage.local.get('margin:settings').then(data => {
    enabled = (data['margin:settings'] as { searchHistory?: boolean } | undefined)?.searchHistory === true;
    readHistory();
  }).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes['margin:settings']) {
      enabled = (changes['margin:settings'].newValue as { searchHistory?: boolean } | undefined)?.searchHistory === true;
      if (!enabled) entries = [];
      readHistory();
    }
    if (changes[SEARCH_HISTORY_KEY]) entries = enabled ? cleanHistory(changes[SEARCH_HISTORY_KEY].newValue) : [];
    if (changes[SEARCH_HISTORY_KEY] || changes['margin:settings']) notify();
  });
}

export function searchHistory(): string[] { start(); return enabled ? cleanHistory(entries).map(entry => entry.text) : []; }
export function rememberSearch(query: string): void {
  start();
  if (enabled && query.trim() && query.length <= 200) entries = cleanHistory([{ text: query.trim(), at: Date.now() }, ...entries.filter(entry => entry.text !== query.trim())]);
  ask({ margin: 'privacy', op: 'history-remember', query });
}
export function forgetSearch(query?: string): void {
  start();
  entries = query === undefined ? [] : entries.filter(entry => entry.text !== query);
  ask({ margin: 'privacy', op: 'history-forget', query });
  notify();
}
