export const WATCH_SEARCH_KEY = 'margin:watch-search-key';

/** Register at document_start, before native capture listeners can consume search keys. */
export function guardWatchSearchKeys(): void {
  const shield = (event: KeyboardEvent) => {
    const field = event.composedPath()[0];
    if (!(field instanceof HTMLInputElement) || !field.matches('.cp-input > input')) return;
    const root = field.getRootNode();
    if (!(root instanceof ShadowRoot) || root.host.id !== 'margin-watch-top') return;

    event.stopImmediatePropagation();
    if (event.type === 'keydown') {
      // Let the input handle its own commands. Unhandled events keep their native default, including typing.
      field.dispatchEvent(new CustomEvent<KeyboardEvent>(WATCH_SEARCH_KEY, { detail: event }));
    }
  };
  for (const type of ['keydown', 'keypress', 'keyup'] as const) window.addEventListener(type, shield, true);
}
