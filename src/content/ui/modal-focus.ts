let active: { close(): void } | null = null;

function focused(): Element | null {
  let el = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el;
}

/** Isolate only siblings along the composed ancestor path; restore their prior inert state. */
export function containModalFocus(layer: HTMLElement, panel: HTMLElement, close: () => void): () => void {
  active?.close();
  const previous = focused();
  const scope = { close }; active = scope;
  const saved = new Map<HTMLElement, boolean>();
  let branch: Element = layer;
  while (branch.parentNode) {
    const parent = branch.parentNode;
    for (const sibling of (parent as ParentNode).children) {
      if (sibling !== branch && sibling instanceof HTMLElement && !sibling.matches('style, script, link')) {
        saved.set(sibling, sibling.inert); sibling.inert = true;
      }
    }
    if (parent instanceof ShadowRoot) branch = parent.host;
    else if (parent instanceof Element) branch = parent;
    else break;
  }
  layer.inert = false;
  const keydown = (e: KeyboardEvent) => {
    if (e.key !== 'Tab' || e.defaultPrevented) return;
    const items = [...panel.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]')]
      .filter(el => el.tabIndex >= 0 && !el.matches(':disabled') && !el.closest('[hidden], [inert]') && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
    const index = items.indexOf(focused() as HTMLElement);
    const next = index < 0 ? (e.shiftKey ? items.length - 1 : 0) : (index + (e.shiftKey ? -1 : 1) + items.length) % items.length;
    e.preventDefault(); (items[next] ?? panel).focus({ preventScroll: true });
  };
  const escape = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); close(); }
  };
  const refocus = (e: FocusEvent) => { if (!e.composedPath().includes(panel)) panel.focus({ preventScroll: true }); };
  document.addEventListener('keydown', keydown, true);
  document.addEventListener('keydown', escape);
  document.addEventListener('focusin', refocus, true);
  const frame = requestAnimationFrame(() => { if (active === scope) panel.focus({ preventScroll: true }); });
  return () => {
    if (active !== scope) return;
    active = null; cancelAnimationFrame(frame);
    document.removeEventListener('keydown', keydown, true);
    document.removeEventListener('keydown', escape);
    document.removeEventListener('focusin', refocus, true);
    for (const [el, inert] of saved) el.inert = inert;
    if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
  };
}
