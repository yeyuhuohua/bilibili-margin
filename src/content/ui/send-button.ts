// Keep the native button, text and listeners. Only the aria-hidden artwork is ours.
const CSS = `
  :is(html.margin-skin, :host-context(html.margin-skin), .app) .margin-send-button {
    position: relative !important; overflow: hidden !important; min-width: 88px;
    min-height: 32px; font-size: 0 !important; transition: scale .2s ease !important;
  }
  :is(html.margin-skin, :host-context(html.margin-skin), .app) .margin-send-button > :not(.m-send-visual) { opacity: 0 !important; font-size: 0 !important; }
  .m-send-visual[hidden] { display: none; }
  :is(html.margin-skin, :host-context(html.margin-skin), .app) .margin-send-button > .m-send-visual {
    display: flex !important; position: absolute; inset: 0; align-items: center; justify-content: center;
    gap: 6px; pointer-events: none; font: 500 14px/1 var(--m-sans, var(--sans, system-ui)); color: inherit;
  }
  .m-send-flight { display: inline-flex; }
  .m-send-flight svg { display: block; width: 20px; height: 20px; transition: transform .3s ease; }
  .m-send-label { transition: transform .3s ease; }
  .margin-send-button[data-margin-sending] .m-send-flight { animation: none !important; }
  .margin-send-button[data-margin-sending] .m-send-flight svg, .margin-send-button[data-margin-sending] .m-send-label { transform: none !important; }
  .margin-send-button[data-margin-sending] .m-send-label { font-size: 0; }
  .margin-send-button[data-margin-sending] .m-send-label::after { content: '发送中…'; font-size: 14px; }
  :is(html.margin-skin, :host-context(html.margin-skin), .app) .margin-send-button:focus-visible { outline: 2px solid var(--m-accent, #00aeec) !important; outline-offset: 3px; }
  @media (prefers-reduced-motion: no-preference) {
    .margin-send-button:is(:hover, :focus-visible):not(:disabled):not([aria-disabled="true"]) .m-send-flight { animation: m-send-fly .6s ease-in-out infinite alternate; }
    .margin-send-button:is(:hover, :focus-visible):not(:disabled):not([aria-disabled="true"]) svg { transform: translateX(19px) rotate(45deg) scale(1.1); }
    .margin-send-button:is(:hover, :focus-visible):not(:disabled):not([aria-disabled="true"]) .m-send-label { transform: translateX(5em); }
    .margin-send-button:active:not(:disabled):not([aria-disabled="true"]) { scale: .95; }
  }
  @media (prefers-reduced-motion: reduce) { .margin-send-button, .m-send-flight svg, .m-send-label { transition: none !important; } }
  :is(html:is(.margin-reduce, .margin-ui-still), :host-context(html:is(.margin-reduce, .margin-ui-still))) .margin-send-button,
  :is(html:is(.margin-reduce, .margin-ui-still), :host-context(html:is(.margin-reduce, .margin-ui-still))) .margin-send-button * { animation: none !important; transition: none !important; transform: none !important; scale: none !important; }
  @keyframes m-send-fly { from { transform: translateY(1.4px); } to { transform: translateY(-1.4px); } }
`;
const roots = new WeakSet<Document | ShadowRoot>();

export function decorateSendButton(button: HTMLButtonElement): void {
  const old = button.querySelector<HTMLElement>(':scope > .m-send-visual');
  const label = [...button.childNodes].filter(node => node !== old && node.nodeType !== Node.COMMENT_NODE).map(node => node.textContent).join('').trim();
  if (label !== '发布') { old?.remove(); button.classList.remove('margin-send-button'); return; }
  const root = button.getRootNode();
  if (!(root instanceof Document || root instanceof ShadowRoot)) return;
  if (!roots.has(root)) {
    const sheet = new CSSStyleSheet(); sheet.replaceSync(CSS);
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet]; roots.add(root);
  }
  button.classList.add('margin-send-button');
  if (old) return;
  const visual = document.createElement('span'); visual.className = 'm-send-visual'; visual.hidden = true; visual.setAttribute('aria-hidden', 'true');
  const flight = document.createElement('span'); flight.className = 'm-send-flight';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('fill', 'currentColor');
  path.setAttribute('d', 'M1.946 9.315c-.522-.174-.527-.455.01-.634l19.087-6.362c.529-.176.832.12.684.638l-5.454 19.086c-.15.529-.455.547-.679.045L12 14l6-8-8 6-8.054-2.685z');
  svg.append(path); flight.append(svg);
  const text = document.createElement('span'); text.className = 'm-send-label'; text.textContent = label;
  visual.append(flight, text); button.append(visual);
}
