import type { Video } from '../api/feed';
import { fmtCount, fmtDateTime, fmtDuration, h, icon, ICONS } from './dom';
import { laterButton } from './later-btn';
import { followStatus } from '../api/follow-status';

const thumb = (url: string) => (url ? `${url}@672w_378h_1c.webp` : '');
export const cardData = new WeakMap<Element, Video>();

export interface CardOpts {
  more?: boolean; compact?: boolean;
  /** 首页「卡片信息」里关掉的项（v0.43）：author / views / danmaku / ago / dur / reason */
  hide?: ReadonlySet<string>;
  inlineTime?: boolean;
}

export function videoCard(v: Video, index: number, opts: CardOpts = {}): HTMLElement {
  const href = `https://www.bilibili.com/video/${v.bvid}`;
  const cover = h('a', { class: 'cover', href, target: '_blank', rel: 'noopener', 'aria-label': v.title },
    h('img', { src: thumb(v.cover), alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' }),
    v.duration && !opts.hide?.has('dur') ? h('span', { class: 'dur' }, fmtDuration(v.duration)) : null,
    v.coop ? h('span', { class: 'coop', title: '多位 UP 主联合投稿' }, '合作') : null,
    // v0.51：充电专属等角标（右上角，避开左上角的「合作」）
    v.badge ? h('span', { class: 'tag-charge', title: v.badge }, v.badge) : null,
    laterButton(v.bvid, v.aid),
  );
  const el = h('article', { class: `card${opts.compact ? ' compact' : ''}`, style: `--i:${index % 12}` },
    cover,
    opts.more ? h('button', { class: 'card-more', type: 'button', title: '更多操作', 'aria-label': '更多操作', 'aria-haspopup': 'menu' }, icon(ICONS.more)) : null,
    h('div', { class: 'body' },
      h('a', { class: 'title', href, target: '_blank', rel: 'noopener', title: v.title }, v.title),
      metaRow(v, opts),
      opts.inlineTime ? null : pubTime(v, opts),
      v.reason && v.reason !== '已关注' && !opts.hide?.has('reason') ? h('span', { class: 'reason', title: v.reason }, v.reason) : null,
    ),
  );
  cardData.set(el, v);
  if (!opts.compact) refreshCardFollow(el);
  return el;
}

/** 缓存卡片重新挂回列表时，仍从现有关系缓存更新关注状态。 */
export function refreshCardFollow(card: HTMLElement): void {
  const video = cardData.get(card), author = card.querySelector<HTMLElement>('.author');
  if (!video || !author) return;
  void followStatus(video.mid).then(on => {
    if (on === undefined) return;
    const badge = author.querySelector('.card-followed');
    if (on && !badge) author.append(h('span', { class: 'card-followed' }, icon(ICONS.check), '已关注'));
    if (!on) badge?.remove();
  });
}

/** 发布时间独占一行，有时间戳时显示日期时间，否则沿用接口的原生日期文字。 */
function pubTime(v: Video, opts: CardOpts): HTMLElement | null {
  if (opts.compact || opts.hide?.has('ago')) return null;
  const text = v.pubdate ? fmtDateTime(v.pubdate) : v.publishText;
  return text ? h('time', { class: 'pubtime', datetime: v.pubdate ? new Date(v.pubdate * 1000).toISOString() : undefined }, text) : null;
}

/** 卡片信息行：只放没关掉的项，分隔点跟在前一项后面，不会出现打头的「·」 */
function metaRow(v: Video, opts: CardOpts): HTMLElement {
  const off = (k: string) => !!opts.hide?.has(k);
  const parts: HTMLElement[] = [];
  if (!off('author')) {
    const author = h('a', { class: 'author', title: v.author, href: `https://space.bilibili.com/${v.mid}`, target: '_blank', rel: 'noopener' }, icon(ICONS.user), h('span', { class: 'author-name' }, v.author));
    if (v.reason === '已关注') author.append(h('span', { class: 'card-followed' }, icon(ICONS.check), '已关注'));
    parts.push(author);
  }
  if (!off('views') && !Number.isNaN(v.views)) {
    const views = fmtCount(v.views);
    parts.push(h('span', { class: 'stat', title: `${views} 播放`, 'aria-label': `${views} 播放` }, icon(ICONS.play), views));
  }
  // 部分接口给数字字符串；明确的 0 保留，无效或缺失值不伪造为 0。
  const rawDanmaku: unknown = v.danmaku;
  const count = typeof rawDanmaku === 'number' ? rawDanmaku
    : typeof rawDanmaku === 'string' && /^\d+(?:\.\d+)?$/.test(rawDanmaku.trim()) ? Number(rawDanmaku) : NaN;
  const formatted = typeof rawDanmaku === 'string' && /^\d+(?:\.\d+)?[万亿]$/.test(rawDanmaku.trim()) ? rawDanmaku.trim() : null;
  const dm = Number.isFinite(count) && count >= 0 ? fmtCount(count) : formatted;
  if (dm !== null && !off('danmaku')) {
    parts.push(h('span', { class: 'stat', title: `${dm} 弹幕`, 'aria-label': `${dm} 弹幕` }, icon(ICONS.comment), dm));
  }
  const meta = h('div', { class: 'meta' });
  parts.forEach((el, i) => { if (i) meta.append(h('span', { class: 'dot' }, '·')); meta.append(el); });
  const date = opts.inlineTime ? pubTime(v, opts) : null;
  if (date) meta.append(date);
  if (!meta.childElementCount) meta.style.display = 'none';
  return meta;
}

export function skeleton(n: number): DocumentFragment {
  const f = document.createDocumentFragment();
  for (let i = 0; i < n; i++) f.append(h('div', { class: 'card sk' }, h('div', { class: 'cover' }), h('div', { class: 'line' }), h('div', { class: 'line short' })));
  return f;
}
