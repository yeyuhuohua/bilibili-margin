// 原生评论公开属地，只在内容脚本请求时读取对应评论的字段。
(() => {
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
