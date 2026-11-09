import { cleanHistory, SEARCH_HISTORY_KEY, type HistoryMessage, type SearchEntry } from '../../shared/privacy';

let entries: SearchEntry[] = [];
let started = false;
let revision = 0;
let enabled = false;
const notify = () => dispatchEvent(new Event('margin:search-history'));

function ask(message: HistoryMessage): void {
  const current = ++revision;
  chrome.runtime.sendMessage(message).then(response => {
    if (current !== revision || !response?.ok) return;
    entries = cleanHistory(response.entries);
    notify();
  }).catch(() => { if (current === revision) { entries = []; notify(); } });
}

function start(): void {
  if (started) return;
  started = true;
  chrome.storage.local.get('margin:settings').then(data => {
    enabled = (data['margin:settings'] as { searchHistory?: boolean } | undefined)?.searchHistory === true;
    ask({ margin: 'privacy', op: 'history-read' });
  }).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes['margin:settings']) {
      enabled = (changes['margin:settings'].newValue as { searchHistory?: boolean } | undefined)?.searchHistory === true;
      if (!enabled) entries = [];
      ask({ margin: 'privacy', op: 'history-read' });
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
