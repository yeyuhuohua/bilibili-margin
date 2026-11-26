// 原生评论公开属地，以及原站发布请求等待期间的重复点击保护。
(() => {
  const pending = new WeakMap();
  let origin = null;
  const boxOf = event => event.composedPath().find(node => node instanceof HTMLElement && node.localName === 'bili-comment-box');
  const active = () => document.documentElement.classList.contains('margin-skin');
  document.addEventListener('paste', event => {
    if (!event.isTrusted || !active() || !event.clipboardData?.files.length) return;
    const path = event.composedPath(), box = boxOf(event);
    if (!path.some(node => node instanceof HTMLElement && (node.isContentEditable || node.localName === 'textarea'))) return;
    const button = box?.shadowRoot?.querySelector('bili-icon[icon="BDC/image_line/3"]')?.closest('button');
    const input = box?.shadowRoot?.querySelector('bili-comment-pictures-upload')?.uploader?.el;
    if (!button || button.matches(':disabled,.disabled') || !button.getClientRects().length || !(input instanceof HTMLInputElement)) return;
    const files = new DataTransfer();
    for (const file of event.clipboardData.files) if (file.type.startsWith('image/')) files.items.add(file);
    if (!files.files.length) return;
    // Let the native tool perform its usual access checks and start its upload queue.
    const supply = click => {
      click.preventDefault();
      input.files = files.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    input.addEventListener('click', supply, { once: true });
    try { button.click(); } finally { input.removeEventListener('click', supply); }
  }, true);
  document.addEventListener('click', event => {
    if (!active()) return;
    const box = boxOf(event);
    const button = box?.shadowRoot?.querySelector('#pub button');
    if (!button || !event.composedPath().includes(button)) { origin = null; return; }
    if (pending.has(box)) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    origin = box;
  }, true);
  document.addEventListener('keydown', event => {
    if (!active() || event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
    const box = boxOf(event);
    if (!box) return;
    if (pending.has(box)) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    origin = box;
  }, true);
  function begin() {
    const box = origin;
    const button = box?.isConnected && box.shadowRoot?.querySelector('#pub button');
    if (!active() || !button || pending.has(box)) return () => {};
    const previous = button.getAttribute('aria-busy');
    pending.set(box, button);
    button.setAttribute('aria-busy', 'true'); button.setAttribute('data-margin-sending', '');
    return () => {
      if (pending.get(box) !== button) return;
      pending.delete(box); button.removeAttribute('data-margin-sending');
      if (previous === null) button.removeAttribute('aria-busy'); else button.setAttribute('aria-busy', previous);
      if (origin === box) origin = null;
    };
  }
  function isPublish(input, method) {
    if (String(method || 'GET').toUpperCase() !== 'POST') return false;
    try { const url = new URL(input, location.href); return url.origin === 'https://api.bilibili.com' && url.pathname === '/x/v2/reply/add'; }
    catch { return false; }
  }
  // Observe only native comment submission; retain the request, response and native error handling.
  const nativeFetch = window.fetch;
  window.fetch = function(input, init) {
    const publish = isPublish(input instanceof Request ? input.url : input, init?.method || (input instanceof Request ? input.method : undefined));
    if (!publish || !active()) return Reflect.apply(nativeFetch, this, arguments);
    const end = begin();
    try {
      return Reflect.apply(nativeFetch, this, arguments).then(response => {
        try { response.clone().arrayBuffer().then(end, end); } catch { end(); }
        return response;
      }, error => { end(); throw error; });
    } catch (error) { end(); throw error; }
  };
  const requests = new WeakMap();
  const nativeOpen = XMLHttpRequest.prototype.open, nativeSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url) {
    const result = Reflect.apply(nativeOpen, this, arguments);
    requests.set(this, isPublish(url, method)); return result;
  };
  XMLHttpRequest.prototype.send = function() {
    if (!requests.get(this) || !active()) return Reflect.apply(nativeSend, this, arguments);
    const end = begin(); this.addEventListener('loadend', end, { once: true });
    try { return Reflect.apply(nativeSend, this, arguments); }
    catch (error) { end(); throw error; }
  };
  const renderers = new Set(['bili-comment-renderer', 'bili-comment-reply-renderer']);
  function findRenderer(node) {
    let cur = node;
    while (cur) {
      const root = cur.getRootNode?.();
      const host = root instanceof ShadowRoot ? root.host : null;
      if (host instanceof HTMLElement && renderers.has(host.localName)) return host;
      cur = host;
    }
    return null;
  }
  function locationText(target, renderer) {
    const source = renderer?.data !== undefined ? renderer.data : target?.data;
    const raw = source?.reply_control?.location;
    return typeof raw === 'string' && raw.length <= 80 ? raw.trim() : '';
  }
  function syncTarget(target, rendererHint, notify) {
    if (!(target instanceof HTMLElement) || target.localName !== 'bili-comment-action-buttons-renderer') return;
    const renderer = rendererHint ?? findRenderer(target);
    const text = locationText(target, renderer);
    if (text) {
      if (target.getAttribute('data-margin-location') !== text) target.setAttribute('data-margin-location', text);
    } else if (target.hasAttribute('data-margin-location')) {
      target.removeAttribute('data-margin-location');
    }
    if (!notify || !active() || !target.isConnected) return;
    const sr = target.shadowRoot;
    if (!sr) return;
    const current = sr.querySelector('[data-margin-location-label]')?.textContent || '';
    const hasPub = !!sr.querySelector('#pubdate');
    if ((text && hasPub && current !== text) || (!text && current)) {
      target.dispatchEvent(new Event('margin:comment-location-sync', { bubbles: true, composed: true }));
    }
  }
  function hookUpdated(name, onUpdate) {
    if (typeof customElements === 'undefined') return;
    const patch = ctor => {
      const proto = ctor?.prototype;
      if (!proto || typeof proto.updated !== 'function' || proto.updated.__marginLocationHook) return;
      const orig = proto.updated;
      const wrapped = function() {
        const result = Reflect.apply(orig, this, arguments);
        try { if (active()) onUpdate(this); } catch {}
        return result;
      };
      wrapped.__marginLocationHook = true;
      proto.updated = wrapped;
    };
    const existing = customElements.get(name);
    if (existing) patch(existing);
    else customElements.whenDefined(name).then(patch, () => {});
  }
  hookUpdated('bili-comment-action-buttons-renderer', el => syncTarget(el, null, true));
  hookUpdated('bili-comment-renderer', el => {
    const btn = el.actionButtons || el.shadowRoot?.querySelector('bili-comment-action-buttons-renderer');
    if (btn) syncTarget(btn, el, true);
  });
  hookUpdated('bili-comment-reply-renderer', el => {
    const btn = el.actionButtons || el.shadowRoot?.querySelector('bili-comment-action-buttons-renderer');
    if (btn) syncTarget(btn, el, true);
  });
  document.addEventListener('margin:read-comment-location', (event) => {
    const path = event.composedPath();
    const target = path[0];
    if (!(target instanceof HTMLElement) || target.localName !== 'bili-comment-action-buttons-renderer') return;
    const renderer = path.find(node => node instanceof HTMLElement && renderers.has(node.localName)) ?? null;
    syncTarget(target, renderer, false);
  }, true);
})();
