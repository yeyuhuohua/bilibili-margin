import { attachGlass, glassFilters } from './liquid-glass';

const SELECTOR = '.search-input-wrap, .search-tabs .vui_tabs--nav, .search-conditions .search-condition-row, .search-conditions .i_button_more';

/** Decorate native controls in place; framework-owned nodes and handlers stay untouched. */
export function mountSearchControls(): () => void {
  const filters = glassFilters(); document.documentElement.append(filters);
  const groups = new Map<HTMLElement, () => void>();
  let frame = 0;
  const align = () => {
    frame = 0;
    const positions = [...groups.keys()].map(el => {
      const selected = el.querySelector<HTMLElement>('.vui_tabs--nav-item-active .vui_tabs--nav-link, .vui_button--active');
      const box = el.getBoundingClientRect(), cell = selected?.getBoundingClientRect();
      return { el, x: cell ? cell.left - box.left + el.scrollLeft : 0, y: cell ? cell.top - box.top + el.scrollTop : 0, w: cell?.width ?? 0, h: cell?.height ?? 0 };
    });
    for (const p of positions) for (const key of ['x', 'y', 'w', 'h'] as const) p.el.style.setProperty(`--ms-${key}`, `${p[key]}px`);
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(align); };
  const sizes = new ResizeObserver(schedule);
  const bind = (el: HTMLElement) => {
    if (groups.has(el)) return;
    el.setAttribute('data-margin-search-controls', '');
    const search = el.matches('.search-input-wrap');
    const releaseGlass = attachGlass(el, filters, { profile: search ? 'lens' : 'gradient', blur: search ? .5 : 1, strength: search ? .6 : .4, sat: '130%' });
    const state = new MutationObserver(schedule); state.observe(el, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
    sizes.observe(el);
    groups.set(el, () => {
      releaseGlass(); state.disconnect(); sizes.unobserve(el); el.removeAttribute('data-margin-search-controls');
      for (const key of ['x', 'y', 'w', 'h']) el.style.removeProperty(`--ms-${key}`);
    });
    schedule();
  };
  document.querySelectorAll<HTMLElement>(SELECTOR).forEach(bind);
  const additions = new MutationObserver(records => {
    for (const [el, release] of groups) if (!el.isConnected) { release(); groups.delete(el); }
    for (const r of records) for (const node of r.addedNodes) if (node instanceof HTMLElement) {
      if (node.matches(SELECTOR)) bind(node);
      node.querySelectorAll<HTMLElement>(SELECTOR).forEach(bind);
    }
  });
  additions.observe(document.documentElement, { childList: true, subtree: true });
  return () => {
    additions.disconnect(); sizes.disconnect(); cancelAnimationFrame(frame);
    for (const release of groups.values()) release(); groups.clear(); filters.remove();
  };
}
