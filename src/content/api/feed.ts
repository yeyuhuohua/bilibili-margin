import { getJSON, getWbi, postForm } from './http';

export interface Video {
  bvid: string;
  cid: number;
  title: string;
  cover: string;
  duration: number;
  author: string;
  mid: number;
  face: string;
  views: number;
  danmaku: number;
  pubdate: number;
  /** Native App feed date label when the response provides no timestamp. */
  publishText?: string;
  reason?: string;
  /** 推荐接口才有（v0.46「不感兴趣」用） */
  aid?: number;
  trackId?: string;
  goto?: string;
  /** 接口明确标记的广告/推广（v0.47），不靠标题猜测 */
  ad?: boolean;
  /** 合作稿件（v0.50，B 站评论建议）：热门 / 空间接口带 rights.is_cooperation，推荐接口不给这个字段 */
  coop?: boolean;
  /** 封面角标文案（v0.51）：空间接口的 elec_arc_badge，如「充电专属」；推荐接口不给这个字段 */
  badge?: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const isAd = (v: any): boolean =>
  v.is_ad === true || v.card_type === 'ad' || v.goto === 'ad' || Boolean(v.ad_info);

const toVideo = (v: any): Video => ({
  bvid: v.bvid,
  cid: Number(v.cid) || 0,
  title: v.title,
  cover: String(v.pic || '').replace(/^http:/, 'https:'),
  duration: Number(v.duration) || 0,
  author: v.owner?.name ?? '',
  mid: v.owner?.mid ?? 0,
  face: v.owner?.face ?? '',
  views: v.stat?.view ?? 0,
  danmaku: v.stat?.danmaku ?? 0,
  pubdate: v.pubdate ?? 0,
  reason: v.rcmd_reason?.content || undefined,
  aid: Number(v.id ?? v.aid) || undefined,
  trackId: v.track_id || undefined,
  goto: v.goto || undefined,
  ad: isAd(v) || undefined,
  coop: v.rights?.is_cooperation === 1 || v.is_union_video === 1 || undefined,
});

/**
 * 「不感兴趣」反馈给 B 站推荐（v0.46，B 站评论：点了不喜欢还一直推）。
 * 与 B 站首页自己的按钮用同一个接口和参数：reason 1 = 内容不感兴趣，4 = 不想看此 UP 主。
 */
export async function dislike(v: Video, reason: 1 | 4, cancel = false): Promise<void> {
  if (!v.aid) throw new Error('这条视频不支持');
  await postForm(cancel ? '/x/web-interface/feedback/dislike/cancel' : '/x/web-interface/feedback/dislike', {
    app_id: 100, platform: 5, from_spmid: '', spmid: '333.1007.0.0',
    goto: v.goto || 'av', id: v.aid, mid: v.mid, track_id: v.trackId || '', feedback_page: 1, reason_id: reason,
  });
}

export type RecommendScene = 'scroll' | 'refresh';
type FeedRecord = { report: string; clicked: string; shown: boolean };

/** Page-local request history, following the homepage feed protocol. */
export class RecommendationFeed {
  private index = -1;
  private initialized = false;
  private hourlyIndex = -1;
  private hourStarted = Date.now();
  private row = -2;
  private scrollBrush = -1;
  private refreshBrush = -1;
  private groups: FeedRecord[][] = [];
  private records = new WeakMap<Video, FeedRecord>();
  private clicks: string[] = [];
  private queue: Promise<void> = Promise.resolve();

  load(scene: RecommendScene, columns: number, signal: AbortSignal): Promise<Video[]> {
    const request = this.queue.then(() => this.request(scene, columns, signal));
    this.queue = request.then(() => {}, () => {});
    return request;
  }

  expose(video: Video): void {
    const record = this.records.get(video);
    if (record) record.shown = true;
  }

  click(video: Video): void {
    const record = this.records.get(video);
    if (!record) return;
    record.shown = true;
    this.clicks.push(record.clicked);
    if (this.clicks.length > 50) this.clicks.shift();
  }

  private async request(scene: RecommendScene, columns: number, signal: AbortSignal): Promise<Video[]> {
    signal.throwIfAborted();
    const initial = !this.initialized;
    const freshType = initial ? 0 : scene === 'refresh' ? 5 : 4;
    if (Date.now() - this.hourStarted > 3600000) {
      this.hourlyIndex = 0;
      this.hourStarted = Date.now();
    }
    this.index++;
    this.hourlyIndex++;
    if (initial || freshType === 5) this.row = -2;
    this.row += 3;
    const brush = freshType === 5 ? ++this.refreshBrush : ++this.scrollBrush;
    const size = freshType === 4 ? 12 : 10;
    const cookie = (name: string) => document.cookie.split(';').map(part => part.trim()).find(part => part.startsWith(name + '='))?.slice(name.length + 1) || '';
    const ua = navigator.userAgent;
    const device = /windows|win32|win64|wow32|wow64/i.test(ua) ? 'win'
      : /macintosh|macintel|macppc|mac68k|macos/i.test(ua) ? 'mac'
      : /linux/i.test(ua) && !/android/i.test(ua) || /x11/i.test(ua) ? 'linux' : 'unknown';
    const lastShowlist = this.groups.map(group => group.map(record => record.shown
      ? record.report.replace('_n_', '_') : record.report).join(',')).join(';');
    const data = await getWbi<{ item: any[] }>('/x/web-interface/wbi/index/top/feed/rcmd', {
      web_location: 1430650,
      feed_version: 'V8',
      homepage_ver: 1,
      fresh_type: freshType,
      y_num: columns,
      last_y_num: Number(cookie('home_feed_column')) || 0,
      screen: cookie('browser_resolution'),
      device,
      ps: size,
      domestic_zh_ps: size,
      domestic_other_ps: size,
      overseas_zh_ps: size,
      overseas_other_ps: 15,
      fresh_idx: this.index,
      fresh_idx_1h: this.hourlyIndex,
      fetch_row: this.row,
      brush,
      last_showlist: lastShowlist,
      last_clicklist: this.clicks.join(','),
    }, signal);
    signal.throwIfAborted();
    this.initialized = true;
    const group: FeedRecord[] = [];
    const list: Video[] = [];
    for (const item of data.item || []) {
      const id = item.id || item.aid || item.business_info?.src_id;
      const adAid = item.goto === 'ad' ? item.business_info?.archive?.aid : undefined;
      const record = id && item.goto ? {
        report: `${item.goto}_n_${id}${adAid ? '_' + adAid : ''}`,
        clicked: `${item.goto}_${id}`,
        shown: false,
      } : undefined;
      if (record) group.push(record);
      if (item.goto !== 'av' || !item.bvid) continue;
      const video = toVideo(item);
      if (record) this.records.set(video, record);
      list.push(video);
    }
    if (group.length) this.groups.push(group);
    // Keep whole request groups, including the current batch and its optional prefetch.
    let count = this.groups.reduce((total, items) => total + items.length, 0);
    while (this.groups.length > 1 && count - this.groups[0].length >= 50) {
      count -= this.groups.shift()!.length;
    }
    return list;
  }
}

export async function popular(page: number): Promise<{ list: Video[]; done: boolean }> {
  const data = await getJSON<{ list: any[]; no_more: boolean }>('/x/web-interface/popular', { ps: 20, pn: page });
  return { list: (data.list || []).map(toVideo), done: data.no_more };
}
