// 原生评论公开属地，以及原站发布请求等待期间的重复点击保护。
(() => {
  const pending = new WeakMap();
  let origin = null;
  const boxOf = event => event.composedPath().find(node => node instanceof HTMLElement && node.localName === 'bili-comment-box');
  const active = () => document.documentElement.classList.contains('margin-skin');
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
  document.addEventListener('margin:read-comment-location', (event) => {
    const path = event.composedPath();
    const target = path[0];
    if (!(target instanceof HTMLElement) || target.localName !== 'bili-comment-action-buttons-renderer') return;
    const renderer = path.find(node => node instanceof HTMLElement &&
      (node.localName === 'bili-comment-renderer' || node.localName === 'bili-comment-reply-renderer'));
    const value = renderer?.data?.reply_control?.location;
    const text = typeof value === 'string' && value.length <= 80 ? value.trim() : '';
    if (text) {
      if (target.getAttribute('data-margin-location') !== text) target.setAttribute('data-margin-location', text);
    } else target.removeAttribute('data-margin-location');
  }, true);
})();
