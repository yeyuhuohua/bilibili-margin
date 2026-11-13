import { exactFirst, type Candidate } from '../search-exact-core';
import { onSettingsChange } from '../../shared/settings';

const KEY = 'margin:search-exact-first';
const SOURCE = '.search-page-video > .video-list';
interface Item extends Candidate { cover: string; duration: string; author: string; authorUrl: string; stats: string }
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '') => {
  const el = document.createElement(tag); el.textContent = text; return el;
};

/** Search-only trial: leave framework-owned nodes intact; no API calls or query storage. */
export async function mountSearchExact(): Promise<void> {
  if (!document.body) await new Promise<void>(resolve => document.addEventListener('DOMContentLoaded', () => resolve(), { once: true }));
  if (document.getElementById('margin-search-exact-style')) return;
  const stored: Record<string, unknown> = await chrome.storage.local.get(KEY).catch(() => ({}));
  const style = element('style'); style.id = 'margin-search-exact-style';
  style.textContent = `
    [data-margin-search-source]{display:none!important}
    #margin-search-exact{display:flex;align-items:center;gap:12px;flex-wrap:wrap;box-sizing:border-box;margin:0 0 20px;padding:10px 14px;min-height:44px;border:1px solid var(--m-line,#ddd);border-radius:12px;background:var(--m-search-surface,var(--m-surface,#fff));font:14px/1.6 var(--m-sans,system-ui);color:var(--m-ink,#18191c)}
    #margin-search-exact label{display:flex;align-items:center;gap:6px;cursor:pointer}
    #margin-search-exact input{accent-color:var(--m-accent,#00aeec);width:16px;height:16px}
    #margin-search-exact button{font:inherit;color:inherit;background:var(--m-chip,#eee);border:1px solid var(--m-line,#ddd);border-radius:999px;padding:4px 10px;cursor:pointer}
    #margin-search-exact [hidden],#margin-search-exact-results[hidden]{display:none!important}
    #margin-search-exact-status{font-size:13px;color:var(--m-muted,#5f6167)}
    #margin-search-exact-results{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:32px 24px;padding:0;margin:0 0 32px;list-style:none;font:14px/1.6 var(--m-sans,system-ui);color:var(--m-ink,#18191c)}
    #margin-search-exact-results .mx-cover{position:relative;display:block;aspect-ratio:16/9;overflow:hidden;border-radius:12px;background:var(--m-chip,#eee)}
    #margin-search-exact-results img{width:100%;height:100%;object-fit:cover;display:block}
    #margin-search-exact-results .mx-duration{position:absolute;right:8px;bottom:6px;background:#000b;color:#fff;border-radius:4px;padding:0 4px;font-size:12px}
    #margin-search-exact-results .mx-title{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-top:8px;min-height:44px;color:inherit;text-decoration:none}
    #margin-search-exact-results .mx-title:hover{color:var(--m-accent,#00aeec)}
    #margin-search-exact-results .mx-meta{display:flex;gap:8px;color:var(--m-faint,#666);font-size:12px;margin-top:4px}
    #margin-search-exact-results .mx-author{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:inherit;text-decoration:none}
    @media(max-width:1100px){#margin-search-exact-results{grid-template-columns:repeat(3,minmax(0,1fr))}}
    @media(max-width:650px){#margin-search-exact-results{grid-template-columns:repeat(2,minmax(0,1fr));gap:24px 12px}}
  `;
  document.documentElement.append(style);
  const bar = element('div'); bar.id = 'margin-search-exact';
  const label = element('label'), toggle = element('input'); toggle.type = 'checkbox';
  toggle.checked = stored[KEY] === true;
  label.append(toggle, document.createTextNode('明确目标优先'));
  const restore = element('button', '恢复原版'), update = element('button', '更新排序');
  restore.type = update.type = 'button'; restore.hidden = update.hidden = true;
  const status = element('span'); status.id = 'margin-search-exact-status'; status.setAttribute('role', 'status');
  bar.append(label, restore, update, status);
  const view = element('ul'); view.id = 'margin-search-exact-results'; view.hidden = true;
  view.setAttribute('aria-label', '明确目标优先搜索结果');
  let source: HTMLElement | null = null, signature = '', route = '', timer = 0, stopped = false;
  let saved: { inert: boolean; aria: string | null } | null = null;
  const native = () => {
    view.hidden = true; view.replaceChildren(); restore.hidden = update.hidden = true;
    if (source && saved) {
      source.removeAttribute('data-margin-search-source'); source.inert = saved.inert;
      if (saved.aria === null) source.removeAttribute('aria-hidden'); else source.setAttribute('aria-hidden', saved.aria);
    }
    saved = null;
  };
  const read = (): Item[] => [...(source?.children ?? [])].flatMap((wrapper) => {
    const card = wrapper.querySelector('.bili-video-card') ?? wrapper;
    if (wrapper.matches('[data-margin-filtered]') || wrapper.querySelector('[data-margin-filtered]')) return [];
    if (getComputedStyle(wrapper).display === 'none' || getComputedStyle(card).display === 'none') return [];
    if (document.documentElement.classList.contains('margin-ads-hide') && card.querySelector('.bili-video-card__info--ad')) return [];
    const link = card.querySelector<HTMLAnchorElement>('a[href*="/video/BV"]');
    const bvid = link?.href.match(/\/video\/(BV[0-9A-Za-z]{10})(?:[/?#]|$)/)?.[1];
    const titleEl = card.querySelector('.bili-video-card__info--tit');
    const title = (titleEl?.getAttribute('title') || titleEl?.textContent || '').trim();
    if (!bvid || !title) return [];
    const img = card.querySelector<HTMLImageElement>('.bili-video-card__image img, .bili-video-card__cover img, img');
    const owner = card.querySelector<HTMLAnchorElement>('a[href*="space.bilibili.com/"]');
    const author = card.querySelector('.bili-video-card__info--author')?.textContent?.trim() || owner?.textContent?.trim() || '';
    const cover = img?.currentSrc || img?.src || img?.getAttribute('data-src') || '';
    return [{ bvid, title, cover, author, authorUrl: owner?.href ?? '',
      duration: card.querySelector('.bili-video-card__stats__duration')?.textContent?.trim() || '',
      stats: card.querySelector('.bili-video-card__stats--item')?.textContent?.trim() || '' }];
  });
  const render = (items: Item[]) => {
    const fragment = document.createDocumentFragment();
    for (const item of items) {
      const li = element('li'); li.dataset.bvid = item.bvid;
      const cover = element('a'); cover.className = 'mx-cover';
      cover.href = `https://www.bilibili.com/video/${item.bvid}/`; cover.target = '_blank'; cover.rel = 'noopener noreferrer';
      cover.tabIndex = -1; cover.setAttribute('aria-hidden', 'true');
      if (/^https:\/\/[^/]+\.hdslb\.com\//.test(item.cover)) {
        const img = element('img'); img.src = item.cover; img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; cover.append(img);
      }
      if (item.duration) { const duration = element('span', item.duration); duration.className = 'mx-duration'; cover.append(duration); }
      const title = element('a', item.title); title.className = 'mx-title'; title.href = cover.href; title.target = '_blank'; title.rel = cover.rel;
      const meta = element('div'); meta.className = 'mx-meta';
      const owner = element('a', item.author); owner.className = 'mx-author';
      if (/^https:\/\/space\.bilibili\.com\/\d+/.test(item.authorUrl)) { owner.href = item.authorUrl; owner.target = '_blank'; owner.rel = cover.rel; }
      meta.append(owner, element('span', item.stats)); li.append(cover, title, meta); fragment.append(li);
    }
    view.replaceChildren(fragment); view.hidden = false;
    saved = { inert: source!.inert, aria: source!.getAttribute('aria-hidden') };
    source!.setAttribute('data-margin-search-source', ''); source!.inert = true; source!.setAttribute('aria-hidden', 'true');
    restore.hidden = false;
  };
  const refresh = (explicit = false) => {
    timer = 0; if (stopped) return;
    bindRoot();
    const found = document.querySelector<HTMLElement>(SOURCE);
    if (found !== source) { native(); source = found; signature = ''; bar.remove(); view.remove(); }
    if (!source || location.pathname.replace(/\/$/, '') !== '/video') { native(); bar.hidden = true; return; }
    bar.hidden = false;
    if (!bar.isConnected) source.before(bar, view);
    const params = new URLSearchParams(location.search);
    const key = location.href, order = params.get('order') || 'totalrank';
    // Image decoding / CDN srcset changes do not change ordering inputs.
    const items = read(), next = JSON.stringify(items.map(item => [item.bvid, item.title]));
    if (route !== key) { native(); signature = ''; route = key; }
    if (!toggle.checked || order !== 'totalrank') {
      native(); signature = next;
      status.textContent = toggle.checked ? '已暂停增强，遵循原生排序' : '';
      return;
    }
    if (saved && signature !== next && !explicit) {
      // A newly filtered result must never remain visible in the old view.
      const displayed = [...view.children].map(el => (el as HTMLElement).dataset.bvid);
      if (displayed.some(id => !items.some(item => item.bvid === id))) native();
      update.hidden = false; status.textContent = '结果已更新，点击更新排序'; return;
    }
    if (!explicit && saved && signature === next) return;
    native(); signature = next;
    const sorted = exactFirst(items, params.get('keyword') || '', { enabled: true, category: 'video', order });
    if (sorted.some((item, index) => item !== items[index])) {
      render(sorted); status.textContent = '明确目标已提前；卡片原生操作可恢复原版使用';
    } else status.textContent = '未发现需要提前的明确目标，保留原序';
  };
  const schedule = () => { if (!timer && !stopped) timer = window.setTimeout(() => refresh(), 100); };
  const observer = new MutationObserver((records) => {
    if (records.some(r => {
      const target = r.target instanceof Element ? r.target : r.target.parentElement;
      return target && !target.closest('#margin-search-exact, #margin-search-exact-results') && (
      r.type === 'attributes' || target.closest('.bili-video-card__info--tit') ||
      [...r.addedNodes, ...r.removedNodes].some(n => n instanceof Element &&
        (n.matches(`${SOURCE}, .video-list-item, .bili-video-card, .bili-video-card__info--tit`) || n.querySelector(`${SOURCE}, .bili-video-card__info--tit`)))
      );
    })) schedule();
  });
  let observedRoot: Element | null = null;
  const bindRoot = () => {
    const root = document.querySelector('.search-content');
    if (root === observedRoot) return;
    observer.disconnect(); observedRoot = root;
    if (root) observer.observe(root, {
      subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-margin-filtered'],
    });
  };
  const discovery = new MutationObserver(records => {
    if (records.some(r => [...r.addedNodes, ...r.removedNodes].some(n => n instanceof Element &&
      (n.matches('.search-content') || n.querySelector('.search-content'))))) schedule();
  });
  discovery.observe(document.body, { childList: true, subtree: true });
  const change = () => {
    void chrome.storage.local.set({ [KEY]: toggle.checked }).catch(() => { status.textContent = '当前页已生效，偏好保存失败'; });
    refresh(true);
  };
  toggle.addEventListener('change', change);
  restore.addEventListener('click', () => { toggle.checked = false; change(); toggle.focus({ preventScroll: true }); });
  update.addEventListener('click', () => { refresh(true); toggle.focus({ preventScroll: true }); });
  const navigation = (window as unknown as { navigation?: EventTarget }).navigation;
  navigation?.addEventListener('navigatesuccess', schedule);
  addEventListener('popstate', schedule); addEventListener('pageshow', schedule);
  // Restore before native controls start their asynchronous route/filter update.
  const beforeNative = (event: Event) => {
    if (event.target instanceof Element && event.target.closest('button, a')?.closest('.search-conditions, .search-tabs, .vui_pagenation')) {
      native(); signature = ''; schedule();
    }
  };
  document.addEventListener('click', beforeNative, true);
  const stop = () => {
    stopped = true; clearTimeout(timer); observer.disconnect(); discovery.disconnect(); native(); bar.remove(); view.remove(); style.remove();
    navigation?.removeEventListener('navigatesuccess', schedule);
    removeEventListener('popstate', schedule); removeEventListener('pageshow', schedule);
    document.removeEventListener('click', beforeNative, true);
  };
  onSettingsChange(next => { if (!next.enabled) stop(); });
  refresh();
}
