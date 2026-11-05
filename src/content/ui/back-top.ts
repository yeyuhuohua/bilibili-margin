import { reducedMotion } from '../motion';
import { h, icon, ICONS } from './dom';

export function createBackTop(scroller: HTMLElement | Window, content?: HTMLElement): HTMLButtonElement {
  const element = scroller instanceof HTMLElement ? scroller : null;
  const button = h('button', { class: 'back-top', type: 'button', title: '返回顶部', 'aria-label': '返回顶部', hidden: '' }, icon(ICONS.top));
  let enough = false;
  const sync = () => {
    const top = element ? element.scrollTop : window.scrollY;
    button.hidden = !enough || top < 480;
  };
  const measure = () => {
    const height = element ? element.scrollHeight : Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0);
    const viewport = element ? element.clientHeight : window.innerHeight;
    enough = height > viewport + 1;
    sync();
  };
  const observer = new ResizeObserver(measure);
  if (element) {
    element.addEventListener('scroll', sync, { passive: true });
    observer.observe(element);
    if (content) observer.observe(content);
  } else {
    window.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', measure, { passive: true });
    observer.observe(document.documentElement);
    const observeBody = () => { if (document.body) observer.observe(document.body); measure(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observeBody, { once: true });
    else observeBody();
  }
  button.addEventListener('click', () => {
    const behavior = reducedMotion() ? 'auto' : 'smooth';
    if (element) element.scrollTo({ top: 0, behavior });
    else window.scrollTo({ top: 0, behavior });
  });
  measure();
  return button;
}
