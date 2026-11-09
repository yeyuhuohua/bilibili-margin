import { cidOf, invalidatePreview, previewUrl } from '../api/play';
import { cardData } from './card';
import { h } from './dom';

/** 封面悬停 0.5 秒后静音播放低清预览，进度细线在底部 */
export function attachPreview(container: HTMLElement, enabled: () => boolean): void {
  let timer = 0;
  let generation = 0;
  let hovered: HTMLElement | null = null;
  let active: { cover: HTMLElement; video: HTMLVideoElement; bar: HTMLElement } | null = null;

  const stop = () => {
    clearTimeout(timer);
    generation++;
    hovered = null;
    if (!active) return;
    const { cover, video, bar } = active;
    active = null;
    cover.classList.remove('playing');
    video.pause();
    setTimeout(() => { video.removeAttribute('src'); video.load(); video.remove(); bar.remove(); }, 250);
  };

  container.addEventListener('mouseover', (e) => {
    const cover = (e.target as Element).closest?.('.cover, .dy-vcover[data-bvid]') as HTMLElement | null;
    if (!cover || cover === hovered || !enabled()) return;
    const card = cover.closest('.card, .dy');
    const v = card && cardData.get(card);
    // 动态卡的视频封面没有 cardData，从链接里取 BV 号（#2）
    const bvid = v?.bvid ?? cover.getAttribute('data-bvid') ?? '';
    if (!bvid) return;
    stop();
    hovered = cover;
    const current = generation;
    timer = window.setTimeout(async () => {
      const cid = v?.cid || await cidOf(bvid);
      if (!cid || current !== generation || !enabled()) return;
      const url = await previewUrl(bvid, cid);
      if (!url || current !== generation || !enabled() || !cover.isConnected || document.hidden) return;
      const video = h('video', { muted: true, playsinline: true, loop: true, preload: 'auto', class: 'pv' }) as HTMLVideoElement;
      video.muted = true;
      const bar = h('span', { class: 'pv-bar' });
      video.addEventListener('timeupdate', () => { if (video.duration) bar.style.transform = `scaleX(${video.currentTime / video.duration})`; });
      video.addEventListener('playing', () => cover.classList.add('playing'), { once: true });
      video.addEventListener('error', () => { invalidatePreview(bvid, cid); if (active?.video === video) stop(); }, { once: true });
      video.src = url;
      cover.append(video, bar);
      active = { cover, video, bar };
      video.play().catch(() => { if (active?.video === video) stop(); });
    }, 500);
  });
  container.addEventListener('mouseout', (e) => {
    const cover = (e.target as Element).closest?.('.cover, .dy-vcover[data-bvid]');
    if (!cover) return;
    const to = e.relatedTarget as Node | null;
    if (to && cover.contains(to)) return;
    if (cover === hovered) stop();
  });
}
