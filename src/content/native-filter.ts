import { onSettingsChange, type Settings } from '../shared/settings';
import { FilterRuntime } from './filter-runtime';
import type { FilterTarget } from './filter';
import { parseCountText, parseDurationText } from './parse';
import { cachedTags, ensureTags } from './tags';

/**
 * 原生页面（搜索 / 播放页推荐 / 热门排行 / 番剧）的屏蔽词过滤器。
 * 只给命中的卡片加 data-margin-filtered="native"，隐藏交给 global.css；绝不删除 B 站节点。
 * 原生卡片能可靠拿到标题和 UP 主；播放量、时长解析不到时按未知放行。
 */
type NativeKind = 'watch' | 'search' | 'page';

interface NativeRule {
  root: string;
  item: string;
  title: string;
  author?: string;
  views?: string;
  duration?: string;
}

const RULES: Record<NativeKind, NativeRule[]> = {
  watch: [{
    root: '.right-container, .recommend-list-v1',
    item: '.video-page-card-small, .video-card, .rec-video-card, .bili-video-card',
    title: '.title, .video-name, .bili-video-card__info--tit',
    author: '.upname, .up-name, .bili-video-card__info--author, .name',
    views: '.video-stat, .playinfo, .bili-video-card__stats--item:first-child',
    duration: '.duration, .dur, .bili-video-card__stats__duration',
  }],
  search: [{
    root: '.search-content, .video-list, #search-content',
    item: '.bili-video-card, .video-list-item, .search-page-video',
    title: '.bili-video-card__info--tit, .title, h3',
    author: '.bili-video-card__info--author, .up-name, .upname',
    views: '.bili-video-card__stats--item:first-child, .video-stat, .playinfo',
    duration: '.bili-video-card__stats__duration, .duration, .dur',
  }],
  page: [{
    root: '.popular-video-container, .rank-list, .bangumi-list, .video-list',
    item: '.video-card, .rank-item, .bili-video-card, .video-list-item',
    title: '.video-name, .title, .info .title, .bili-video-card__info--tit',
    author: '.up-name, .upname, .bili-video-card__info--author, .name',
    views: '.video-stat, .playinfo, .bili-video-card__stats--item:first-child',
    duration: '.duration, .dur, .length, .bili-video-card__stats__duration',
  }],
};

const textOf = (el: Element, selector?: string): string => {
  if (!selector) return '';
  return (el.querySelector(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim();
};

function targetOfNative(el: Element, rule: NativeRule): FilterTarget | null {
  const title = textOf(el, rule.title);
  if (!title) return null; // 标题都读不到就不猜
  const author = textOf(el, rule.author) || null;
  const space = el.querySelector<HTMLAnchorElement>('a[href*="space.bilibili.com/"]')?.href;
  const mid = space?.match(/space\.bilibili\.com\/(?:\d+\/)?(\d+)/)?.[1];
  const video = el.querySelector<HTMLAnchorElement>('a[href*="/video/"]')?.href;
  const bvid = /\/video\/(BV[0-9A-Za-z]+)/.exec(video ?? '')?.[1];
  return {
    title,
    author,
    mid: mid ? Number(mid) : null,
    views: parseCountText(textOf(el, rule.views)),
    duration: parseDurationText(textOf(el, rule.duration)),
    bvid,
    tags: cachedTags(bvid),
  };
}

const hasFilters = (s: Settings): boolean =>
  s.filters.keywords.length > 0 || s.filters.ups.length > 0 || s.filters.minViews > 0 || s.filters.minDuration > 0;

export function startNativeFilter(kind: NativeKind, settings: Settings): () => void {
  let current = settings;
  const filter = new FilterRuntime(settings);
  let marked = new Set<HTMLElement>();
  let scanT = 0;
  let href = location.href;
  /** 本次页面生命周期内已经请求过标签的 bvid，避免失败后反复扫描打接口 */
  const requested = new Set<string>();

  const clearMarks = () => {
    for (const el of marked) if (el.getAttribute('data-margin-filtered') === 'native') el.removeAttribute('data-margin-filtered');
    marked.clear();
  };

  const scan = () => {
    scanT = 0;
    if (!current.enabled || !hasFilters(current)) { clearMarks(); return; }

    // 同一张卡可能同时命中内外层选择器：只处理最外层
    const found = new Map<HTMLElement, NativeRule>();
    for (const rule of RULES[kind]) {
      for (const root of document.querySelectorAll(rule.root)) {
        for (const el of root.querySelectorAll<HTMLElement>(rule.item)) {
          if (!found.has(el)) found.set(el, rule);
        }
      }
    }
    const all = [...found.keys()];
    const top = all.filter((el) => !all.some((other) => other !== el && other.contains(el)));
    const next = new Set<HTMLElement>();

    for (const el of top) {
      if (el.closest('#margin-root, #margin-watch-top, #margin-bg, #margin-aside')) continue;
      const target = targetOfNative(el, found.get(el)!);
      if (!target) continue;
      // 关键词也要能命中视频标签：缺标签时补拉一次，回来后再扫描并标记
      if (current.filters.keywords.length && target.bvid && !cachedTags(target.bvid) && !requested.has(target.bvid)) {
        requested.add(target.bvid);
        void ensureTags(target.bvid).then(() => schedule());
      }
      if (filter.allows(target)) {
        if (el.getAttribute('data-margin-filtered') === 'native') el.removeAttribute('data-margin-filtered');
      } else {
        el.setAttribute('data-margin-filtered', 'native');
        next.add(el);
      }
    }
    for (const el of marked) {
      if (!next.has(el) && el.getAttribute('data-margin-filtered') === 'native') el.removeAttribute('data-margin-filtered');
    }
    marked = next;
  };

  const schedule = () => { if (!scanT) scanT = window.setTimeout(scan, 140); };
  const checkRoute = () => {
    if (location.href === href) return;
    href = location.href;
    if (current.enabled && hasFilters(current)) schedule();
  };

  const rootSelector = RULES[kind].map((rule) => rule.root).join(', ');
  const observer = new MutationObserver((records) => {
    // 没有过滤条件时完全不扫描，避免评论/弹幕持续变化时空转
    if (!current.enabled || !hasFilters(current)) return;
    // 只看 childList：自己写 data-margin-filtered 属于 attributes，观察它会造成死循环
    // 评论、弹幕等区域更新不影响视频过滤；同时覆盖列表的延迟挂载与整块替换。
    const changed = records.some((r) =>
      r.target instanceof Element && r.target.closest(rootSelector) ||
      [...r.addedNodes, ...r.removedNodes].some((node) =>
        node instanceof Element && (node.matches(rootSelector) || node.querySelector(rootSelector))));
    if (changed) schedule();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  addEventListener('popstate', checkRoute);
  addEventListener('hashchange', checkRoute);
  const timer = window.setInterval(checkRoute, 1500);

  onSettingsChange((next) => {
    current = next;
    filter.update(next);
    schedule();
  });
  schedule();

  return () => {
    observer.disconnect();
    clearTimeout(scanT);
    clearInterval(timer);
    removeEventListener('popstate', checkRoute);
    removeEventListener('hashchange', checkRoute);
    clearMarks();
  };
}
