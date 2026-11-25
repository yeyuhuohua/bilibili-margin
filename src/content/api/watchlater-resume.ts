import { getJSON } from './http';

interface Part { cid: number; page: number }
interface Episode { bvid: string; cid?: number; pages?: Part[] }
interface Video extends Episode { ugc_season?: { sections: { episodes: Episode[] }[] } }
interface Visit { view_at: number; history: { business: string; bvid: string; cid: number; page: number } }

export function resumeTarget(entry: URL, video: Video, visits: Visit[], opened: number): URL | undefined {
  if (video.bvid !== entry.searchParams.get('bvid')) return;
  const episodes = video.ugc_season?.sections.flatMap(section => section.episodes) ?? [];
  for (const { history: h, view_at } of visits) {
    if (view_at >= opened || h.business !== 'archive') continue;
    const episode = h.bvid === video.bvid ? video : episodes.find(e => e.bvid === h.bvid);
    if (!episode) continue;
    const part = episode.pages?.find(p => p.cid === h.cid)?.page ?? (episode.cid === h.cid && h.page === 1 ? 1 : 0);
    if (!Number.isInteger(part) || part < 1 || (h.bvid === video.bvid && part === 1)) return;
    const target = h.bvid === video.bvid ? new URL(entry) : new URL('/video/' + h.bvid + '/', entry);
    if (part > 1) target.searchParams.set('p', String(part));
    return target;
  }
}

/** Only a fresh entry from Watch Later may resume. Native episode links and manual input take priority. */
export async function resumeWatchLater(): Promise<void> {
  const entry = new URL(location.href);
  const bvid = entry.searchParams.get('bvid');
  const marked = entry.searchParams.get('margin_resume') === '1';
  if (marked) {
    entry.searchParams.delete('margin_resume');
    history.replaceState(history.state, '', entry);
  }
  if (!marked && !/^https:\/\/www\.bilibili\.com\/watchlater\//.test(document.referrer)) return;
  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  if (navigation && navigation.type !== 'navigate') return;
  if (!bvid || !/^BV[\da-zA-Z]{10}$/.test(bvid) || ['cid','p','t','start_progress'].some(k => entry.searchParams.has(k)) || entry.hash) return;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  const timeout = window.setTimeout(cancel, 3000);
  for (const event of ['pointerdown','keydown','pagehide','popstate']) window.addEventListener(event, cancel, { capture: true, signal: controller.signal });
  try {
    const view = await getJSON<Video>('/x/web-interface/view', { bvid }, controller.signal);
    if (!view.ugc_season && (view.pages?.length ?? 0) <= 1) return;
    const recent = await getJSON<{ list: Visit[] }>('/x/web-interface/history/cursor', { type: 'archive', ps: 30 }, controller.signal);
    const target = resumeTarget(entry, view, recent.list, Math.floor(performance.timeOrigin / 1000));
    const current = new URL(location.href);
    if (target && !controller.signal.aborted && current.pathname === entry.pathname && current.searchParams.get('bvid') === bvid &&
      !['p','cid','t','start_progress'].some(k => current.searchParams.has(k)) && !current.hash) location.replace(target.href);
  } catch { /* History is optional. The native playlist already handles ordinary playback. */ }
  finally { clearTimeout(timeout); cancel(); }
}
