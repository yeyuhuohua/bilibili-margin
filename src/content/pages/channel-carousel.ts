import { every } from '../sched';
import { h, icon, ICONS } from '../ui/dom';

interface Slide { key: string; title: string; image: string; href: string; target: string }

function readSlides(source: HTMLElement): Slide[] {
  const slides = new Map<string, Slide>();
  for (const item of source.querySelectorAll<HTMLElement>('.banner-carousel__item')) {
    const link = item.querySelector<HTMLAnchorElement>('a.cover-wrap');
    const image = item.querySelector<HTMLImageElement>('img');
    if (!link || !image || !/^https?:\/\//.test(link.href) || !/^https?:\/\//.test(image.src)) continue;
    const key = item.dataset.index ?? link.href;
    if (!slides.has(key)) slides.set(key, { key, title: image.alt || link.title, image: image.currentSrc || image.src, href: link.href, target: link.target || '_self' });
  }
  return [...slides.values()].sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
}

/** 用户确认的 21st SqueezeCarousel 交互，复用原生轮播数据及本地字体。 */
function mount(source: HTMLElement): { el: HTMLElement; dispose(): void } {
  const panels = h('div', { class: 'mcc-panels' });
  const caption = h('div', { class: 'mcc-caption', 'aria-live': 'polite' });
  const dots = h('div', { class: 'mcc-dots' });
  const prev = h('button', { type: 'button', 'aria-label': '上一张' }, icon(ICONS.back));
  const next = h('button', { type: 'button', 'aria-label': '下一张' }, icon(ICONS.chevronRight));
  const controls = h('div', { class: 'mcc-controls' }, prev, next);
  const el = h('section', { class: 'm-channel-carousel', 'aria-label': '分区推荐轮播', 'aria-roledescription': '轮播图', hidden: '' }, panels, caption, dots, controls);
  let slides: Slide[] = [], selected = 0, width = 0, signature = '';
  let cards: { el: HTMLElement; link: HTMLElement; select: HTMLElement; dot: HTMLElement }[] = [];
  const show = (index: number) => {
    if (!slides.length) return;
    selected = (index + slides.length) % slides.length;
    const main = Math.max(0, width - Math.min(2, slides.length - 1) * 26);
    el.style.setProperty('--mcc-main', `${main}px`);
    caption.textContent = slides[selected].title;
    cards.forEach((card, i) => {
      const slot = (i - selected + slides.length) % slides.length;
      const front = slot === 0, visible = slot <= 2;
      const x = front ? 0 : visible ? main + 8 + (slot - 1) * 26 : slot === slides.length - 1 ? -26 : width + 26;
      card.el.style.transform = `translateX(${x}px)`;
      card.el.style.clipPath = `inset(0 ${front ? 0 : Math.max(0, main - 18)}px 0 0 round var(--mcc-radius))`;
      card.el.dataset.selected = String(front);
      card.el.dataset.visible = String(visible);
      card.el.setAttribute('aria-hidden', String(!visible));
      card.link.hidden = !front; card.select.hidden = front || !visible;
      card.dot.setAttribute('aria-current', String(front));
    });
  };
  const sync = () => {
    const updated = readSlides(source), key = JSON.stringify(updated);
    if (key === signature) return;
    signature = key;
    const current = slides[selected]?.href;
    slides = updated;
    panels.replaceChildren(); dots.replaceChildren();
    cards = slides.map((slide, i) => {
      const link = h('a', { class: 'mcc-open', href: slide.href, target: slide.target, rel: 'noopener', 'aria-label': `打开${slide.title}` });
      const select = h('button', { class: 'mcc-select', type: 'button', 'aria-label': `展开${slide.title}`, onclick: () => { show(i); link.focus(); } });
      const panel = h('div', { class: 'mcc-panel' }, h('img', { src: slide.image, alt: '', decoding: 'async', referrerpolicy: 'no-referrer', draggable: 'false' }), link, select);
      const dot = h('button', { class: 'mcc-dot', type: 'button', 'aria-label': `切换到${slide.title}`, onclick: () => show(i) });
      panels.append(panel); dots.append(dot);
      return { el: panel, link, select, dot };
    });
    controls.hidden = dots.hidden = slides.length < 2;
    el.hidden = !slides.length;
    if (slides.length) source.dataset.marginCarousel = 'on';
    else delete source.dataset.marginCarousel;
    show(Math.max(0, slides.findIndex(slide => slide.href === current)));
  };
  prev.addEventListener('click', () => show(selected - 1));
  next.addEventListener('click', () => show(selected + 1));
  el.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault(); show(selected + (event.key === 'ArrowRight' ? 1 : -1)); cards[selected]?.link.focus();
  });
  source.before(el);
  const resize = new ResizeObserver(([entry]) => { width = entry.contentRect.width; show(selected); });
  resize.observe(el);
  const changes = new MutationObserver(sync);
  changes.observe(source, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset', 'alt', 'href', 'target', 'data-index'] });
  sync();
  return { el, dispose() { changes.disconnect(); resize.disconnect(); delete source.dataset.marginCarousel; el.remove(); } };
}

/** 原生分区可晚挂载和整块替换；使用现有可见性调度器，只在节点变化时重新挂载。 */
export function mountChannelCarousel(): void {
  let native: HTMLElement | null = null, current: ReturnType<typeof mount> | null = null;
  const check = () => {
    const next = document.querySelector<HTMLElement>('.channel-page .channel-carousel');
    if (next === native && (!current || current.el.isConnected)) return;
    current?.dispose(); native = next; current = next ? mount(next) : null;
  };
  check();
  const stop = every(1000, check);
  addEventListener('pagehide', event => { if (!event.persisted) { stop(); current?.dispose(); } });
}
