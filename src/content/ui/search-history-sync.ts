import { cleanHistory, SEARCH_HISTORY_KEY } from '../../shared/privacy';
import { loadSettings, onSettingsChange } from '../../shared/settings';
import { forgetSearch, rememberSearch, searchHistory, searchUrl } from '../api/search';
import { h } from './dom';

const CLOSE_PATH = 'M512 64.3C264.7 64.3 64.3 264.7 64.3 512S264.7 959.7 512 959.7 959.7 759.3 959.7 512 759.3 64.3 512 64.3zm198.5 601c12.5 12.5 12.5 32.7 0 45.2-6.2 6.2-14.4 9.4-22.6 9.4s-16.4-3.1-22.6-9.4L512 557.2 358.7 710.5c-6.2 6.2-14.4 9.4-22.6 9.4s-16.4-3.1-22.6-9.4c-12.5-12.5-12.5-32.7 0-45.2L466.8 512 313.5 358.7c-12.5-12.5-12.5-32.7 0-45.2s32.7-12.5 45.2 0L512 466.8l153.3-153.3c12.5-12.5 32.7-12.5 45.2 0s12.5 32.7 0 45.2L557.2 512l153.3 153.3z';
const SVG_NS = 'http://www.w3.org/2000/svg';

export interface SearchHistorySyncDeps {
  read: () => string[];
  remember: (query: string) => void;
  forget: (query?: string) => void;
  navigate: (url: string) => void;
  loadEnabled: () => Promise<boolean>;
  watchEnabled: (listener: (enabled: boolean) => void) => () => void;
  onChange: (listener: () => void) => () => void;
  readFallback: () => Promise<string[]>;
}

interface SearchBar {
  wrap: HTMLElement;
  input: HTMLInputElement | null;
  button: HTMLElement | null;
  pop: HTMLElement | null;
}

function defaultDeps(): SearchHistorySyncDeps {
  return {
    read: searchHistory,
    remember: rememberSearch,
    forget: forgetSearch,
    navigate: (url) => location.assign(url),
    loadEnabled: () => loadSettings().then((s) => s.searchHistory),
    watchEnabled: (listener) => {
      let active = true;
      onSettingsChange((next, prev) => {
        if (active && next.searchHistory !== prev.searchHistory) listener(next.searchHistory);
      });
      return () => { active = false; };
    },
    onChange: (listener) => {
      addEventListener('margin:search-history', listener);
      return () => removeEventListener('margin:search-history', listener);
    },
    readFallback: async () => {
      try {
        const stored = await chrome.storage.local.get(SEARCH_HISTORY_KEY);
        return cleanHistory(stored[SEARCH_HISTORY_KEY]).map((entry) => entry.text);
      } catch {
        return [];
      }
    },
  };
}

function closeSvg(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 1024 1024');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', CLOSE_PATH);
  svg.append(path);
  return svg;
}

function findBar(): SearchBar | null {
  const wraps = [...document.querySelectorAll<HTMLElement>('.search-input-wrap')];
  const wrap = wraps.find((el) => !el.closest('.bili-header, .nav-search-panel')) ?? null;
  if (!wrap) return null;
  const input = wrap.querySelector<HTMLInputElement>('.search-input-el, input');
  const button = wrap.querySelector<HTMLElement>('.search-button');
  const pop = wrap.querySelector<HTMLElement>('.search-panel-popover')
    ?? wrap.closest('.search-header')?.querySelector<HTMLElement>('.search-panel-popover')
    ?? null;
  return { wrap, input, button, pop };
}

function isActivateKey(e: KeyboardEvent): boolean {
  return e.key === 'Enter' || e.key === ' ';
}

/** 保持搜索页搜索框与动态页/全站命令面板、首页搜索共用同一份 MARGIN 最近搜索 */
export function mountSearchHistorySync(custom?: Partial<SearchHistorySyncDeps>): () => void {
  const deps: SearchHistorySyncDeps = { ...defaultDeps(), ...custom };
  let stopped = false;
  let enabled = false;
  let fallback: string[] | null = null;
  let syncedFromStore = false;
  let syncingDom = false;
  let submittingHistory = false;
  let lastKey = '\0__uninitialized__';

  let boundWrap: HTMLElement | null = null;
  let boundPop: HTMLElement | null = null;
  let wrapAc: AbortController | null = null;
  let popAc: AbortController | null = null;
  let popObserver: MutationObserver | null = null;

  const listEl = h('div', { class: 'histories' });
  let clearBtn!: HTMLElement;
  const box = h('div', { class: 'history margin-search-history', hidden: true },
    h('div', { class: 'header' },
      h('div', { class: 'title' }, '搜索历史'),
      clearBtn = h('div', { class: 'clear', role: 'button', tabindex: '0' }, '清空'),
    ),
    h('div', { class: 'histories-wrap' }, listEl),
  );

  // 阻止按下抢走输入框焦点，避免点删除或清空时弹窗闪退
  box.addEventListener('mousedown', (e) => { e.preventDefault(); });
  clearBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); clearAll(); });
  clearBtn.addEventListener('keydown', (e) => {
    if (!isActivateKey(e)) return;
    e.preventDefault(); e.stopPropagation(); clearAll();
  });

  function currentItems(): string[] {
    const items = deps.read();
    if (items.length || syncedFromStore || !fallback) return items;
    return fallback;
  }

  function applyEnabled(next: boolean): void {
    enabled = next;
    if (next) document.documentElement.dataset.marginSearchHistory = 'on';
    else document.documentElement.removeAttribute('data-margin-search-history');
    sync();
  }

  function record(query: string): void {
    if (!enabled) return;
    const q = query.trim();
    if (!q) return;
    if (!syncedFromStore && fallback) fallback = [q, ...fallback.filter((item) => item !== q)].slice(0, 8);
    deps.remember(q);
    sync();
  }

  function removeOne(query: string): void {
    syncedFromStore = true;
    fallback = null;
    deps.forget(query);
    sync();
  }

  function clearAll(): void {
    syncedFromStore = true;
    fallback = null;
    deps.forget();
    sync();
  }

  function submitHistory(query: string): void {
    const q = query.trim();
    if (!q) return;
    record(q);
    const bar = findBar();
    const input = bar?.input;
    const button = bar?.button;
    if (input && button) {
      submittingHistory = true;
      try {
        input.value = q;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.blur();
        button.click();
      } finally {
        submittingHistory = false;
      }
      sync();
      return;
    }
    deps.navigate(searchUrl(q));
  }

  function updateItems(items: string[]): void {
    const key = items.join('\0');
    if (key === lastKey) return;
    lastKey = key;
    const nodes = items.map((item) => {
      const closeBtn = h('div', {
        class: 'close',
        role: 'button',
        tabindex: '0',
        'aria-label': `删除搜索历史：${item}`,
      }, closeSvg());
      const row = h('div', { class: 'history-item', tabindex: '0' },
        h('div', { class: 'history-text', title: item }, item),
        closeBtn,
      );
      closeBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); removeOne(item); });
      closeBtn.addEventListener('keydown', (e) => {
        if (!isActivateKey(e)) return;
        e.preventDefault(); e.stopPropagation(); removeOne(item);
      });
      row.addEventListener('click', (e) => {
        if (e.target instanceof Element && e.target.closest('.close')) return;
        e.preventDefault(); e.stopPropagation();
        submitHistory(item);
      });
      row.addEventListener('keydown', (e) => {
        if (e.target instanceof Element && e.target.closest('.close')) return;
        if (!isActivateKey(e)) return;
        e.preventDefault(); e.stopPropagation();
        submitHistory(item);
      });
      return row;
    });
    listEl.replaceChildren(...nodes);
  }

  function handlePopoverClick(e: MouseEvent): void {
    if (!enabled) return;
    const target = e.target instanceof Element ? e.target : null;
    if (!target || target.closest('.margin-search-history')) return;
    const suggest = target.closest('.suggest-item');
    if (suggest) {
      if (suggest.textContent?.trim()) record(suggest.textContent.trim());
      return;
    }
    const trending = target.closest('.trending-item');
    if (trending) {
      const text = trending.querySelector('.trending-text')?.textContent ?? trending.textContent;
      if (text?.trim()) record(text.trim());
      return;
    }
    const nativeHistory = target.closest('.history-item');
    if (nativeHistory && !target.closest('.close')) {
      const text = nativeHistory.querySelector('.history-text')?.textContent ?? nativeHistory.textContent;
      if (text?.trim()) record(text.trim());
    }
  }

  function bindBar(bar: SearchBar | null): void {
    const nextWrap = bar?.wrap ?? null;
    const nextPop = bar?.pop ?? null;

    if (nextWrap !== boundWrap) {
      wrapAc?.abort();
      wrapAc = null;
      boundWrap = nextWrap;
      if (nextWrap) {
        wrapAc = new AbortController();
        const signal = wrapAc.signal;
        nextWrap.addEventListener('focusin', () => sync(), { signal });
        nextWrap.addEventListener('input', () => sync(), { signal });
        nextWrap.addEventListener('click', (e) => {
          const target = e.target instanceof Element ? e.target : null;
          if (!target) return;
          if (target.closest('.clear-icon')) { queueMicrotask(() => sync()); return; }
          if (!enabled) return;
          if (target.closest('.search-button')) {
            const q = findBar()?.input?.value.trim();
            if (!submittingHistory && q) record(q);
          }
        }, { capture: true, signal });
        nextWrap.addEventListener('keydown', (e) => {
          if (!enabled || e.isComposing || e.key !== 'Enter') return;
          const target = e.target instanceof Element ? e.target : null;
          if (target?.closest('.margin-search-history')) return;
          const active = findBar();
          const suggest = target?.closest('.suggest-item') ?? active?.pop?.querySelector('.suggest-item.is-focus');
          const trending = target?.closest('.trending-item');
          const text = suggest?.textContent
            ?? trending?.querySelector('.trending-text')?.textContent
            ?? trending?.textContent
            ?? active?.input?.value;
          if (text?.trim()) record(text.trim());
        }, { capture: true, signal });
        const form = nextWrap.matches('form') ? nextWrap : nextWrap.closest('form');
        form?.addEventListener('submit', () => {
          if (!enabled || submittingHistory) return;
          const q = findBar()?.input?.value.trim();
          if (q) record(q);
        }, { capture: true, signal });
      }
    }

    if (nextPop !== boundPop) {
      popAc?.abort();
      popAc = null;
      popObserver?.disconnect();
      popObserver = null;
      boundPop = nextPop;
      if (nextPop) {
        popAc = new AbortController();
        nextPop.addEventListener('click', handlePopoverClick, { capture: true, signal: popAc.signal });
        popObserver = new MutationObserver((mutations) => {
          if (syncingDom) return;
          if (mutations.every((m) => m.target === box || box.contains(m.target))) return;
          sync();
        });
        popObserver.observe(nextPop, { childList: true, attributes: true, attributeFilter: ['style', 'hidden'] });
      }
    }
  }

  function sync(): void {
    if (stopped) return;
    const bar = findBar();
    bindBar(bar);
    const pop = bar?.pop;
    if (!pop) return;

    const items = enabled ? currentItems() : [];
    const hasQuery = !!bar.input?.value.trim();
    const hasSuggestions = !!pop.querySelector('.suggestions');
    const show = enabled && items.length > 0 && !hasQuery && !hasSuggestions;

    syncingDom = true;
    try {
      if (!enabled) {
        box.hidden = true;
        if (box.isConnected) box.remove();
        return;
      }
      if (show) {
        if (pop.firstElementChild !== box) pop.prepend(box);
        updateItems(items);
      }
      box.hidden = !show;
    } finally {
      syncingDom = false;
    }
  }

  deps.read();
  const stopStore = deps.onChange(() => {
    syncedFromStore = true;
    fallback = null;
    sync();
  });
  const stopSettings = deps.watchEnabled((next) => applyEnabled(next));

  const domObserver = new MutationObserver(() => {
    if (stopped || syncingDom) return;
    if (!boundWrap?.isConnected || !boundPop?.isConnected || (boundPop && enabled && box.parentElement !== boundPop && !box.hidden)) {
      sync();
    }
  });
  domObserver.observe(document.documentElement, { childList: true, subtree: true });

  Promise.all([deps.loadEnabled(), deps.readFallback()])
    .then(([on, initial]) => {
      if (stopped) return;
      if (!syncedFromStore && initial.length) fallback = initial;
      applyEnabled(on);
    })
    .catch(() => {});

  sync();

  return () => {
    stopped = true;
    stopStore();
    stopSettings();
    domObserver.disconnect();
    popObserver?.disconnect();
    wrapAc?.abort();
    popAc?.abort();
    box.remove();
    document.documentElement.removeAttribute('data-margin-search-history');
  };
}
