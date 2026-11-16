import type { RecommendationFeed } from '../api/feed';
import { cardData } from './card';

/** Observe rendered recommendation cards inside the actual home scroll viewport. */
export function attachRecommendationFeedback(grid: HTMLElement, viewport: HTMLElement, feed: RecommendationFeed, enabled: () => boolean): void {
  const visible = new Set<Element>();
  const recordVisible = () => {
    if (document.hidden || !enabled()) return;
    for (const card of visible) {
      const video = cardData.get(card);
      if (card.isConnected && grid.contains(card) && video) feed.expose(video);
    }
  };
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.target.isConnected && grid.contains(entry.target) && entry.isIntersecting && entry.intersectionRatio >= .5) visible.add(entry.target);
      else visible.delete(entry.target);
    }
    recordVisible();
  }, { root: viewport, rootMargin: '-80px 0px 0px', threshold: .5 });
  const mutations = new MutationObserver(entries => {
    for (const entry of entries) {
      for (const node of entry.removedNodes) if (node instanceof Element) {
        observer.unobserve(node);
        visible.delete(node);
      }
      for (const node of entry.addedNodes) if (node instanceof Element && cardData.has(node)) observer.observe(node);
    }
  });
  mutations.observe(grid, { childList: true });
  const clicked = (event: MouseEvent) => {
    if (!enabled() || event.defaultPrevented || event.button > 1) return;
    const target = event.target as Element;
    if (target.closest('button')) return;
    const link = target.closest('a.cover, a.title');
    const card = link?.closest('.card');
    const video = card && grid.contains(card) ? cardData.get(card) : undefined;
    if (video) feed.click(video);
  };
  grid.addEventListener('click', clicked, true);
  grid.addEventListener('auxclick', clicked, true);
  document.addEventListener('visibilitychange', recordVisible);
}
